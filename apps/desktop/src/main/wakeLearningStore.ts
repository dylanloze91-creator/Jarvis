import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_WAKE_SAMPLE_CAP,
  WAKE_CLIP_SAMPLES,
  WAKE_FEATURE_SIZE,
  encodeWav,
  parseWakeVerifierModel,
  pruneWakeStats,
  samplesOverCap,
  shouldRetrain,
  summarizeWakeStats,
  trainWakeVerifier,
  trainingSet,
  type WakeSampleCap,
  type WakeSampleEntry,
  type WakeSampleSource,
  type WakeStatEvent,
  type WakeStatKind,
  type WakeVerifierModel,
} from '@jarvis/core';
import type { WakeLearningSampleInput, WakeLearningStatus } from '../shared/ipc.js';

interface IndexFile {
  entries: WakeSampleEntry[];
  stats: WakeStatEvent[];
  newSinceTraining: number;
}

const ID = /^[a-z0-9-]{1,64}$/;
const SOURCES: WakeSampleSource[] = ['wake', 'retry', 'enrollment', 'background'];

/** Valide ce qui vient du renderer : jamais de chemin, de texte ni de taille arbitraire. */
export function validateSampleInput(input: unknown): WakeLearningSampleInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<WakeLearningSampleInput>;
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null;
  if (value.label !== 'positive' && value.label !== 'negative') return null;
  if (!value.source || !SOURCES.includes(value.source)) return null;
  if (!Array.isArray(value.features) || value.features.length !== WAKE_FEATURE_SIZE) return null;
  if (!value.features.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  if (value.source === 'background') return { ...value, clip: undefined } as WakeLearningSampleInput;
  if (!(value.clip instanceof Float32Array) || value.clip.length === 0 || value.clip.length > WAKE_CLIP_SAMPLES) return null;
  return value as WakeLearningSampleInput;
}

/**
 * Extraits de réveil et vérificateur personnel, uniquement sous
 * `userData/wake-learning/` : `index.json` (étiquettes, caractéristiques,
 * compteurs), `clips/<id>.wav` (2 s, 16 kHz), `verifier.json`. Rien n'est
 * envoyé ni journalisé en clair (le journal ne voit que des nombres).
 */
export class WakeLearningStore {
  private queue: Promise<unknown> = Promise.resolve();
  private cachedModel: WakeVerifierModel | null | undefined;

