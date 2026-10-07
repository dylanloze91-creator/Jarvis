import type { IpcMain, WebContents } from 'electron';
import {
  MIN_EXAMPLES_FOR_TRAIN,
  exampleFromTurn,
  planLocalLearningTrain,
  randomId,
  type ChatMessage,
  type LocalLearningRuntimeStatus,
  type Settings,
} from '@jarvis/core';
import type { LocalLearningStore } from './store.js';
import { runQloraTrain } from './trainer.js';
import { createOllamaApi } from '../developer/models/ollamaApi.js';
import { IpcChannel } from '../../shared/ipc.js';

type SaveSettings = (patch: Partial<Settings>) => Promise<Settings>;

export class LocalLearningController {
  private running = false;
  private line: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private broadcast: ((status: LocalLearningRuntimeStatus) => void) | null = null;

  constructor(
    private readonly store: LocalLearningStore,
    private readonly getSettings: () => Settings,
    private readonly saveSettings: SaveSettings,
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
    if (all.length < MIN_EXAMPLES_FOR_TRAIN) return;
    this.scheduleTrain();
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
    if (examples.length < MIN_EXAMPLES_FOR_TRAIN) return;

    const plan = planLocalLearningTrain(settings.model);
    this.running = true;
    this.line = `Apprentissage local en cours (${plan.trainBaseModel})…`;
    this.emit();

    const api = createOllamaApi(settings.baseUrl || 'http://127.0.0.1:11434');
    const running = await api.running();
    for (const model of running) {
      await api.unload(model.name);
    }

    const outcome = await runQloraTrain(this.store, plan, examples, (log) => {
      if (log.startsWith('OK')) this.line = `Apprentissage local : finalisation…`;
      this.emit();
    });

    this.running = false;
    if (outcome.ok && outcome.ollamaModel) {
      const hint = plan.sameBaseAsChat
        ? `Jarvis utilise ton adaptateur sur ${plan.trainBaseModel}.`
        : `Adaptateur sur ${plan.trainBaseModel} (discussion : ${plan.chatModel}).`;
      await this.saveSettings({
        localLearning: {
          ...settings.localLearning,
          activeOllamaModel: outcome.ollamaModel,
          trainBaseModel: plan.trainBaseModel,
          lastTrainedAt: Date.now(),
          lastTrainExampleCount: examples.length,
          statusHint: hint,
        },
      });
      this.line = hint;
    } else {
      this.line = outcome.error
        ? `Apprentissage local reporté : ${outcome.error}`
        : 'Apprentissage local reporté.';
      setTimeout(() => {
        if (!this.running) {
          this.line = null;
          this.emit();
        }
      }, 120_000);
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
