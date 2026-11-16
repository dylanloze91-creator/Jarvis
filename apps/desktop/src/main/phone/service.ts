import { PHONE_PORT, RESERVED_PHRASE, phoneAppUrl, tailscaleServeCommand } from '@jarvis/core';
import type { PhoneStatus } from '../../shared/ipc.js';
import { PhoneServer, type PhoneServerDeps } from './server.js';
import type { PhoneStore } from './store.js';
import { readTailscale, type TailscaleRunner, type TailscaleState } from './tailscale.js';

/**
 * 5.0.63 — le téléphone vu des réglages : interrupteur, état de Tailscale, code de jumelage,
 * appareils reliés. Coupé par défaut ; coupé = aucun port ouvert.
 */
export interface PhoneServiceDeps extends Omit<PhoneServerDeps, 'store' | 'onPaired'> {
  store: PhoneStore;
  port?: number;
  /** Test : faux tant que l'utilisateur n'a pas activé la fonction réservée. */
  mayRun?: () => boolean;
  tailscale?: TailscaleRunner;
  /** Pousse l'état à l'interface (appareil relié depuis le téléphone). */
  broadcast?: (status: PhoneStatus) => void;
}

export class PhoneService {
  readonly server: PhoneServer;
  private error: string | null = null;
  private lastTailscale: TailscaleState = {
    installed: false,
    dnsName: null,
    online: false,
    backendState: null,
    served: null,
  };

  constructor(private readonly deps: PhoneServiceDeps) {
    this.server = new PhoneServer({
      ...deps,
      store: deps.store,
      onPaired: () => {
        void this.status().then((status) => this.deps.broadcast?.(status));
      },
    });
  }

  private get port(): number {
    return this.deps.port ?? PHONE_PORT;
  }

  private canRun(): boolean {
    return this.deps.mayRun?.() ?? true;
  }

  isEnabled(): boolean {
    return this.deps.store.enabled;
  }

  async init(): Promise<void> {
    await this.deps.store.load();
    if (this.deps.store.enabled && this.canRun()) await this.startServer();
  }

  private async startServer(): Promise<void> {
    this.error = null;
    try {
      await this.server.start(this.port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.error =
        code === 'EADDRINUSE'
          ? `Le port ${this.port} est déjà pris par un autre programme : Jarvis ne peut pas s’ouvrir au téléphone.`
          : `Le serveur du téléphone n’a pas démarré : ${error instanceof Error ? error.message : String(error)}`;
      this.deps.log?.(`[téléphone] ${this.error}`);
    }
  }

  async setEnabled(enabled: boolean): Promise<PhoneStatus> {
    if (enabled && !this.canRun()) {
      this.error = RESERVED_PHRASE;
      return this.status();
    }
    await this.deps.store.setEnabled(enabled);
    if (enabled) await this.startServer();
    else {
      this.error = null;
      await this.server.stop();
    }
    return this.status();
  }

  async status(refreshTailscale = true): Promise<PhoneStatus> {
    await this.deps.store.load();
    // Coupé : Tailscale n'est pas interrogé (aucun programme lancé à l'ouverture des réglages).
    if (refreshTailscale && this.deps.store.enabled) {
      this.lastTailscale = await readTailscale(this.port, this.deps.tailscale).catch(() => this.lastTailscale);
    }
    const tailscale = this.lastTailscale;
    const pairing = this.server.currentPairing();
    return {
      enabled: this.deps.store.enabled,
      running: this.server.running,
      port: this.port,
      error: this.error,
      tailscale: {
        installed: tailscale.installed,
        online: tailscale.online,
        dnsName: tailscale.dnsName,
        served: tailscale.served,
      },
      url: tailscale.dnsName ? phoneAppUrl(tailscale.dnsName) : null,
      serveCommand: tailscaleServeCommand(this.port),
      devices: this.deps.store.devices(),
      pairing: pairing
        ? {
            code: pairing.code,
            expiresAt: pairing.expiresAt,
            url: tailscale.dnsName ? phoneAppUrl(tailscale.dnsName, pairing.code) : null,
          }
        : null,
    };
  }

  /** Nouveau code ; refusé tant que le serveur ne tourne pas. */
  async startPairing(): Promise<PhoneStatus> {
    if (this.server.running) this.server.startPairing();
    return this.status(false);
  }

  async cancelPairing(): Promise<PhoneStatus> {
    this.server.cancelPairing();
    return this.status(false);
  }

  async revoke(id: string): Promise<PhoneStatus> {
    await this.deps.store.removeDevice(id);
    return this.status(false);
  }

  stop(): Promise<void> {
    return this.server.stop();
  }
}
