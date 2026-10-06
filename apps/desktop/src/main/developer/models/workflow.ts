import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BENCH_TASKS,
  REAL_BENCH_TASKS,
  ROLE_LABELS,
  codeModelsOffered,
  calibrate,
  checkHardware,
  codeModelById,
  codeModelOptions,
  createCodeAIProvider,
  expertsInRamChanges,
  expertsInRamInstructions,
  predictModel,
  type HardwareFacts,
  type OllamaModelInfo,
  type OllamaCodeOptions,
  type ProviderRegistry,
  type ToolCallOutcome,
  type ToolManager,
} from '@jarvis/core';
import { patientFetch } from './patientFetch.js';
import type {
  CodeModelState,
  DevStepStatus,
  DevTaskKind,
  DeveloperState,
} from '../../../shared/developerIpc.js';
import type { Runner } from '../runner.js';
import { GIT_SAFE } from '../tools/common.js';
import { runCodeBenchmark } from './benchRunner.js';
import { runRealBenchmark } from './realBenchRunner.js';
import { pickCalibrationModel, runCalibration } from './calibration.js';
import { probeHardware, type HardwareProbeDeps } from './hardwareProbe.js';
import type { OllamaApi } from './ollamaApi.js';
import type { CodeModelStore } from './store.js';

type Step = (id: string, status: DevStepStatus, detail?: string) => void;

export interface WorkflowHost {
  runTask(
    kind: DevTaskKind,
    title: string,
    steps: ReadonlyArray<{ id: string; label: string }>,
    work: (step: Step, signal: AbortSignal) => Promise<string>,
  ): Promise<DeveloperState>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    step: Step,
    workStep?: string,
  ): Promise<ToolCallOutcome>;
  emit(): DeveloperState;
  notice(message: string): DeveloperState;
  audit(name: string, args: Record<string, unknown>, content: string): void;
  /** Copie de travail vérifiée (revérifiée si Jarvis vient de démarrer), pour son tsc. */
  repoRoot(): Promise<string | null>;
  nodePath(): Promise<string | null>;
  /** Outils de lecture de la copie, inscrits au journal (banc réel). */
  readTools(): Pick<ToolManager, 'schemas' | 'execute'>;
  /** La discussion garde la priorité : libère le modèle et attend la fin du tour. */
  pause(model: string, signal: AbortSignal): Promise<void>;
}

export interface WorkflowDeps {
  registry: ProviderRegistry;
  run: Runner;
  ollama: () => OllamaApi;
  store: CodeModelStore;
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  freeBytes: (path: string) => Promise<number | null>;
  benchDir: () => string;
  chatModel: () => string | null;
  /** Absent : catalogue de code complet (0.4.25). `modest` : aucun gros modèle. */
  machineProfile?: () => 'modest' | 'standard' | 'full' | undefined;
  now?: () => number;
  /** RAM et processeur (os par défaut ; remplaçable dans les tests). */
  system?: HardwareProbeDeps['os'];
}

export function emptyCodeModelState(
  env: Record<string, string | undefined>,
  platform: string,
): CodeModelState {
  return {
    hardware: null,
    calibration: null,
    calibrationModel: null,
    candidates: [],
    experts: {
      changes: expertsInRamChanges(env),
      instructions: expertsInRamInstructions(platform),
      confirmedAt: null,
    },
    validation: null,
    pull: null,
    benches: [],
    realBenches: [],
    installedModels: [],
    ollamaModels: [],
    ollamaModelsAt: null,
    ollamaListMessage: null,
  };
}

/**
 * Modèle de code, dans l'ordre imposé : matériel → étalonnage sur un modèle
 * déjà installé → configuration proposée (estimations) → validation →
 * téléchargement confirmé → banc de code → choix. Aucun téléchargement
 * avant la validation, aucune variable du serveur Ollama modifiée.
 */
