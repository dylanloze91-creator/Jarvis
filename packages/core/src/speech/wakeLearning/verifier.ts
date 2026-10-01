/**
 * Vérificateur personnel du mot de réveil : régression logistique sur les
 * caractéristiques openWakeWord (`features.ts`), entraînée sur ce PC en
 * quelques millisecondes. Il ne remplace pas Vosk ni openWakeWord : il
 * peut refuser un réveil (veto) et, quand il est sûr de lui, accepter un
 * quasi-réveil (« Jarvis » entendu mais sous le seuil d'un détecteur).
 * Les deux seuils sont choisis en validation croisée puis bornés.
 */
import { WAKE_FEATURE_SIZE } from './features.js';

export const WAKE_VERIFIER_VERSION = 1;

/** Le veto n'écarte jamais un réveil dont la probabilité dépasse 0,5 ; il en écarte au moins sous 0,05. */
export const VETO_THRESHOLD_BOUNDS = { min: 0.05, max: 0.5 } as const;
/** Un quasi-réveil n'est accepté qu'au-dessus de 0,8 au minimum. */
export const RESCUE_THRESHOLD_BOUNDS = { min: 0.8, max: 0.98 } as const;

/** En dessous, pas de modèle : le comportement reste celui de 0.4.16. */
export const MIN_POSITIVES_FOR_VERIFIER = 8;
export const MIN_NEGATIVES_FOR_VERIFIER = 8;
/** Le rattrapage des quasi-réveils demande plus d'exemples. */
export const MIN_POSITIVES_FOR_RESCUE = 15;
export const MIN_NEGATIVES_FOR_RESCUE = 20;
/** Part minimale des vrais réveils (validation croisée) que le veto doit laisser passer. */
export const TARGET_POSITIVE_RECALL = 0.97;

export interface WakeTrainingSample {
  features: number[];
  label: 0 | 1;
}

export interface WakeVerifierModel {
  version: number;
  featureSize: number;
  mean: number[];
  scale: number[];
  weights: number[];
  bias: number;
  /** Sous ce seuil, un réveil d'un détecteur est refusé. */
  vetoThreshold: number;
  /** Au-dessus, un quasi-réveil est accepté ; `null` = rattrapage désactivé. */
  rescueThreshold: number | null;
  /** Le veto est actif seulement si la validation croisée garde ≥ 97 % des vrais réveils. */
  vetoEnabled: boolean;
  trainedAt: number;
  positives: number;
  negatives: number;
  /** Validation croisée : part des vrais réveils gardés, part des faux réveils écartés au seuil du veto. */
  cvRecall: number;
  cvRejection: number;
}

