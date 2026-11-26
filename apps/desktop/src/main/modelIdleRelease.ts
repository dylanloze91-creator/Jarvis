/**
 * Modèles libérés après usage : voir `packages/core/src/agent/modelIdle.ts`.
 *
 * Toutes les minutes, si Jarvis n'a pas servi depuis `MODEL_IDLE_RELEASE_MS` et que rien n'est en
 * cours, les modèles de discussion encore chargés dans Ollama sont déchargés (`keep_alive: 0`, par
 * requête : les variables du serveur Ollama ne sont jamais touchées). Une fois libérés, plus rien
 * n'est demandé à Ollama jusqu'au prochain usage.
 */
import {
  MODEL_IDLE_CHECK_MS,
  MODEL_IDLE_RELEASE_MS,
  idleLongEnough,
  modelsToRelease,
  ollamaDescriptor,
  type Settings,
} from '@jarvis/core';

const LIST_DEADLINE_MS = 5_000;
const UNLOAD_DEADLINE_MS = 20_000;

export interface ModelIdleReleaseDeps {
  getSettings: () => Settings;
  /** Vrai tant qu'un tour, une mission, une image ou un entraînement est en cours. */
  busy: () => boolean;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
  idleMs?: number;
  checkMs?: number;
}

export class ModelIdleRelease {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastUse: number;
  /** Déjà libérés depuis le dernier usage : on ne redemande rien à Ollama. */
  private released = false;
  private running = false;

  constructor(private readonly deps: ModelIdleReleaseDeps) {
    this.lastUse = this.now();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private baseUrl(): string {
    const settings = this.deps.getSettings();
    const custom = settings.provider === 'ollama' ? settings.baseUrl.trim() : '';
    return (custom || ollamaDescriptor.defaultBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  }

  /** Jarvis vient de servir (tour de discussion, réveil d'une enceinte, préchauffage). */
  noteUse(): void {
    this.lastUse = this.now();
    this.released = false;
  }

  /** Vrai quand Jarvis est au repos depuis assez longtemps : rien ne doit être prolongé. */
  idle(): boolean {
    return idleLongEnough({ now: this.now(), lastUse: this.lastUse, busy: this.deps.busy(), idleMs: this.deps.idleMs ?? MODEL_IDLE_RELEASE_MS });
  }

  /** Fermeture de Jarvis : libère tout de suite ses modèles de discussion, sauf si un travail est en cours. */
  releaseNow(): Promise<string[]> {
    return this.check(true);
  }

  /** Un contrôle : rend les modèles libérés (vide si rien à faire). Ne lève jamais. */
  async check(now = false): Promise<string[]> {
    if (this.running || this.released) return [];
    if (now ? this.deps.busy() : !this.idle()) return [];
    this.running = true;
    try {
      const settings = this.deps.getSettings();
      if (settings.provider !== 'ollama') {
        this.released = true;
        return [];
      }
      const doFetch = this.deps.fetch ?? fetch;
      const base = this.baseUrl();
      const response = await doFetch(`${base}/api/ps`, { signal: AbortSignal.timeout(LIST_DEADLINE_MS) });
      const body = (await response.json()) as { models?: { name?: unknown }[] };
      const loaded = (body.models ?? []).flatMap((model) => (typeof model.name === 'string' ? [model.name] : []));
      const freed: string[] = [];
      for (const model of modelsToRelease(settings, loaded)) {
        // Un tour a pu commencer pendant la lecture de la liste : on ne décharge plus rien.
        if (now ? this.deps.busy() : !this.idle()) return freed;
        const answer = await doFetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, keep_alive: 0 }),
          signal: AbortSignal.timeout(UNLOAD_DEADLINE_MS),
        });
        await answer.text();
        if (answer.ok) freed.push(model);
      }
      this.released = true;
      if (freed.length) this.deps.log?.(`[modèles] au repos : ${freed.join(', ')} libéré${freed.length > 1 ? 's' : ''} (carte graphique rendue).`);
      return freed;
    } catch {
      // Ollama arrêté ou injoignable : rien à libérer, on réessaiera au prochain contrôle.
      return [];
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), this.deps.checkMs ?? MODEL_IDLE_CHECK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
