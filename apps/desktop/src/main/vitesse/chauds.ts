/**
 * Modèles gardés chauds (Jarvis Test seulement, table d'édition : `keepModelsWarm`).
 *
 * Au démarrage : le modèle qui trie et celui de l'équipe la plus utilisée sont chargés, sans
 * rien générer. Ensuite, toutes les quelques minutes : les modèles du chef d'orchestre **encore
 * chargés** (tri et équipes) sont prolongés. Un modèle déchargé exprès (Jarvis Imager, Jarvis Développeur) ou évincé par Ollama
 * n'est jamais rechargé par cette boucle : la carte graphique reste à qui la demande.
 *
 * Jarvis ne change jamais les variables du serveur Ollama : `keep_alive` par requête seulement.
 */
import {
  WARM_BEAT_MS,
  ollamaDescriptor,
  orchestraModelTargets,
  orchestraWarmTargets,
  warmLoadRequest,
  warmTargetsToRefresh,
  type OrchestraTeam,
  type Settings,
  type WarmTarget,
} from '@jarvis/core';

/** Plafond d'un chargement (premier chargement d'un 7B sur la RTX 2060 : une dizaine de secondes). */
const LOAD_DEADLINE_MS = 120_000;
const LIST_DEADLINE_MS = 5_000;

export interface ModelWarmerDeps {
  getSettings: () => Settings;
  /** Vrai quand la carte doit rester libre (image en cours, mission, entraînement). */
  busy?: () => boolean;
  /** Équipe la plus utilisée d'après les journaux de tour. Absent ou `null` : Conversation. */
  mostUsedTeam?: () => Promise<OrchestraTeam | null>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface WarmReport {
  /** Modèles chargés ou prolongés. */
  done: { model: string; ms: number }[];
  /** Modèles laissés de côté, avec la raison. */
  skipped: { model: string; reason: string }[];
}

export class ModelWarmer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly deps: ModelWarmerDeps) {}

  private baseUrl(): string {
    const settings = this.deps.getSettings();
    const custom = settings.provider === 'ollama' ? settings.baseUrl.trim() : '';
    return (custom || ollamaDescriptor.defaultBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  }

  private async targets(): Promise<WarmTarget[]> {
    const team = (await this.deps.mostUsedTeam?.().catch(() => null)) ?? null;
    return orchestraWarmTargets(this.deps.getSettings(), team);
  }

  private async load(target: WarmTarget): Promise<number> {
    const started = Date.now();
    const response = await (this.deps.fetch ?? fetch)(`${this.baseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(warmLoadRequest(target)),
      signal: AbortSignal.timeout(LOAD_DEADLINE_MS),
    });
    await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Date.now() - started;
  }

  private async loaded(): Promise<string[]> {
    const response = await (this.deps.fetch ?? fetch)(`${this.baseUrl()}/api/ps`, {
      signal: AbortSignal.timeout(LIST_DEADLINE_MS),
    });
    const body = (await response.json()) as { models?: { name?: unknown }[] };
    return (body.models ?? []).flatMap((model) => (typeof model.name === 'string' ? [model.name] : []));
  }

  private async run(
    list: () => Promise<WarmTarget[]>,
    pick: (targets: WarmTarget[]) => Promise<WarmTarget[]>,
    label: string,
  ): Promise<WarmReport> {
    const report: WarmReport = { done: [], skipped: [] };
    if (this.running) return report;
    this.running = true;
    try {
      const all = await list();
      if (this.deps.busy?.()) {
        for (const target of all) report.skipped.push({ model: target.model, reason: 'carte occupée' });
        return report;
      }
      const chosen = await pick(all);
      for (const target of all) {
        if (!chosen.includes(target)) report.skipped.push({ model: target.model, reason: 'pas chargé' });
      }
      for (const target of chosen) {
        // La carte peut être demandée entre deux chargements : on s'arrête là.
        if (this.deps.busy?.()) {
          report.skipped.push({ model: target.model, reason: 'carte occupée' });
          continue;
        }
        try {
          const ms = await this.load(target);
          report.done.push({ model: target.model, ms });
        } catch (error) {
          report.skipped.push({ model: target.model, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      if (report.done.length) {
        this.deps.log?.(`[vitesse] ${label} : ${report.done.map((item) => `${item.model} ${item.ms} ms`).join(', ')}`);
      }
      return report;
    } catch (error) {
      // Ollama arrêté : rien à garder chaud, et rien à dire à l'utilisateur.
      this.deps.log?.(`[vitesse] ${label} impossible : ${error instanceof Error ? error.message : String(error)}`);
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Démarrage : charge les modèles du tri et de l'équipe la plus utilisée. */
  prewarm(): Promise<WarmReport> {
    return this.run(() => this.targets(), async (targets) => targets, 'préchauffage');
  }

  /** Prolonge les modèles du chef d'orchestre encore chargés. N'en charge aucun. */
  beat(): Promise<WarmReport> {
    return this.run(
      async () => orchestraModelTargets(this.deps.getSettings()),
      async (targets) => warmTargetsToRefresh(targets, await this.loaded()),
      'modèles prolongés',
    );
  }

  /** Préchauffe, puis prolonge régulièrement. Sans effet si déjà lancé. */
  start(): void {
    if (this.timer) return;
    void this.prewarm();
    this.timer = setInterval(() => void this.beat(), WARM_BEAT_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