export interface TrainOptions {
  l2?: number;
  iterations?: number;
  learningRate?: number;
  folds?: number;
  now?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function clampVetoThreshold(value: number): number {
  return clamp(value, VETO_THRESHOLD_BOUNDS.min, VETO_THRESHOLD_BOUNDS.max);
}

export function clampRescueThreshold(value: number): number {
  return clamp(value, RESCUE_THRESHOLD_BOUNDS.min, RESCUE_THRESHOLD_BOUNDS.max);
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

interface Fitted {
  mean: number[];
  scale: number[];
  weights: number[];
  bias: number;
}

/** Régression logistique L2, classes pondérées, descente de gradient complète (déterministe). */
function fitLogistic(samples: WakeTrainingSample[], options: Required<Omit<TrainOptions, 'now' | 'folds'>>): Fitted {
  const dim = samples[0]?.features.length ?? WAKE_FEATURE_SIZE;
  const n = samples.length;
  const mean = new Array<number>(dim).fill(0);
  const scale = new Array<number>(dim).fill(0);
  for (const sample of samples) for (let d = 0; d < dim; d += 1) mean[d]! += (sample.features[d] ?? 0) / n;
  for (const sample of samples) for (let d = 0; d < dim; d += 1) scale[d]! += ((sample.features[d] ?? 0) - mean[d]!) ** 2 / n;
  for (let d = 0; d < dim; d += 1) scale[d] = Math.sqrt(scale[d]!) || 1;

  const x = samples.map((sample) => sample.features.map((value, d) => (value - mean[d]!) / scale[d]!));
  const positives = samples.filter((sample) => sample.label === 1).length;
  const negatives = n - positives;
  const weightOf = (label: 0 | 1): number => (label === 1 ? n / (2 * Math.max(1, positives)) : n / (2 * Math.max(1, negatives)));

  const weights = new Array<number>(dim).fill(0);
  let bias = 0;
  const gradient = new Array<number>(dim);
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    gradient.fill(0);
    let biasGradient = 0;
    for (let i = 0; i < n; i += 1) {
      const row = x[i]!;
      let z = bias;
      for (let d = 0; d < dim; d += 1) z += weights[d]! * row[d]!;
      const label = samples[i]!.label;
      const error = (sigmoid(z) - label) * weightOf(label);
      for (let d = 0; d < dim; d += 1) gradient[d]! += error * row[d]!;
      biasGradient += error;
    }
    for (let d = 0; d < dim; d += 1) {
      weights[d]! -= options.learningRate * (gradient[d]! / n + options.l2 * weights[d]!);
    }
    bias -= options.learningRate * (biasGradient / n);
  }
  return { mean, scale, weights, bias };
}

function scoreWith(model: Fitted, features: number[]): number {
  let z = model.bias;
  for (let d = 0; d < model.weights.length; d += 1) {
    z += model.weights[d]! * (((features[d] ?? 0) - model.mean[d]!) / model.scale[d]!);
  }
  return sigmoid(z);
}

/** Probabilité (0–1) que l'extrait soit un vrai « Jarvis » de cet utilisateur. */
export function scoreWakeFeatures(model: WakeVerifierModel, features: number[]): number {
  if (features.length !== model.featureSize) return 1;
  return scoreWith(model, features);
}

/** Probabilités hors échantillon : chaque exemple est noté par un modèle qui ne l'a pas vu. */
function crossValidatedScores(
  samples: WakeTrainingSample[],
  folds: number,
  fitOptions: Required<Omit<TrainOptions, 'now' | 'folds'>>,
): number[] {
  const scores = new Array<number>(samples.length).fill(0.5);
  const k = Math.max(2, Math.min(folds, samples.length));
  // Répartition déterministe et stratifiée : positifs et négatifs alternent entre les plis.
  const foldOf = new Array<number>(samples.length);
  let pos = 0;
  let neg = 0;
  samples.forEach((sample, index) => {
    foldOf[index] = sample.label === 1 ? pos++ % k : neg++ % k;
  });
  for (let fold = 0; fold < k; fold += 1) {
    const train = samples.filter((_, index) => foldOf[index] !== fold);
    if (!train.some((s) => s.label === 1) || !train.some((s) => s.label === 0)) continue;
    const fitted = fitLogistic(train, fitOptions);
    samples.forEach((sample, index) => {
      if (foldOf[index] === fold) scores[index] = scoreWith(fitted, sample.features);
    });
  }
  return scores;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index]!;
}

/**
 * Entraîne le vérificateur, ou renvoie `null` s'il manque des exemples :
 * sans modèle, les détecteurs décident seuls (comportement 0.4.16).
 */
export function trainWakeVerifier(samples: WakeTrainingSample[], options: TrainOptions = {}): WakeVerifierModel | null {
  const usable = samples.filter((sample) => sample.features.length === WAKE_FEATURE_SIZE && sample.features.every(Number.isFinite));
  const positives = usable.filter((sample) => sample.label === 1);
  const negatives = usable.filter((sample) => sample.label === 0);
  if (positives.length < MIN_POSITIVES_FOR_VERIFIER || negatives.length < MIN_NEGATIVES_FOR_VERIFIER) return null;

  const fitOptions = {
    l2: options.l2 ?? 0.05,
    iterations: options.iterations ?? 300,
    learningRate: options.learningRate ?? 0.5,
  };
  const cv = crossValidatedScores(usable, options.folds ?? 5, fitOptions);
  const positiveScores = usable.flatMap((sample, index) => (sample.label === 1 ? [cv[index]!] : [])).sort((a, b) => a - b);
  const negativeScores = usable.flatMap((sample, index) => (sample.label === 0 ? [cv[index]!] : [])).sort((a, b) => a - b);

  // Veto : sous le quantile 3 % des vrais réveils, borné ; jamais au-dessus de 0,5.
  const vetoThreshold = clampVetoThreshold(quantile(positiveScores, 1 - TARGET_POSITIVE_RECALL) * 0.9);
  const cvRecall = positiveScores.filter((score) => score >= vetoThreshold).length / positiveScores.length;
  const cvRejection = negativeScores.filter((score) => score < vetoThreshold).length / negativeScores.length;

  // Rattrapage : au-dessus du plus haut faux réveil vu, avec une marge, borné.
  let rescueThreshold: number | null = null;
  if (positives.length >= MIN_POSITIVES_FOR_RESCUE && negatives.length >= MIN_NEGATIVES_FOR_RESCUE) {
    const highestNegative = negativeScores.at(-1) ?? 1;
    const candidate = clampRescueThreshold(Math.max(highestNegative + 0.05, RESCUE_THRESHOLD_BOUNDS.min));
    const rescued = positiveScores.filter((score) => score >= candidate).length / positiveScores.length;
    // Inutile si le seuil ne garde presque aucun vrai réveil, dangereux si un négatif le touche.
    if (rescued >= 0.5 && highestNegative < candidate) rescueThreshold = candidate;
  }

  const fitted = fitLogistic(usable, fitOptions);
  return {
    version: WAKE_VERIFIER_VERSION,
    featureSize: WAKE_FEATURE_SIZE,
    ...fitted,
    vetoThreshold,
    rescueThreshold,
    vetoEnabled: cvRecall >= TARGET_POSITIVE_RECALL,
    trainedAt: options.now ?? Date.now(),
    positives: positives.length,
    negatives: negatives.length,
    cvRecall,
    cvRejection,
  };
}