function ollamaModelsFromFacts(facts: HardwareFacts | null): OllamaModelInfo[] {
  if (!facts || facts.ollama.status !== 'detected') return [];
  return facts.ollama.models.map((model) => ({
    name: model.name,
    sizeBytes: model.sizeBytes,
    parameterSize: model.parameterSize,
    quantizationLevel: model.quantization,
    supportsTools: model.supportsTools,
  }));
}

function mergeOllamaIntoFacts(
  facts: HardwareFacts,
  status: Awaited<ReturnType<OllamaApi['status']>>,
): HardwareFacts {
  if (status.status !== 'detected') {
    return {
      ...facts,
      ollama: {
        ...facts.ollama,
        status: status.status,
        version: status.version ?? facts.ollama.version,
        models: status.status === 'absent' ? [] : facts.ollama.models,
      },
    };
  }
  return {
    ...facts,
    ollama: {
      status: 'detected',
      version: status.version ?? facts.ollama.version,
      models: status.models.map((model) => ({
        name: model.name,
        sizeBytes: model.sizeBytes,
        parameterSize: model.parameterSize,
        quantization: model.quantizationLevel,
        supportsTools: model.supportsTools,
      })),
    },
  };
}

export class CodeModelWorkflow {
  private hardware: CodeModelState['hardware'] = null;
  private pullState: CodeModelState['pull'] = null;
  private ollamaSnapshot: {
    models: OllamaModelInfo[];
    at: number;
    message: string;
  } | null = null;
  private stored: Awaited<ReturnType<CodeModelStore['load']>> | null = null;

  constructor(
    private readonly host: WorkflowHost,
    private readonly deps: WorkflowDeps,
  ) {
    void deps.store.load().then((data) => {
      this.stored = data;
    });
  }

  private get now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  installed(): HardwareFacts['ollama']['models'] {
    if (this.hardware?.facts.ollama.status === 'detected') {
      return this.hardware.facts.ollama.models;
    }
    if (this.ollamaSnapshot) {
      return this.ollamaSnapshot.models.map((model) => ({
        name: model.name,
        sizeBytes: model.sizeBytes,
        parameterSize: model.parameterSize,
        quantization: model.quantizationLevel,
        supportsTools: model.supportsTools,
      }));
    }
    return [];
  }

  private resolvedOllamaModels(): OllamaModelInfo[] {
    if (this.ollamaSnapshot) return this.ollamaSnapshot.models;
    return ollamaModelsFromFacts(this.hardware?.facts ?? null);
  }

  state(): CodeModelState {
    const base = emptyCodeModelState(this.deps.env, this.deps.platform);
    const stored = this.stored;
    const facts = this.hardware?.facts ?? null;
    const ollamaModels = this.resolvedOllamaModels();
    const calibration = stored?.calibration ?? null;
    return {
      ...base,
      hardware: this.hardware,
      calibration,
      calibrationModel: facts
        ? (pickCalibrationModel(facts.ollama.models, this.deps.chatModel())?.name ?? null)
        : null,
      candidates: codeModelsOffered(this.deps.machineProfile?.()).map((spec) => ({
        spec,
        installed: this.installed().some((model) => model.name === spec.id),
        auto: facts ? predictModel(spec, facts, calibration, false) : null,
        experts:
          facts && spec.expertsInRam.supported
            ? predictModel(spec, facts, calibration, true)
            : null,
      })),
      experts: { ...base.experts, confirmedAt: stored?.expertsConfirmedAt ?? null },
      validation: stored?.validation ?? null,
      pull: this.pullState,
      benches: stored?.benches ?? [],
      realBenches: stored?.realBenches ?? [],
      installedModels: this.installed().map((model) => model.name),
      ollamaModels,
      ollamaModelsAt: this.ollamaSnapshot?.at ?? this.hardware?.at ?? null,
      ollamaListMessage:
        this.ollamaSnapshot?.message ??
        (facts?.ollama.status === 'detected'
          ? `${facts.ollama.models.length} modèle${facts.ollama.models.length === 1 ? '' : 's'} installé${facts.ollama.models.length === 1 ? '' : 's'}.`
          : null),
    };
  }

