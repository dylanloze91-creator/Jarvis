import {
  APPENDICE_MAX,
  checkAppendiceBaseUrl,
  describeAppendiceAction,
  describeAppendiceState,
  toolFailure,
  toolSuccess,
  type AppendiceParams,
  type AppendiceState,
  type StopAllResult,
  type ToolResult,
} from '@jarvis/core';
import type { AppendiceStatus, AppendiceView } from '../../shared/ipc.js';
import { AppendiceClient, AppendiceError, type AppendiceClientOptions } from './client.js';
import type { AppendiceRecord, AppendiceStore } from './store.js';

/** Chiffrement du système (`safeStorage` d'Electron), injecté : le service ne dépend pas d'Electron. */
export interface TokenCipher {
  available(): boolean;
  /** Rend le texte chiffré, en base64. */
  seal(plain: string): string;
  open(sealed: string): string;
}

/** Une cible d'arrêt qui n'est pas dans le registre : le robot, l'imprimante. */
export interface ExtraStop {
  name: string;
  /** Faux : rien à arrêter (non réglé). */
  configured(): boolean;
  /** Envoie l'arrêt ; lève une erreur s'il n'a pas pu partir. */
  stop(): Promise<void>;
}

export interface AppendiceServiceOptions {
  /** Faux hors de Jarvis Test : rien n'existe, aucun outil, aucune requête. */
  allowed: boolean;
  cipher: TokenCipher;
  client?: AppendiceClientOptions;
  extraStops?: readonly ExtraStop[];
  now?: () => number;
}

export type AppendiceAddResult = { ok: true; appendice: AppendiceView } | { ok: false; sentence: string };

interface Live {
  state?: AppendiceState;
  reachable?: boolean;
  lastSeenAt?: number;
  error?: string;
}

