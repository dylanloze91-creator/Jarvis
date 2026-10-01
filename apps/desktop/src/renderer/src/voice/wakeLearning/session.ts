import {
  END_OF_SPEECH_RMS,
  WAKE_CLIP_SAMPLES,
  WAKE_RETRY_WINDOW_MS,
  WakeLabeler,
  classifyWakeOutcome,
  computeRms,
  fixedClip,
  resampleLinear,
  type WakeCandidateReport,
  type WakeLabelerOutput,
  type WakeVerifierModel,
} from '@jarvis/core';
import type { JarvisApi, WakeLearningSampleInput } from '../../../../shared/ipc';
import { computeWakeFeatures } from './featureRunner';

/** Un fond sonore (sans « Jarvis ») au plus toutes les 2 minutes, comme exemple négatif. */
const BACKGROUND_INTERVAL_MS = 120_000;
const EXPIRE_INTERVAL_MS = 5_000;

interface PendingClip {
  clip: Float32Array;
  features: number[];
}

type LearningApi = JarvisApi['wakeLearning'];

/**
 * Apprentissage du réveil côté interface : reçoit chaque candidat de la
 * couche de vérification, l'issue de la dictée, et envoie au main les
 * exemples étiquetés (caractéristiques + extrait). Rien n'est gardé ici
 * au-delà de la fenêtre de reprise.
 */
export class WakeLearningSession {
  model: WakeVerifierModel | null = null;
  /** Pendant l'enrôlement, les réveils ne lancent pas de dictée. */
  enrolling = false;

  private labeler = new WakeLabeler();
  private pending = new Map<string, PendingClip>();
  private currentWakeId: string | null = null;
  private lastCandidateAt = 0;
  private lastBackgroundAt = Date.now();
  private background = new Float32Array(WAKE_CLIP_SAMPLES);
  private backgroundFill = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: () => LearningApi | undefined,
    private readonly log: (line: string) => void = () => undefined,
    private readonly features: (clip: Float32Array) => Promise<number[] | null> = computeWakeFeatures,
    private readonly now: () => number = Date.now,
  ) {}

  /** Relit le modèle enregistré (démarrage, Effacer, Réinitialiser). */
  async reload(): Promise<WakeVerifierModel | null> {
    this.model = (await this.api()?.model().catch(() => null)) ?? null;
    return this.model;
  }

  start(): void {
    void this.reload();
    this.timer ??= setInterval(() => this.apply(this.labeler.expire(this.now())), EXPIRE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.pending.clear();
    this.labeler = new WakeLabeler();
    this.currentWakeId = null;
  }

  readonly computeFeatures = (clip: Float32Array): Promise<number[] | null> => this.features(clip);

  readonly onCandidate = (report: WakeCandidateReport): void => {
    const at = this.now();
    this.lastCandidateAt = at;
    const id = crypto.randomUUID();
    if (report.features) this.pending.set(id, { clip: report.clip, features: report.features });
    if (report.decision.accept) this.currentWakeId = id;
    this.apply(this.labeler.candidate({ id, at, accepted: report.decision.accept }));
  };

  /** Issue de la dictée lancée par le dernier réveil accepté. */
  outcome(command: string, failed = false): void {
    const id = this.currentWakeId;
    this.currentWakeId = null;
    if (!id) return;
    this.apply(this.labeler.outcome(id, classifyWakeOutcome(command, failed), this.now()));
  }

  /** Audio de veille : de temps en temps, 2 s sans « Jarvis » deviennent un exemple négatif. */
  pushIdleAudio(frame: Float32Array, sampleRate: number): void {
    const at16k = sampleRate === 16_000 ? frame : resampleLinear(frame, sampleRate, 16_000);
    if (at16k.length >= this.background.length) {
      this.background.set(at16k.subarray(at16k.length - this.background.length));
    } else {
      this.background.copyWithin(0, at16k.length);
      this.background.set(at16k, this.background.length - at16k.length);
    }
    this.backgroundFill = Math.min(this.background.length, this.backgroundFill + at16k.length);
    const at = this.now();
    if (this.backgroundFill < this.background.length || at - this.lastBackgroundAt < BACKGROUND_INTERVAL_MS) return;
    // Seulement du son (un silence n'apprend rien) et loin de tout candidat.
    if (computeRms(this.background) < END_OF_SPEECH_RMS || at - this.lastCandidateAt < WAKE_RETRY_WINDOW_MS) return;
    this.lastBackgroundAt = at;
    const clip = fixedClip(this.background.slice());
    void this.features(clip).then((features) => {
      // Un candidat juste après : l'extrait contenait peut-être « Jarvis ».
      setTimeout(() => {
        if (!features || this.lastCandidateAt >= at) return;
        void this.send({ id: crypto.randomUUID(), label: 'negative', source: 'background', features });
      }, WAKE_RETRY_WINDOW_MS);
    });
  }

  /** Une prise d'enrôlement (« Jarvis » dit à la demande) : exemple positif. */
  async addEnrollment(clip: Float32Array): Promise<boolean> {
    const fixed = fixedClip(clip);
    const features = await this.features(fixed);
    if (!features) return false;
    await this.send({ id: crypto.randomUUID(), label: 'positive', source: 'enrollment', features, clip: fixed });
    return true;
  }

  private apply(output: WakeLabelerOutput): void {
    for (const id of output.discard) this.pending.delete(id);
    for (const decision of output.labels) {
      const item = this.pending.get(decision.id);
      this.pending.delete(decision.id);
      if (!item) continue;
      void this.send({
        id: decision.id,
        label: decision.label,
        source: decision.reason === 'retry' ? 'retry' : 'wake',
        features: item.features,
        clip: item.clip,
      });
    }
    if (output.stats.length > 0) void this.api()?.recordStats(output.stats).catch(() => undefined);
  }

  private async send(input: WakeLearningSampleInput): Promise<void> {
    const result = await this.api()
      ?.addSample(input)
      .catch(() => null);
    if (result?.retrained) {
      this.model = result.model;
      this.log(
        result.model
          ? `vérificateur réentraîné (${result.model.positives} positifs, ${result.model.negatives} négatifs, veto ${result.model.vetoEnabled ? 'actif' : 'inactif'})`
          : 'vérificateur : pas encore assez d’exemples',
      );
    }
  }
}

export const wakeLearningSession = new WakeLearningSession(
  () => (typeof window === 'undefined' ? undefined : window.jarvis?.wakeLearning),
);