  private async ensureStored(): Promise<NonNullable<CodeModelWorkflow['stored']>> {
    this.stored = await this.deps.store.load();
    return this.stored;
  }

  /** Réglages de requête du modèle de code choisi ; un modèle hors catalogue garde des valeurs neutres. */
  optionsFor(modelId: string): OllamaCodeOptions {
    const spec = codeModelById(modelId);
    if (!spec) return { numCtx: 16_384, keepAlive: '30m' };
    const validation = this.stored?.validation;
    return codeModelOptions(spec, validation?.modelId === modelId && validation.expertsInRam);
  }

  /** Le téléchargement n'est permis que pour le modèle de la configuration validée. */
  pullAllowed(modelId: string): boolean {
    if (this.deps.machineProfile?.() === 'modest') return false;
    return this.stored?.validation?.modelId === modelId;
  }

  onPullProgress(modelId: string, status: string, completed: number, total: number): void {
    this.pullState = { modelId, status, completed, total, done: status === 'success' };
  }

  async refreshOllamaModels(): Promise<DeveloperState> {
    const status = await this.deps.ollama().status();
    this.ollamaSnapshot = {
      models: status.models,
      at: this.now,
      message: status.message,
    };
    if (this.hardware) {
      this.hardware = {
        ...this.hardware,
        facts: mergeOllamaIntoFacts(this.hardware.facts, status),
        at: this.now,
      };
    }
    return this.host.emit();
  }

  async checkHardware(): Promise<DeveloperState> {
    await this.ensureStored();
    const facts = await probeHardware({
      run: this.deps.run,
      ollama: this.deps.ollama(),
      home: this.deps.home,
      platform: this.deps.platform,
      env: this.deps.env,
      freeBytes: this.deps.freeBytes,
      os: this.deps.system,
    });
    this.hardware = { facts, report: checkHardware(facts), at: this.now };
    this.ollamaSnapshot = {
      models: facts.ollama.status === 'detected' ? ollamaModelsFromFacts(facts) : [],
      at: this.now,
      message:
        facts.ollama.status === 'detected'
          ? `${facts.ollama.models.length} modèle${facts.ollama.models.length === 1 ? '' : 's'} installé${facts.ollama.models.length === 1 ? '' : 's'}.`
          : 'Ollama ne répond pas : démarre le serveur puis rafraîchis la liste.',
    };
    return this.host.emit();
  }

  async calibrate(requested?: string): Promise<DeveloperState> {
    if (!this.hardware) return this.host.notice('Vérifie d’abord le matériel (étape 1).');
    if (this.hardware.facts.ollama.status !== 'detected')
      return this.host.notice(
        'Ollama ne répond pas : démarre-le, puis relance la vérification du matériel.',
      );
    const installed = this.installed();
    const model =
      (requested ? installed.find((m) => m.name === requested) : null) ??
      pickCalibrationModel(installed, this.deps.chatModel());
    if (!model)
      return this.host.notice(
        'Aucun modèle déjà installé pour étalonner : les estimations utiliseront des débits par défaut.',
      );
    return this.host.runTask(
      'calibrate',
      `Étalonner avec ${model.name} (déjà installé)`,
      [
        { id: 'auto', label: 'Placement normal (carte graphique)' },
        { id: 'cpu', label: 'Processeur seul (num_gpu 0)' },
        { id: 'estimate', label: 'Estimations des candidats' },
      ],
      async (step, signal) => {
        const runs = await runCalibration({
          registry: this.deps.registry,
          ollama: this.deps.ollama(),
          model,
          signal,
          onRun: (mode) => {
            if (mode === 'cpu') step('auto', 'done');
            step(mode, 'running');
          },
        });
        const describe = (run: (typeof runs)[number]) =>
          `${(run.outputTokens / (run.outputMs / 1000)).toFixed(1)} jetons/s`;
        step('auto', 'done', describe(runs[0]!));
        step('cpu', 'done', describe(runs[1]!));
        const calibration = calibrate(runs, this.now);
        this.stored = await this.deps.store.update({ calibration });
        step('estimate', 'done', 'estimations recalculées');
        return `Étalonnage terminé sur ${model.name}. Les chiffres proposés restent des estimations.`;
      },
    );
  }

