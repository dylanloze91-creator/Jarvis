import { spawn } from 'node:child_process';
import { freemem } from 'node:os';
import type { IpcMain, WebContents } from 'electron';
import {
  MIN_EXAMPLES_FOR_TRAIN,
  assessTrainResources,
  capWatchTopics,
  decideAdapterAdoption,
  exampleFromTurn,
  ingestWebResults,
  learningMetrics,
  periodicSearchAllowed,
  planLocalLearningTrain,
  randomId,
  rollbackAdapter,
  selectTrainRows,
  skillTrainRows,
  type ChatMessage,
  type LearningRecord,
  type LocalLearningRuntimeStatus,
  type Settings,
  type WebHit,
} from '@jarvis/core';
import type { LocalLearningStore } from './store.js';
import { ensureLearningPythonDeps } from './pythonEnv.js';
import { createOllamaApi } from '../developer/models/ollamaApi.js';
import { IpcChannel } from '../../shared/ipc.js';

type SaveSettings = (patch: Partial<Settings>) => Promise<Settings>;

export class LocalLearningController {
  private running = false;
  private line: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private periodic: ReturnType<typeof setInterval> | null = null;
  private broadcast: ((status: LocalLearningRuntimeStatus) => void) | null = null;

  constructor(
    private readonly store: LocalLearningStore,
    private readonly getSettings: () => Settings,
    private readonly saveSettings: SaveSettings,
    private readonly userData: () => string,
    private readonly extra?: {
      search?: (query: string) => Promise<WebHit[]>;
      listLearning?: () => Promise<LearningRecord[]>;
      applyLearning?: (record: LearningRecord) => Promise<LearningRecord[]>;
      setLearningStatus?: (id: string, status: LearningRecord['status']) => Promise<LearningRecord[]>;
      deleteLearning?: (id: string) => Promise<LearningRecord[]>;
      correctLearning?: (id: string, content: string) => Promise<LearningRecord[]>;
      restoreLearning?: (id: string) => Promise<LearningRecord[]>;
      readEval?: () => Promise<{ previous: number | null; next: number | null } | null>;
      /** Succès réels déjà enregistrés par modelRunMemory. Absent : les taux restent vides. */
      readRuns?: () => Promise<Array<{ success: boolean }>>;
      measureResources?: () => Promise<{ ramBytes: number | null; vramBytes: number | null }>;
    },
  ) {}

  setBroadcast(fn: (status: LocalLearningRuntimeStatus) => void): void {
    this.broadcast = fn;
  }

  status(): LocalLearningRuntimeStatus {
    return { running: this.running, line: this.line };
  }

  private emit(): void {
    this.broadcast?.(this.status());
  }

  async recordTurn(conversationId: string, messages: ChatMessage[]): Promise<void> {
    const settings = this.getSettings();
    if (!settings.localLearning?.enabled) return;
    if (settings.provider !== 'ollama') return;

    const { example } = exampleFromTurn({
      conversationId,
      messages,
      idFactory: () => randomId(),
    });
    if (!example) return;
    const all = await this.store.append(example);
    if (this.getSettings().localLearning?.autoTrain === true && all.length >= MIN_EXAMPLES_FOR_TRAIN) {
      this.scheduleTrain();
    }
  }

