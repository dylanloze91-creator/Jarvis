import type { OllamaCodeOptions } from '../providers/types.js';

/** Catalogue des modèles de code pour le PC de thedexios (RTX 2060 6 Go, 64 Go DDR4-3200, i7-9700KF). Décision 4. */
export type CodeModelRole = 'default' | 'fallback' | 'fast' | 'quality';

export interface CodeModelSpec {
  id: string;
  label: string;
  role: CodeModelRole;
  roleLabel: string;
  architecture: 'moe' | 'dense';
  totalParamsB: number;
  activeParamsB: number;
  quantization: string;
  downloadBytes: number;
  contextTokens: number;
  /** Cache clé/valeur par jeton de contexte, en f16 (estimation). */
  kvBytesPerToken: number;
  /** MoE : poids lus à chaque jeton hors experts (attention, couches partagées) et experts actifs, en octets. */
  sharedBytes: number;
  expertBytesPerToken: number;
  /** `false` coupe la réflexion pour les appels d'outils ; absent = modèle sans réflexion (rien n'est envoyé). */
  think?: boolean;
  /** `num_gpu` sans réglage du serveur : absent = placement automatique d'Ollama. */
  gpuLayers?: number;
  placement: string;
  expertsInRam: { supported: boolean; placement: string };
  /** Vitesse attendue d'après des mesures publiées sur des cartes de 6 Go (estimation). */
  publishedTokPerSec: [number, number];
  sweBenchVerified?: number;
  sources: string[];
}

const GB = 1e9;

export const CODE_MODEL_CATALOG: CodeModelSpec[] = [
  {
    id: 'qwen3.6:35b-a3b-coding',
    label: 'Qwen3.6-35B-A3B (code)',
    role: 'default',
    roleLabel: 'Par défaut',
    architecture: 'moe',
    totalParamsB: 35,
    activeParamsB: 3,
    quantization: 'Q4_K_M',
    downloadBytes: 23 * GB,
    contextTokens: 32_768,
    kvBytesPerToken: 20_480,
    sharedBytes: 1.6 * GB,
    expertBytesPerToken: 1.2 * GB,
    think: false,
    placement:
      'Sans réglage du serveur : Ollama met sur la carte les couches qui tiennent (environ 1/5), le reste en RAM.',
    expertsInRam: {
      supported: true,
      placement: 'Experts en RAM, attention et couches partagées sur la carte (num_gpu 99).',
    },
    publishedTokPerSec: [11, 17],
    sweBenchVerified: 73.4,
    sources: [
      'https://www.alibabacloud.com/blog/qwen3-6-35b-a3b-thinking-open-weights-uncompromised-agentic-coding_603043',
      'https://ollama.com/library/qwen3.6/tags',
      'https://www.kocpc.com.tw/archives/642193',
    ],
  },
  {
    id: 'qwen3-coder:30b',
    label: 'Qwen3-Coder-30B-A3B',
    role: 'fallback',
    roleLabel: 'Repli',
    architecture: 'moe',
    totalParamsB: 30.5,
    activeParamsB: 3.3,
    quantization: 'Q4_K_M',
    downloadBytes: 19 * GB,
    contextTokens: 16_384,
    kvBytesPerToken: 98_304,
    sharedBytes: 1.5 * GB,
    expertBytesPerToken: 1.3 * GB,
    placement:
      'Sans réglage du serveur : couches réparties automatiquement entre la carte et la RAM.',
    expertsInRam: {
      supported: true,
      placement:
        'Experts en RAM, le reste sur la carte (num_gpu 99). Contexte limité à 16 384 : cache lourd.',
    },
    publishedTokPerSec: [12, 16],
    sources: [
      'https://ollama.com/library/qwen3-coder/tags',
      'https://www.reddit.com/r/LocalLLM/comments/1vwhkf3/',
    ],
  },
  {
    id: 'qwen3.5:4b',
    label: 'Qwen3.5 4B',
    role: 'fast',
    roleLabel: 'Rapide',
    architecture: 'dense',
    totalParamsB: 4,
    activeParamsB: 4,
    quantization: 'Q4_K_M',
    downloadBytes: 3.4 * GB,
    contextTokens: 32_768,
    kvBytesPerToken: 24_576,
    sharedBytes: 3.4 * GB,
    expertBytesPerToken: 0,
    think: false,
    gpuLayers: 99,
    placement: 'Tout sur la carte graphique (num_gpu 99).',
    expertsInRam: {
      supported: false,
      placement: 'Sans objet : modèle dense, déjà entièrement sur la carte.',
    },
    publishedTokPerSec: [45, 70],
    sources: ['https://ollama.com/library/qwen3.5/tags'],
  },
  {
    id: 'qwen3.6:27b',
    label: 'Qwen3.6 27B',
    role: 'quality',
    roleLabel: 'Qualité (lent)',
    architecture: 'dense',
    totalParamsB: 27,
    activeParamsB: 27,
    quantization: 'Q4_K_M',
    downloadBytes: 17 * GB,
    contextTokens: 16_384,
    kvBytesPerToken: 32_768,
    sharedBytes: 17 * GB,
    expertBytesPerToken: 0,
    think: false,
    placement:
      'Environ 5 Go sur la carte, le reste en RAM : lent, pour une revue ou un plan difficile en arrière-plan.',
    expertsInRam: { supported: false, placement: 'Sans objet : modèle dense.' },
    publishedTokPerSec: [2, 3],
    sweBenchVerified: 77.2,
    sources: ['https://huggingface.co/Qwen/Qwen3.6-27B'],
  },
];

/** Tailles des modèles en gigaoctets décimaux, comme les affiche Ollama (23 Go, pas 21,4 Gio). */
export function formatModelSize(bytes: number): string {
  return `${(bytes / GB).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

export function codeModelById(id: string): CodeModelSpec | undefined {
  return CODE_MODEL_CATALOG.find((model) => model.id === id);
}

/**
 * Profil modeste : aucun gros modèle de code n’est proposé (le 23 Go non plus).
 * Profil absent, standard ou complet : le catalogue de 0.4.25.
 */
export function codeModelsOffered(
  profile: 'modest' | 'standard' | 'full' | undefined,
): CodeModelSpec[] {
  if (profile === 'modest') return [];
  return CODE_MODEL_CATALOG;
}

/** Réglages de requête envoyés à Ollama pour ce modèle (jamais des variables du serveur). */
export function codeModelOptions(spec: CodeModelSpec, expertsInRam: boolean): OllamaCodeOptions {
  const numGpu = expertsInRam && spec.expertsInRam.supported ? 99 : spec.gpuLayers;
  return {
    numCtx: spec.contextTokens,
    keepAlive: '30m',
    ...(spec.think !== undefined ? { think: spec.think } : {}),
    ...(numGpu !== undefined ? { numGpu } : {}),
  };
}
