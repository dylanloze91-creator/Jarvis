import { statfs } from 'node:fs/promises';
import { checkOllamaStatus, type HealthReport, type Settings } from '@jarvis/core';
import { inspectVoiceAssets, currentVoiceAssetsRoot } from '../voiceAssetsProtocol.js';
import type { HealthProbeSet } from './collect.js';
import { collectHealthReport } from './collect.js';

export interface HealthRuntimeDeps {
  getSettings: () => Settings;
  userData: () => string;
  ollamaBaseUrl: () => string;
  voiceMissing?: HealthProbeSet['voiceMissing'];
  piperReady: () => Promise<boolean>;
  spotify: () => Promise<{ tokenOk: boolean; speakerVisible: boolean | null }>;
  google: () => Promise<{ connected: boolean; needsReconsent: boolean }>;
  phoneEnabled: () => boolean;
  phonePublished: () => Promise<boolean>;
  speakersEnabled: () => boolean;
  speakersHeard: () => Promise<boolean>;
  robotReachable: () => Promise<boolean>;
  backupState: () => Promise<{ lastAt: number | null; ok: boolean }>;
  vaultReady: () => boolean;
  broadcast: (report: HealthReport) => void;
}

/** Bilan lancé après l'affichage de la fenêtre. Lecture seule. */
export class HealthMonitor {
  private report: HealthReport | null = null;
  private pending: Promise<HealthReport> | null = null;

  constructor(private readonly deps: HealthRuntimeDeps) {}

  latest(): HealthReport | null {
    return this.report;
  }

  async run(): Promise<HealthReport> {
    if (this.pending) return this.pending;
    const job = collectHealthReport(this.deps.getSettings(), this.probes())
      .then((report) => {
        this.report = report;
        this.deps.broadcast(report);
        return report;
      })
      .finally(() => {
        if (this.pending === job) this.pending = null;
      });
    this.pending = job;
    return job;
  }

  private probes(): HealthProbeSet {
    return {
      ollama: async (signal) => {
        const status = await checkOllamaStatus(this.deps.ollamaBaseUrl(), { timeoutMs: 2500 });
        if (signal.aborted) throw new Error('timeout');
        return status.status === 'detected';
      },
      installedModels: async () => {
        const status = await checkOllamaStatus(this.deps.ollamaBaseUrl(), { timeoutMs: 2500 });
        return status.models.map((model) => model.name);
      },
      voiceMissing: this.deps.voiceMissing ?? (async () => {
        const files = await inspectVoiceAssets(currentVoiceAssetsRoot());
        return files.filter((file) => !file.exists || file.size < file.minBytes).length;
      }),
      piperReady: () => this.deps.piperReady(),
      spotify: () => this.deps.spotify(),
      google: () => this.deps.google(),
      phonePublished: () => this.deps.phonePublished(),
      speakersHeard: () => this.deps.speakersHeard(),
      robotReachable: () => this.deps.robotReachable(),
      printerReachable: async () => false,
      diskFree: async () => {
        const info = await statfs(this.deps.userData());
        return Number(info.bavail) * Number(info.bsize);
      },
      backupState: () => this.deps.backupState(),
      vaultReady: async () => this.deps.vaultReady(),
      phoneEnabled: () => this.deps.phoneEnabled(),
      speakersEnabled: () => this.deps.speakersEnabled(),
      printerConfigured: () => false,
    };
  }
}