export type WakeCandidateKind = 'detected' | 'near-miss';

export interface WakeDecision {
  accept: boolean;
  /** Pour le journal et les statistiques, jamais l'audio. */
  reason: 'base' | 'verified' | 'vetoed' | 'rescued' | 'ignored';
  probability: number | null;
}

/**
 * Décision finale pour un candidat. Sans modèle (ou sans caractéristiques),
 * un réveil passe et un quasi-réveil est ignoré : exactement 0.4.16.
 */
export function decideWakeCandidate(
  model: WakeVerifierModel | null,
  kind: WakeCandidateKind,
  probability: number | null,
): WakeDecision {
  if (!model || probability === null) {
    return kind === 'detected'
      ? { accept: true, reason: 'base', probability }
      : { accept: false, reason: 'ignored', probability };
  }
  if (kind === 'detected') {
    if (model.vetoEnabled && probability < clampVetoThreshold(model.vetoThreshold)) {
      return { accept: false, reason: 'vetoed', probability };
    }
    return { accept: true, reason: 'verified', probability };
  }
  if (model.rescueThreshold !== null && probability >= clampRescueThreshold(model.rescueThreshold)) {
    return { accept: true, reason: 'rescued', probability };
  }
  return { accept: false, reason: 'ignored', probability };
}

/** Relit un modèle enregistré ; tout écart (version, taille, seuils hors bornes) → `null`. */
export function parseWakeVerifierModel(value: unknown): WakeVerifierModel | null {
  if (!value || typeof value !== 'object') return null;
  const model = value as Partial<WakeVerifierModel>;
  const numbers = (list: unknown, size: number): list is number[] =>
    Array.isArray(list) && list.length === size && list.every((item) => typeof item === 'number' && Number.isFinite(item));
  if (model.version !== WAKE_VERIFIER_VERSION || model.featureSize !== WAKE_FEATURE_SIZE) return null;
  if (!numbers(model.mean, WAKE_FEATURE_SIZE) || !numbers(model.scale, WAKE_FEATURE_SIZE) || !numbers(model.weights, WAKE_FEATURE_SIZE)) {
    return null;
  }
  if (typeof model.bias !== 'number' || typeof model.vetoThreshold !== 'number') return null;
  return {
    version: WAKE_VERIFIER_VERSION,
    featureSize: WAKE_FEATURE_SIZE,
    mean: model.mean,
    scale: model.scale,
    weights: model.weights,
    bias: model.bias,
    vetoThreshold: clampVetoThreshold(model.vetoThreshold),
    rescueThreshold: typeof model.rescueThreshold === 'number' ? clampRescueThreshold(model.rescueThreshold) : null,
    vetoEnabled: model.vetoEnabled === true,
    trainedAt: typeof model.trainedAt === 'number' ? model.trainedAt : 0,
    positives: typeof model.positives === 'number' ? model.positives : 0,
    negatives: typeof model.negatives === 'number' ? model.negatives : 0,
    cvRecall: typeof model.cvRecall === 'number' ? model.cvRecall : 0,
    cvRejection: typeof model.cvRejection === 'number' ? model.cvRejection : 0,
  };
}
