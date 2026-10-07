import { OLLAMA_RTX2060_6GB_RECOMMENDATIONS } from '../providers/ollamaModels.js';
import type { LocalLearningTrainPlan } from './types.js';

/** Socle QLoRA par défaut sur RTX 2060 6 Go — ne jamais full-finetune un 14B. */
export const DEFAULT_LOCAL_TRAIN_BASE = 'qwen2.5:3b';

export const PERSONAL_OLLAMA_MODEL = 'jarvis-local-personal';

function parameterBillions(model: string): number | null {
  const match = /(\d+(?:\.\d+)?)b/i.exec(model);
  return match ? Number(match[1]) : null;
}

function recommendationFor(model: string) {
  const base = model.split(':')[0] ?? model;
  return OLLAMA_RTX2060_6GB_RECOMMENDATIONS.find(
    (entry) => entry.model === model || entry.model.startsWith(`${base}:`),
  );
}

/** Peut-on lancer un QLoRA sur ce tag sans dépasser ~6 Go VRAM ? */
export function canQloraTrainOnOllamaModel(model: string): boolean {
  const billions = parameterBillions(model);
  if (billions === null || billions > 3.5) return false;
  const rec = recommendationFor(model);
  if (rec) return rec.fitsOn6GbVram;
  return billions <= 3.5;
}

/**
 * Choisit le socle d’entraînement : le modèle de chat s’il tient en 6 Go,
 * sinon le plus petit socle local documenté (qwen2.5:3b).
 */
export function planLocalLearningTrain(chatModel: string): LocalLearningTrainPlan {
  const trimmed = chatModel.trim() || DEFAULT_LOCAL_TRAIN_BASE;
  if (canQloraTrainOnOllamaModel(trimmed)) {
    return {
      chatModel: trimmed,
      trainBaseModel: trimmed,
      trainNote: `Adaptateur QLoRA sur ${trimmed}.`,
      sameBaseAsChat: true,
    };
  }
  const billions = parameterBillions(trimmed);
  const large =
    billions !== null && billions >= 7
      ? ` (${trimmed} est trop lourd pour un entraînement en 6 Go)`
      : '';
  return {
    chatModel: trimmed,
    trainBaseModel: DEFAULT_LOCAL_TRAIN_BASE,
    trainNote: `Adaptateur entraîné sur ${DEFAULT_LOCAL_TRAIN_BASE}${large} ; appliqué aux réponses locales.`,
    sameBaseAsChat: false,
  };
}

/** Identifiant Hugging Face pour un tag Ollama courant. */
export function huggingFaceIdForOllamaTrainBase(trainBase: string): string {
  const key = trainBase.split(':')[0]?.toLowerCase() ?? trainBase;
  if (key.startsWith('qwen2.5')) return 'Qwen/Qwen2.5-3B-Instruct';
  if (key.startsWith('phi3')) return 'microsoft/Phi-3-mini-4k-instruct';
  return 'Qwen/Qwen2.5-3B-Instruct';
}