  async confirmExperts(applied: boolean): Promise<DeveloperState> {
    this.stored = await this.deps.store.update({ expertsConfirmedAt: applied ? this.now : null });
    this.host.audit(
      'dev_variables_ollama',
      { applied },
      applied
        ? 'L’utilisateur dit avoir appliqué lui-même LLAMA_ARG_CPU_MOE et GGML_CUDA_NO_PINNED, puis redémarré Ollama.'
        : 'Experts en RAM abandonnés par l’utilisateur.',
    );
    return this.host.emit();
  }

  async validate(modelId: string, expertsInRam: boolean): Promise<DeveloperState> {
    if (!codeModelsOffered(this.deps.machineProfile?.()).some((spec) => spec.id === modelId)) {
      return this.host.notice('Ce modèle de code n’est pas proposé sur ce profil de machine.');
    }
    const stored = await this.ensureStored();
    const spec = codeModelById(modelId);
    if (!spec) return this.host.notice(`« ${modelId} » n’est pas dans le catalogue.`);
    if (!this.hardware) return this.host.notice('Vérifie d’abord le matériel (étape 1).');
    const calibrable = pickCalibrationModel(this.installed(), this.deps.chatModel()) !== null;
    if (!stored.calibration && calibrable)
      return this.host.notice('Lance d’abord l’étalonnage sur un modèle déjà installé (étape 1).');
    const useExperts = expertsInRam && spec.expertsInRam.supported;
    if (useExperts && !stored.expertsConfirmedAt)
      return this.host.notice(
        'Experts en RAM : applique d’abord les variables toi-même et confirme-le (étape 2).',
      );
    const prediction = predictModel(spec, this.hardware.facts, stored.calibration, useExperts);
    if (!prediction.fits)
      return this.host.notice(
        `${spec.label} ne tiendrait pas sur ce PC : ${prediction.notes.join(' ')}`,
      );
    if (prediction.diskOk === false)
      return this.host.notice('Pas assez de place sur le disque des modèles.');
    const validation = { modelId, expertsInRam: useExperts, at: this.now, prediction };
    this.stored = await this.deps.store.update({ validation });
    this.host.audit(
      'dev_valider_configuration',
      { modelId, expertsInRam: useExperts },
      `Configuration validée par l’utilisateur : ${spec.label}${useExperts ? ', experts en RAM' : ''}. Rien n’est téléchargé à cette étape.`,
    );
    return this.host.emit();
  }

  /**
   * Téléchargement confirmé d’un nom Ollama saisi par l’utilisateur (ex. deepseek-coder-v2:16b).
   * Aucune validation de catalogue ni d’étape matériel.
   */
  async pullOllamaModel(model: string): Promise<DeveloperState> {
    const name = model.trim();
    if (!name) return this.host.notice('Indique le nom exact du modèle Ollama à télécharger.');
    if (name.length > 100) return this.host.notice('Nom de modèle trop long.');
    this.pullState = null;
    return this.host.runTask(
      'pull',
      `Télécharger ${name} dans Ollama`,
      [
        { id: 'confirm', label: 'Ta confirmation' },
        { id: 'pull', label: 'Téléchargement (ollama pull)' },
        { id: 'verify', label: 'Présent dans Ollama' },
      ],
      async (step) => {
        const outcome = await this.host.callTool(
          'dev_pull_ollama_model',
          { model: name },
          step,
          'pull',
        );
        if (outcome.status !== 'ok') throw new Error(outcome.content);
        step('verify', 'running');
        await this.refreshOllamaModels();
        step('verify', 'done', 'listé par Ollama');
        return `${name} est téléchargé. Rafraîchis ou rouvre l’onglet si besoin.`;
      },
    );
  }