  private scheduleTrain(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.trainNow();
    }, 45_000);
  }

  async trainNow(): Promise<void> {
    const settings = this.getSettings();
    if (!settings.localLearning?.enabled || this.running) return;

    const examples = await this.store.list();
    const selected = selectTrainRows(examples);
    if (selected.skipReason) {
      this.line = selected.skipReason;
      this.emit();
      return;
    }
    const measured = this.extra?.measureResources
      ? await this.extra.measureResources()
      : { ramBytes: freemem(), vramBytes: await probeVramBytes() };
    const resources = assessTrainResources({
      examples: selected.train.length + selected.validation.length,
      ramBytes: measured.ramBytes,
      vramBytes: measured.vramBytes,
    });
    if (!resources.ok) {
      this.line = resources.reason;
      this.emit();
      return;
    }

    const plan = planLocalLearningTrain(settings.model);
    this.running = true;
    this.line = `Apprentissage local en cours (${plan.trainBaseModel})…`;
    this.emit();

    const deps = await ensureLearningPythonDeps(this.userData(), (msg) => {
      this.line = msg;
      this.emit();
    });
    if (!deps.ok || !deps.python) {
      this.running = false;
      this.line = `Apprentissage local reporté : ${deps.error ?? 'installation Python impossible.'}`;
      this.emit();
      setTimeout(() => {
        if (!this.running) {
          this.line = null;
          this.emit();
        }
      }, 120_000);
      return;
    }
    const pythonPath = deps.python;
    if (!settings.localLearning?.pythonDepsReady) {
      await this.saveSettings({
        localLearning: { ...settings.localLearning, pythonDepsReady: true },
      });
    }

    const api = createOllamaApi(settings.baseUrl || 'http://127.0.0.1:11434');
    const running = await api.running();
    for (const model of running) {
      await api.unload(model.name);
    }

    await this.store.archiveAdapter();
    await this.store.writeSplit(selected.train, selected.validation);
    let outcome: { ok: boolean; error?: string; ollamaModel?: string };
    try {
      const { runQloraTrain } = await import('./trainer.js');
      outcome = await runQloraTrain(
        this.store,
        plan,
        selected.train as import('@jarvis/core').LocalLearningExample[],
        (log) => {
          if (log.startsWith('OK')) this.line = `Apprentissage local : finalisation…`;
          this.emit();
        },
        pythonPath,
        false,
      );
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const scores = (await this.extra?.readEval?.().catch(() => null)) ?? null;
    const decision = decideAdapterAdoption({
      hasPrevious: Boolean(settings.localLearning?.activeOllamaModel),
      trainOk: outcome.ok,
      previousScore: scores?.previous ?? null,
      nextScore: scores?.next ?? null,
    });
    this.running = false;
    if (!decision.adopt) {
      await this.store.restoreAdapter();
    }
    let adoptedModel = outcome.ollamaModel;
    if (decision.adopt && !adoptedModel) {
      const { publishTrainedAdapter } = await import('./trainer.js');
      const published = await publishTrainedAdapter(this.store);
      if (!published.ok || !published.ollamaModel) {
        await this.store.restoreAdapter();
        this.line = published.error ?? 'Publication de l’adaptateur refusée. L’ancien reste en place.';
        await this.saveSettings({
          localLearning: { ...settings.localLearning, lastEvalNote: this.line.slice(0, 240) },
        });
        this.emit();
        return;
      }
      adoptedModel = published.ollamaModel;
    }
    if (decision.adopt && adoptedModel) {
      const hint = `${decision.reason} Socle ${plan.trainBaseModel}. Discussion : ${settings.model}.`;
      await this.saveSettings({
        localLearning: {
          ...settings.localLearning,
          activeOllamaModel: adoptedModel,
          previousOllamaModel: settings.localLearning?.activeOllamaModel,
          trainBaseModel: plan.trainBaseModel,
          lastTrainedAt: Date.now(),
          lastTrainExampleCount: selected.train.length,
          statusHint: hint.slice(0, 240),
          lastEvalNote: decision.reason.slice(0, 240),
        },
      });
      this.line = hint;
    } else {
      this.line = decision.adopt ? (outcome.error ?? 'Apprentissage local reporté.') : decision.reason;
      await this.saveSettings({
        localLearning: {
          ...settings.localLearning,
          lastEvalNote: this.line.slice(0, 240),
        },
      });
    }
    this.emit();
  }

  async rollback(): Promise<LocalLearningRuntimeStatus> {
    const settings = this.getSettings();
    const files = await this.store.swapAdapters();
    const back = rollbackAdapter({
      active: settings.localLearning?.activeOllamaModel,
      previous: settings.localLearning?.previousOllamaModel,
    });
    if (files && !settings.localLearning?.previousOllamaModel) {
      back.note = 'Dossier de l’adaptateur précédent restauré.';
    }
    await this.saveSettings({
      localLearning: {
        ...settings.localLearning,
        ...(back.active ? { activeOllamaModel: back.active } : { activeOllamaModel: undefined }),
        ...(back.previous ? { previousOllamaModel: back.previous } : {}),
        statusHint: back.note.slice(0, 240),
      },
    });
    this.line = back.note;
    this.emit();
    return this.status();
  }

  async snapshot(): Promise<{
    records: LearningRecord[];
    metrics: ReturnType<typeof learningMetrics>;
    line: string | null;
    running: boolean;
  }> {
    const records = (await this.extra?.listLearning?.().catch(() => [])) ?? [];
    const runs = (await this.extra?.readRuns?.().catch(() => [])) ?? [];
    const missionTotal = runs.length;
    const missionSuccesses = runs.filter((run) => run.success).length;
    const settings = this.getSettings();
    return {
      records: records.slice(0, 12),
      metrics: learningMetrics({
        records,
        ...(missionTotal > 0 ? { missionSuccesses, missionTotal } : {}),
      }),
      line: this.line ?? settings.localLearning?.lastEvalNote ?? null,
      running: this.running,
    };
  }

  async setRecordStatus(id: string, status: LearningRecord['status']): Promise<LearningRecord[]> {
    return (await this.extra?.setLearningStatus?.(id, status)) ?? [];
  }

  async removeRecord(id: string): Promise<LearningRecord[]> {
    return (await this.extra?.deleteLearning?.(id)) ?? [];
  }

  async correctRecord(id: string, content: string): Promise<LearningRecord[]> {
    return (await this.extra?.correctLearning?.(id, content)) ?? [];
  }

  async restoreRecord(id: string): Promise<LearningRecord[]> {
    return (await this.extra?.restoreLearning?.(id)) ?? [];
  }

  async exportSkillRows(): Promise<ReturnType<typeof skillTrainRows>> {
    const records = (await this.extra?.listLearning?.().catch(() => [])) ?? [];
    return skillTrainRows(records);
  }

  armPeriodic(): void {
    if (this.periodic) return;
    this.periodic = setInterval(() => void this.runWatchSearch(), 6 * 60 * 60 * 1000);
    setTimeout(() => void this.runWatchSearch(), 60_000);
  }

  async runWatchSearch(): Promise<void> {
    const settings = this.getSettings();
    if (!periodicSearchAllowed(settings.developer.periodicWebResearch)) return;
    if (!this.extra?.search || !this.extra.applyLearning) return;
    const topics = capWatchTopics(settings.developer.watchTopics ?? []);
    for (const topic of topics) {
      try {
        const hits = await this.extra.search(topic);
        const ingested = ingestWebResults({
          ok: true,
          hits,
          now: Date.now(),
          idFactory: () => randomId(),
        });
        for (const record of ingested.records) await this.extra.applyLearning(record);
        this.line = ingested.note;
      } catch (error) {
        this.line = ingestWebResults({
          ok: false,
          error: error instanceof Error ? error.message : 'réseau',
          now: Date.now(),
          idFactory: () => 'net',
        }).note;
        this.emit();
        return;
      }
    }
    this.emit();
  }

  registerIpc(ipcMain: IpcMain): void {
    ipcMain.handle(IpcChannel.localLearningStatus, () => this.status());
  }

  pushTo(sender: WebContents): void {
    if (!sender.isDestroyed()) {
      sender.send(IpcChannel.localLearningEvent, this.status());
    }
  }
}

/** Mémoire vidéo libre, en octets. Null si nvidia-smi est absent ou illisible. */
function probeVramBytes(): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 4_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += String(chunk);
    });
    const finish = (value: number | null): void => {
      clearTimeout(timer);
      resolve(value);
    };
    child.on('error', () => finish(null));
    child.on('close', () => {
      const mib = Number(out.trim().split(/\s+/)[0]);
      finish(Number.isFinite(mib) && mib > 0 ? Math.round(mib * 1024 * 1024) : null);
    });
  });
}