function label(record: Pick<AppendiceRecord, 'nom' | 'piece'>): string {
  return record.piece ? `${record.nom} (${record.piece})` : record.nom;
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sentenceOf(error: unknown): string {
  if (error instanceof AppendiceError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tient le registre des appendices et leur parle. Coupé par défaut : tant que l'interrupteur
 * n'est pas mis, aucune requête ne part et aucun outil n'est proposé.
 * Aucune boucle en fond : l'état n'est relu que sur demande (réglages, outil).
 */
export class AppendiceService {
  private readonly tokens = new Map<string, string>();
  private readonly live = new Map<string, Live>();
  private readonly now: () => number;

  constructor(
    private readonly store: AppendiceStore,
    private readonly options: AppendiceServiceOptions,
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  async load(): Promise<void> {
    if (!this.options.allowed) return;
    await this.store.load();
  }

  /** Vrai s'il y a quelque chose à arrêter : un appendice inscrit (registre coupé ou non), ou le robot. */
  canStop(): boolean {
    if (!this.options.allowed) return false;
    return this.store.records().length > 0 || (this.options.extraStops ?? []).some((extra) => extra.configured());
  }

  /** Vrai seulement dans Jarvis Test, registre activé, au moins un appendice relié. */
  available(): boolean {
    return this.options.allowed && this.store.enabled && this.store.records().length > 0;
  }

  status(): AppendiceStatus {
    return {
      allowed: this.options.allowed,
      enabled: this.options.allowed && this.store.enabled,
      encryption: this.options.cipher.available(),
      max: APPENDICE_MAX,
      appendices: this.options.allowed ? this.store.records().map((record) => this.view(record)) : [],
    };
  }

  async setEnabled(enabled: boolean): Promise<AppendiceStatus> {
    if (this.options.allowed) await this.store.setEnabled(enabled);
    return this.status();
  }

  /** Relie un appendice : adresse locale, présentation lue avec le jeton, puis inscription. */
  async add(input: { baseUrl: string; token: string }): Promise<AppendiceAddResult> {
    if (!this.options.allowed) return { ok: false, sentence: 'Les appendices n’existent que dans Jarvis Test.' };
    await this.store.load();
    const check = checkAppendiceBaseUrl(input.baseUrl);
    if (!check.ok) return { ok: false, sentence: check.reason };
    const token = input.token.trim();
    if (token.length < 8 || token.length > 512) return { ok: false, sentence: 'Le jeton manque ou est trop court.' };
    const client = new AppendiceClient(check.origin, () => token, this.options.client);
    let hello;
    try {
      hello = await client.hello();
    } catch (error) {
      return { ok: false, sentence: sentenceOf(error) };
    }
    const existing = this.store.find(hello.id);
    if (!existing && this.store.records().length >= APPENDICE_MAX) {
      return { ok: false, sentence: `Le registre est plein (${APPENDICE_MAX} appendices). Retires-en un d’abord.` };
    }
    const record: AppendiceRecord = {
      id: hello.id,
      genre: hello.genre,
      nom: hello.nom,
      ...(hello.piece ? { piece: hello.piece } : {}),
      // Ce socle ne relie que des appendices que Jarvis appelle. Ceux qui appellent Jarvis
      // (capteurs, boutons) arriveront avec le pont.
      lien: 'jarvis-appelle',
      risque: hello.risque,
      capacites: hello.capacites,
      version: hello.version,
      baseUrl: check.origin,
      addedAt: existing?.addedAt ?? this.now(),
    };
    if (this.options.cipher.available()) {
      try {
        record.tokenSealed = this.options.cipher.seal(token);
      } catch {
        /* chiffrement en panne : le jeton reste en mémoire */
      }
    }
    await this.store.put(record);
    this.tokens.set(record.id, token);
    this.live.set(record.id, { reachable: true, lastSeenAt: this.now() });
    return { ok: true, appendice: this.view(record) };
  }

  async remove(id: string): Promise<AppendiceStatus> {
    if (this.options.allowed) {
      await this.store.remove(id);
      this.tokens.delete(id);
      this.live.delete(id);
    }
    return this.status();
  }

  /** Relit l'état de chaque appendice (5 s au plus chacun, en parallèle). */
  async refresh(signal?: AbortSignal): Promise<AppendiceStatus> {
    if (this.options.allowed && this.store.enabled) {
      await Promise.all(this.store.records().map((record) => this.readState(record, signal)));
    }
    return this.status();
  }

  /** Retrouve un appendice par son identifiant ou son nom (sans casse ni accent). */
  resolve(wanted: string): AppendiceRecord | { error: string } {
    const records = this.store.records();
    const key = fold(wanted);
    const exact = records.filter((record) => record.id === wanted.trim() || fold(record.nom) === key || fold(label(record)) === key);
    if (exact.length === 1) return exact[0]!;
    const partial = exact.length ? exact : records.filter((record) => key && fold(label(record)).includes(key));
    if (partial.length === 1) return partial[0]!;
    const names = records.map((record) => label(record)).join(', ');
    if (partial.length > 1) return { error: `Plusieurs appendices correspondent à « ${wanted} » : précise lequel (${names}).` };
    return { error: `Aucun appendice ne s’appelle « ${wanted} ». Appendices reliés : ${names || 'aucun'}.` };
  }

  names(): string[] {
    return this.store.records().map((record) => label(record));
  }

  async describe(signal?: AbortSignal): Promise<string> {
    await this.refresh(signal);
    return this.store
      .records()
      .map((record) => {
        const live = this.live.get(record.id);
        const capacities = record.capacites.map((capacity) => capacity.nom).join(', ') || 'aucune';
        const state = live?.state ? describeAppendiceState(label(record), live.state) : `${label(record)} : ne répond pas (${live?.error ?? 'pas de réponse'}).`;
        return `${state} Capacités : ${capacities}.`;
      })
      .join('\n');
  }

  /** Lance une action bornée et attend son résultat. L'accord a déjà été donné par la carte de l'outil. */
  async action(record: AppendiceRecord, capacity: string, params: AppendiceParams, signal?: AbortSignal): Promise<ToolResult> {
    const name = label(record);
    if (!record.capacites.some((item) => item.nom === capacity)) {
      const known = record.capacites.map((item) => item.nom).join(', ') || 'aucune';
      return toolFailure('definitive', `${name} ne sait pas faire « ${capacity} ». Il sait faire : ${known}.`, 'capacité absente de la présentation');
    }
    const client = this.client(record);
    try {
      const action = await client.action(capacity, params, signal);
      this.seen(record.id);
      const report = describeAppendiceAction(name, capacity, action);
      if (report.stopNeeded) await client.stop().catch(() => undefined);
      return report.outcome === 'success'
        ? toolSuccess(report.content, action)
        : toolFailure(report.outcome, report.content, `statut ${action.statut}`, action);
    } catch (error) {
      return this.failure(name, capacity, error);
    }
  }

  /** Arrêt d'un appendice. Ne demande jamais d'accord. */
  async stopOne(record: AppendiceRecord): Promise<StopAllResult> {
    try {
      await this.client(record).stop();
      this.seen(record.id);
      return { name: label(record), ok: true };
    } catch (error) {
      return { name: label(record), ok: false, detail: sentenceOf(error) };
    }
  }

  /**
   * « Arrête tout » : stop à chaque appendice du registre, et aux autres cibles (robot…), en
   * parallèle. Rend `null` s'il n'y a rien à arrêter : la phrase suit alors le chemin d'avant.
   * Part même si le registre vient d'être coupé : mieux vaut un arrêt de trop.
   */
  async stopAll(): Promise<StopAllResult[] | null> {
    if (!this.options.allowed) return null;
    await this.store.load();
    const extras = (this.options.extraStops ?? []).filter((extra) => extra.configured());
    const records = this.store.records();
    if (!records.length && !extras.length) return null;
    return Promise.all([
      ...records.map((record) => this.stopOne(record)),
      ...extras.map(async (extra): Promise<StopAllResult> => {
        try {
          await extra.stop();
          return { name: extra.name, ok: true };
        } catch (error) {
          return { name: extra.name, ok: false, detail: sentenceOf(error) };
        }
      }),
    ]);
  }

  /** Arrêt d'urgence : l'activer n'attend rien ; le relâcher passe par une carte (outil). */
  async emergency(record: AppendiceRecord, active: boolean): Promise<ToolResult> {
    const name = label(record);
    try {
      await this.client(record).emergency(active);
      const state = await this.readState(record);
      const locked = state?.etat === 'arret_urgence';
      if (active && !locked) {
        return toolFailure('recoverable', `${name} : arrêt d’urgence envoyé, mais l’appendice ne dit pas qu’il est verrouillé. Utilise le bouton d’arrêt d’urgence.`, 'état non relu');
      }
      if (!active && locked) {
        return toolFailure('recoverable', `${name} : l’appendice est toujours en arrêt d’urgence.`, 'état non relu');
      }
      return toolSuccess(active ? `${name} : arrêt d’urgence actif, relu sur l’appendice.` : `${name} : arrêt d’urgence relâché, relu sur l’appendice.`);
    } catch (error) {
      const detail = sentenceOf(error);
      return toolFailure(
        'recoverable',
        active ? `${name} ne répond pas (${detail}). Utilise le bouton d’arrêt d’urgence.` : `${name} : arrêt d’urgence non relâché (${detail}).`,
        detail,
      );
    }
  }

  private failure(name: string, capacity: string, error: unknown): ToolResult {
    if (!(error instanceof AppendiceError)) {
      return toolFailure('definitive', `${name}, ${capacity} : erreur.`, sentenceOf(error));
    }
    const detail = `${error.kind}: ${error.detail ?? error.message}`;
    switch (error.kind) {
      case 'refused':
        return toolFailure('definitive', `${name}, ${capacity} : refusé par l’appendice (${error.message}).`, detail, error.action);
      case 'bad_request':
        return toolFailure('definitive', `${name}, ${capacity} : ordre refusé (${error.message}).`, detail);
      case 'unreachable':
        return toolFailure('recoverable', `${name}, ${capacity} : ${error.message} Un arrêt a été envoyé par précaution.`, detail);
      case 'timeout':
        return toolFailure('timeout', `${name}, ${capacity} : ${error.message} Un arrêt a été envoyé par précaution.`, detail);
      case 'cancelled':
        return toolFailure('cancelled', `${name}, ${capacity} : annulé. L’appendice a reçu l’ordre de s’arrêter.`, detail);
      case 'unauthorized':
        return toolFailure('missing_dependency', `${name} : ${error.message}`, detail);
      default:
        return toolFailure('definitive', `${name}, ${capacity} : ${error.message}`, detail);
    }
  }

  private async readState(record: AppendiceRecord, signal?: AbortSignal): Promise<AppendiceState | null> {
    try {
      const state = await this.client(record).state(signal);
      this.live.set(record.id, { state, reachable: true, lastSeenAt: this.now() });
      return state;
    } catch (error) {
      const previous = this.live.get(record.id);
      this.live.set(record.id, { reachable: false, lastSeenAt: previous?.lastSeenAt, error: sentenceOf(error) });
      return null;
    }
  }

  private seen(id: string): void {
    this.live.set(id, { ...this.live.get(id), reachable: true, lastSeenAt: this.now(), error: undefined });
  }

  private client(record: AppendiceRecord): AppendiceClient {
    return new AppendiceClient(record.baseUrl, () => this.token(record), this.options.client);
  }

  private token(record: AppendiceRecord): string {
    const known = this.tokens.get(record.id);
    if (known) return known;
    if (!record.tokenSealed || !this.options.cipher.available()) return '';
    try {
      const plain = this.options.cipher.open(record.tokenSealed);
      this.tokens.set(record.id, plain);
      return plain;
    } catch {
      return '';
    }
  }

  private view(record: AppendiceRecord): AppendiceView {
    const live = this.live.get(record.id);
    return {
      id: record.id,
      genre: record.genre,
      nom: record.nom,
      ...(record.piece ? { piece: record.piece } : {}),
      risque: record.risque,
      capacites: record.capacites.map((capacity) => ({
        nom: capacity.nom,
        ...(capacity.description ? { description: capacity.description } : {}),
        risque: capacity.risque ?? record.risque,
      })),
      version: record.version,
      baseUrl: record.baseUrl,
      hasToken: this.token(record) !== '',
      ...(live?.state ? { etat: live.state.etat } : {}),
      ...(live?.reachable !== undefined ? { reachable: live.reachable } : {}),
      ...(live?.lastSeenAt !== undefined ? { lastSeenAt: live.lastSeenAt } : {}),
      ...(live?.error ? { error: live.error } : {}),
    };
  }
}