  async pull(modelId: string): Promise<DeveloperState> {
    if (this.deps.machineProfile?.() === 'modest') {
      return this.host.notice(
        'Profil modeste : les modèles de code ne sont pas proposés, et rien n’est téléchargé.',
      );
    }
    await this.ensureStored();
    if (!this.pullAllowed(modelId))
      return this.host.notice(
        'Valide d’abord cette configuration (étape 3) : aucun téléchargement avant.',
      );
    const spec = codeModelById(modelId)!;
    this.pullState = null;
    return this.host.runTask(
      'pull',
      `Télécharger ${spec.label}`,
      [
        { id: 'validated', label: 'Configuration validée' },
        { id: 'confirm', label: 'Ta confirmation' },
        { id: 'pull', label: 'Téléchargement (ollama pull)' },
        { id: 'verify', label: 'Présent dans Ollama' },
      ],
      async (step) => {
        step(
          'validated',
          'done',
          `validée le ${new Date(this.stored!.validation!.at).toLocaleString('fr-FR')}`,
        );
        const outcome = await this.host.callTool('dev_pull_model', { modelId }, step, 'pull');
        if (outcome.status !== 'ok') throw new Error(outcome.content);
        step('verify', 'running');
        await this.checkHardware();
        step('verify', 'done', 'listé par Ollama');
        return `${spec.label} est téléchargé. Lance maintenant le banc de code (étape 5).`;
      },
    );
  }

  /**
   * Banc réel sur le code de Jarvis, sur un modèle déjà installé : rien n'est
   * téléchargé, rien n'est choisi. Le résultat donne un score par rôle.
   */
  async realBenchmark(modelId: string): Promise<DeveloperState> {
    const stored = await this.ensureStored();
    const status = await this.deps.ollama().status();
    if (!status.models.some((model) => model.name === modelId))
      return this.host.notice(
        `« ${modelId} » n’est pas installé dans Ollama : le banc réel n’utilise que des modèles déjà présents, rien n’est téléchargé.`,
      );
    const root = await this.host.repoRoot();
    if (!root)
      return this.host.notice(
        'Choisis et vérifie d’abord la copie de travail (Réglages → Développeur).',
      );
    const nodePath = await this.host.nodePath();
    const tscPath = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const tsc = nodePath && existsSync(tscPath) ? { nodePath, tscPath } : null;
    const head = await this.deps.run({
      program: 'git',
      args: [...GIT_SAFE, 'rev-parse', 'HEAD'],
      cwd: root,
      timeoutMs: 15_000,
      display: 'git rev-parse HEAD',
    });
    const commit = head.code === 0 ? head.stdout.trim() : null;
    return this.host.runTask(
      'real-benchmark',
      `Banc réel sur le code de Jarvis : ${modelId}`,
      [
        ...REAL_BENCH_TASKS.map((task) => ({ id: task.id, label: task.label })),
        { id: 'metrics', label: 'Vitesse, RAM et carte graphique' },
      ],
      async (step, signal) => {
        const provider = createCodeAIProvider(this.deps.registry, {
          model: modelId,
          baseUrl: this.deps.ollama().baseUrl,
          options: this.optionsFor(modelId),
          fetch: patientFetch,
        });
        const result = await runRealBenchmark({
          provider,
          readTools: this.host.readTools(),
          repoRoot: root,
          commit,
          run: this.deps.run,
          ollama: this.deps.ollama(),
          tsc,
          nodePath,
          workDir: join(
            this.deps.benchDir(),
            `reel-${modelId.replace(/[^\w.-]+/g, '_')}-${this.now}`,
          ),
          signal,
          pause: () => this.host.pause(modelId, signal),
          onTask: (task, taskStatus, detail) => step(task.id, taskStatus, detail),
          now: this.deps.now,
        });
        const m = result.metrics;
        step(
          'metrics',
          'done',
          `${m.outputTokPerSec ?? '?'} jetons/s écrits, ${m.promptTokPerSec ?? '?'} lus${m.sizeVramBytes !== null ? `, ${(m.sizeVramBytes / 1e9).toFixed(1)} Go sur la carte` : ''}${m.ramUsedBytes !== null ? `, ${(m.ramUsedBytes / 1e9).toFixed(1)} Go en RAM` : ''}`,
        );
        const realBenches = [
          ...(stored.realBenches ?? []).filter((bench) => bench.model !== modelId),
          result,
        ];
        this.stored = await this.deps.store.update({ realBenches });
        const roles = result.roles
          .filter((role) => role.measured > 0)
          .map((role) => `${ROLE_LABELS[role.role]} ${role.passed}/${role.measured}`)
          .join(', ');
        return `Banc réel terminé pour ${modelId} : ${roles || 'rien de mesurable'}. Aucun modèle n’est choisi : c’est toi qui décides.`;
      },
    );
  }

