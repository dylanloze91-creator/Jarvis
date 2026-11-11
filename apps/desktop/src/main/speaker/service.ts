import { hostname, networkInterfaces } from 'node:os';
import { SPEAKER_PORT, sortLocalAddresses, speakerSecretsBlock } from '@jarvis/core';
import type { SpeakerAdded, SpeakerStatus } from '../../shared/ipc.js';
import { SpeakerServer, type SpeakerServerDeps } from './server.js';
import type { Speaker, SpeakerStore } from './store.js';

/**
 * 5.0.64 — les enceintes vues des réglages : interrupteur, adresse du PC à mettre dans la carte,
 * ajout (jeton montré une fois, dans le bloc `secrets.h`), retrait, dernière phrase reçue.
 * Coupé par défaut ; coupé = aucun port ouvert.
 */
export interface SpeakerServiceDeps extends Omit<SpeakerServerDeps, 'store' | 'onTurn'> {
  store: SpeakerStore;
  port?: number;
  /** Adresses IPv4 du PC ; remplaçable dans les tests. */
  localAddresses?: () => string[];
  hostName?: () => string;
  /** Pousse l'état à l'interface (phrase reçue pendant que les réglages sont ouverts). */
  broadcast?: (status: SpeakerStatus) => void;
  /** Annonce mDNS. Absente si le pont est coupé : on n'appelle pas. */
  openAnnounce?: () => Array<{ destroy(): void }> | Promise<Array<{ destroy(): void }>>;
  /** Adresses de la maison (passerelle, pas Tailscale). */
  keptAddresses?: () => string[] | Promise<string[]>;
}

/** Adresses IPv4 non internes des interfaces réseau du PC. */
export function localIpv4Addresses(): string[] {
  const out: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family === 'IPv4' || (entry.family as unknown) === 4) out.push(entry.address);
    }
  }
  return sortLocalAddresses(out);
}

/** Nom mDNS du PC : `<nom>.local`, en minuscules, sans caractères hors nom d'hôte. */
export function localHostName(raw = hostname()): string {
  const clean = raw
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${clean || 'pc'}.local`;
}

export class SpeakerService {
  readonly server: SpeakerServer;
  private error: string | null = null;
  private readonly lastTurn = new Map<string, number>();
  private announced: Array<{ destroy(): void }> = [];

  constructor(private readonly deps: SpeakerServiceDeps) {
    this.server = new SpeakerServer({
      ...deps,
      store: deps.store,
      onTurn: (speaker: Speaker, at: number) => {
        this.lastTurn.set(speaker.id, at);
        void this.status().then((status) => this.deps.broadcast?.(status));
      },
    });
  }

  private get port(): number {
    return this.deps.port ?? SPEAKER_PORT;
  }

  isEnabled(): boolean {
    return this.deps.store.enabled;
  }

  async init(): Promise<void> {
    await this.deps.store.load();
    if (this.deps.store.enabled) {
      await this.startServer();
      // La fenêtre charge Whisper à l'avance quand elle apprend que le pont écoute.
      await this.announce();
    }
  }

  private async announce(): Promise<void> {
    if (!this.deps.broadcast) return;
    this.deps.broadcast(await this.status());
  }

  private async startServer(): Promise<void> {
    this.error = null;
    try {
      await this.server.start(this.port);
      this.announced = await Promise.resolve(this.deps.openAnnounce?.() ?? []);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.error =
        code === 'EADDRINUSE'
          ? `Le port ${this.port} est déjà pris par un autre programme : le pont des enceintes ne peut pas s’ouvrir.`
          : `Le pont des enceintes n’a pas démarré : ${error instanceof Error ? error.message : String(error)}`;
      this.deps.log?.(`[enceinte] ${this.error}`);
    }
  }

  async setEnabled(enabled: boolean): Promise<SpeakerStatus> {
    await this.deps.store.setEnabled(enabled);
    if (enabled) await this.startServer();
    else {
      this.error = null;
      this.closeAnnounce();
      await this.server.stop();
    }
    await this.announce();
    return this.status();
  }

  async status(): Promise<SpeakerStatus> {
    await this.deps.store.load();
    return {
      enabled: this.deps.store.enabled,
      running: this.server.running,
      port: this.port,
      error: this.error,
      addresses: this.deps.localAddresses?.() ?? localIpv4Addresses(),
      hostName: this.deps.hostName?.() ?? localHostName(),
      speakers: this.deps.store.speakers().map((speaker) => ({ ...speaker, lastTurnAt: this.lastTurn.get(speaker.id) ?? null })),
    };
  }

  /** Nouvelle enceinte : le jeton n'existe en clair que dans le bloc rendu ici. */
  async add(name: string): Promise<SpeakerAdded> {
    const { speaker, token, evicted } = await this.deps.store.addSpeaker(name);
    // Au-delà de la limite, la plus ancienne est partie : sa discussion et son verrou aussi.
    for (const old of evicted) {
      this.server.forget(old.id);
      this.lastTurn.delete(old.id);
      this.deps.log?.(`[enceinte] retirée (limite atteinte) : ${old.name}`);
    }
    const status = await this.status();
    const secrets = speakerSecretsBlock({
      host: status.addresses[0] ?? status.hostName,
      hostName: status.addresses[0] ? status.hostName : null,
      port: this.port,
      token,
      name: speaker.name,
    });
    this.deps.log?.(`[enceinte] ajoutée : ${speaker.name}`);
    return { status, speaker: { id: speaker.id, name: speaker.name }, secrets };
  }

  async beginInstall(name: string, mac: string): Promise<SpeakerStatus & { speakerId: string; token: string; replaced: boolean; pcId: string; hosts: string[] }> {
    const begun = await this.deps.store.beginInstall(name, mac);
    const status = await this.status();
    const kept = this.deps.keptAddresses ? await this.deps.keptAddresses() : status.addresses;
    this.deps.log?.(`[enceinte] installation de « ${begun.speaker.name} »${begun.replaced ? ' (remplacement)' : ''}`);
    return {
      ...status,
      speakerId: begun.speaker.id,
      token: begun.token,
      replaced: begun.replaced,
      pcId: this.deps.store.pcId,
      hosts: kept.slice(0, 4),
    };
  }

  async commitInstall(id: string, fw?: string): Promise<SpeakerStatus> {
    await this.deps.store.commitInstall(id, fw);
    return this.status();
  }

  async abandonInstall(id: string): Promise<SpeakerStatus> {
    await this.deps.store.abandonInstall(id);
    this.server.forget(id);
    return this.status();
  }

  async signal(id: string): Promise<SpeakerStatus> {
    await this.deps.store.askIdentify(id);
    return this.status();
  }

  async rename(id: string, name: string): Promise<SpeakerStatus> {
    await this.deps.store.askRename(id, name);
    return this.status();
  }

  async remove(id: string): Promise<SpeakerStatus> {
    await this.deps.store.removeSpeaker(id);
    this.server.forget(id);
    this.lastTurn.delete(id);
    return this.status();
  }

  stop(): Promise<void> {
    this.closeAnnounce();
    return this.server.stop();
  }

  private closeAnnounce(): void {
    for (const socket of this.announced) socket.destroy();
    this.announced = [];
  }
}