  constructor(
    private readonly root: () => string,
    private readonly log: (line: string) => void = () => undefined,
    private readonly cap: WakeSampleCap = DEFAULT_WAKE_SAMPLE_CAP,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private get dir(): string {
    return join(this.root(), 'wake-learning');
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async readIndex(): Promise<IndexFile> {
    try {
      const parsed = JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')) as Partial<IndexFile>;
      return {
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        stats: Array.isArray(parsed.stats) ? parsed.stats : [],
        newSinceTraining: typeof parsed.newSinceTraining === 'number' ? parsed.newSinceTraining : 0,
      };
    } catch {
      return { entries: [], stats: [], newSinceTraining: 0 };
    }
  }

  private async writeJson(name: string, value: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, name);
    await writeFile(`${target}.tmp`, JSON.stringify(value), 'utf8');
    await rename(`${target}.tmp`, target);
  }

  async model(): Promise<WakeVerifierModel | null> {
    if (this.cachedModel !== undefined) return this.cachedModel;
    try {
      this.cachedModel = parseWakeVerifierModel(JSON.parse(await readFile(join(this.dir, 'verifier.json'), 'utf8')));
    } catch {
      this.cachedModel = null;
    }
    return this.cachedModel;
  }

  status(): Promise<WakeLearningStatus> {
    return this.serial(async () => this.describe(await this.readIndex()));
  }

  private async describe(index: IndexFile): Promise<WakeLearningStatus> {
    const model = await this.model();
    const clips = index.entries.filter((entry) => entry.source !== 'background');
    return {
      positives: index.entries.filter((entry) => entry.label === 'positive').length,
      negatives: index.entries.filter((entry) => entry.label === 'negative').length,
      clips: clips.length,
      clipBytes: clips.reduce((sum, entry) => sum + entry.bytes, 0),
      enrollment: index.entries.filter((entry) => entry.source === 'enrollment').length,
      maxClips: this.cap.maxClips,
      maxClipBytes: this.cap.maxClipBytes,
      stats: summarizeWakeStats(index.stats, this.now()),
      model: model
        ? {
            trainedAt: model.trainedAt,
            positives: model.positives,
            negatives: model.negatives,
            vetoEnabled: model.vetoEnabled,
            vetoThreshold: model.vetoThreshold,
            rescueThreshold: model.rescueThreshold,
            cvRecall: model.cvRecall,
            cvRejection: model.cvRejection,
          }
        : null,
    };
  }

  /** Ajoute un exemple étiqueté ; réentraîne après 5 nouveaux. Renvoie le modèle s'il a changé. */
  addSample(raw: unknown): Promise<{ model: WakeVerifierModel | null; retrained: boolean } | null> {
    const input = validateSampleInput(raw);
    if (!input) return Promise.resolve(null);
    return this.serial(async () => {
      const index = await this.readIndex();
      if (index.entries.some((entry) => entry.id === input.id)) return { model: await this.model(), retrained: false };
      let bytes = 0;
      if (input.clip) {
        const wav = encodeWav(input.clip, 16000);
        await mkdir(join(this.dir, 'clips'), { recursive: true });
        await writeFile(join(this.dir, 'clips', `${input.id}.wav`), wav);
        bytes = wav.byteLength;
      }
      index.entries.push({
        id: input.id,
        label: input.label,
        source: input.source,
        createdAt: this.now(),
        bytes,
        features: input.features,
      });
      for (const id of samplesOverCap(index.entries, this.cap)) {
        index.entries = index.entries.filter((entry) => entry.id !== id);
        await unlink(join(this.dir, 'clips', `${id}.wav`)).catch(() => undefined);
      }
      index.newSinceTraining += 1;
      const retrained = shouldRetrain(index.newSinceTraining, input.source === 'enrollment' && index.newSinceTraining >= 5);
      if (retrained) await this.train(index);
      await this.writeJson('index.json', index);
      return { model: await this.model(), retrained };
    });
  }

  retrain(): Promise<WakeVerifierModel | null> {
    return this.serial(async () => {
      const index = await this.readIndex();
      await this.train(index);
      await this.writeJson('index.json', index);
      return this.model();
    });
  }

  private async train(index: IndexFile): Promise<void> {
    const started = Date.now();
    const model = trainWakeVerifier(trainingSet(index.entries), { now: this.now() });
    index.newSinceTraining = 0;
    if (!model) {
      this.log(`[apprentissage] pas encore de vérificateur (${count(index, 'positive')} positifs, ${count(index, 'negative')} négatifs)`);
      return;
    }
    await this.writeJson('verifier.json', model);
    this.cachedModel = model;
    this.log(
      `[apprentissage] vérificateur entraîné en ${Date.now() - started} ms : ${model.positives} positifs, ${model.negatives} négatifs, ` +
        `veto ${model.vetoEnabled ? `actif sous ${model.vetoThreshold.toFixed(2)}` : 'inactif'}, rattrapage ${model.rescueThreshold === null ? 'inactif' : `au-dessus de ${model.rescueThreshold.toFixed(2)}`}`,
    );
  }

  recordStats(kinds: unknown): Promise<void> {
    const valid = Array.isArray(kinds)
      ? kinds.filter((kind): kind is WakeStatKind => kind === 'success' || kind === 'miss' || kind === 'false-wake')
      : [];
    if (valid.length === 0) return Promise.resolve();
    return this.serial(async () => {
      const index = await this.readIndex();
      const at = this.now();
      index.stats = pruneWakeStats([...index.stats, ...valid.map((kind) => ({ at, kind }))], at);
      await this.writeJson('index.json', index);
    });
  }

  /** « Effacer » : supprime extraits et caractéristiques. Le vérificateur et les compteurs restent. */
  clearSamples(): Promise<WakeLearningStatus> {
    return this.serial(async () => {
      const index = await this.readIndex();
      await rm(join(this.dir, 'clips'), { recursive: true, force: true });
      const next = { ...index, entries: [], newSinceTraining: 0 };
      await this.writeJson('index.json', next);
      this.log('[apprentissage] extraits effacés');
      return this.describe(next);
    });
  }

  /** « Réinitialiser » : tout supprime, retour à la détection 0.4.16. */
  reset(): Promise<WakeLearningStatus> {
    return this.serial(async () => {
      await rm(this.dir, { recursive: true, force: true });
      this.cachedModel = null;
      this.log('[apprentissage] réinitialisé : détection de base');
      return this.describe({ entries: [], stats: [], newSinceTraining: 0 });
    });
  }

  /** Taille réelle du dossier des extraits (vérification du plafond). */
  async clipFileBytes(id: string): Promise<number> {
    try {
      return (await stat(join(this.dir, 'clips', `${id}.wav`))).size;
    } catch {
      return 0;
    }
  }
}

function count(index: IndexFile, label: 'positive' | 'negative'): number {
  return index.entries.filter((entry) => entry.label === label).length;
}