  async benchmark(modelId: string): Promise<DeveloperState> {
    const stored = await this.ensureStored();
    const spec = codeModelById(modelId);
    if (!spec) return this.host.notice(`« ${modelId} » n’est pas dans le catalogue.`);
    const status = await this.deps.ollama().status();
    if (!status.models.some((model) => model.name === modelId))
      return this.host.notice(
        `${spec.label} n’est pas installé : valide la configuration puis télécharge-le d’abord.`,
      );
    const expertsInRam =
      stored.validation?.modelId === modelId ? stored.validation.expertsInRam : false;
    const root = await this.host.repoRoot();
    const nodePath = await this.host.nodePath();
    const tscPath = root ? join(root, 'node_modules', 'typescript', 'bin', 'tsc') : null;
    const tsc = nodePath && tscPath && existsSync(tscPath) ? { nodePath, tscPath } : null;
    return this.host.runTask(
      'benchmark',
      `Banc de code : ${spec.label}${expertsInRam ? ' (experts en RAM)' : ''}`,
      [
        ...BENCH_TASKS.map((task) => ({ id: task.id, label: task.label })),
        { id: 'metrics', label: 'Vitesse, RAM et carte graphique' },
      ],
      async (step, signal) => {
        const provider = createCodeAIProvider(this.deps.registry, {
          model: modelId,
          baseUrl: this.deps.ollama().baseUrl,
          options: codeModelOptions(spec, expertsInRam),
        });
        step(
          'metrics',
          'pending',
          tsc
            ? undefined
            : 'tsc indisponible : installe les dépendances de la copie de travail pour vérifier la modification et la correction',
        );
        const result = await runCodeBenchmark({
          provider,
          expertsInRam,
          ollama: this.deps.ollama(),
          run: this.deps.run,
          workDir: join(this.deps.benchDir(), `${modelId.replace(/[^\w.-]+/g, '_')}-${this.now}`),
          tsc,
          signal,
          onTask: (task, taskStatus, detail) => step(task.id, taskStatus, detail),
          now: this.deps.now,
        });
        const m = result.metrics;
        step(
          'metrics',
          'done',
          `${m.outputTokPerSec ?? '?'} jetons/s écrits, ${m.promptTokPerSec ?? '?'} lus${m.sizeVramBytes !== null ? `, ${(m.sizeVramBytes / 1e9).toFixed(1)} Go sur la carte` : ''}${m.ramUsedBytes !== null ? `, ${(m.ramUsedBytes / 1e9).toFixed(1)} Go en RAM` : ''}`,
        );
        const benches = [
          ...(this.stored?.benches ?? []).filter(
            (bench) => !(bench.model === modelId && bench.expertsInRam === expertsInRam),
          ),
          result,
        ];
        this.stored = await this.deps.store.update({ benches });
        return `Banc terminé : appels d’outils ${result.summary.toolCalls}, modification ${result.summary.edit === null ? 'non vérifiable' : result.summary.edit ? 'réussie' : 'ratée'}, correction ${result.summary.fix === null ? 'non vérifiable' : result.summary.fix ? 'réussie' : 'ratée'}.`;
      },
    );
  }
}
