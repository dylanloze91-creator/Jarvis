/**
 * Une demande d'image → la requête `txt2img` de l'API Forge (compatible AUTOMATIC1111).
 * Fichier pur : aucun appel réseau ici.
 */

import {
  FORMAT_SIZES,
  type ImageFormat,
  type ImagePreset,
  type ImageProject,
  isImageFormat,
} from './presets.js';

export interface ImageRequest {
  /** Ce que l'utilisateur veut voir, en français ou en anglais. */
  prompt: string;
  project: ImageProject;
  /** 1 à 4 images (lot). */
  count?: number;
  /** `carre`, `paysage`, `portrait`, `16:9`, `9:16` ou `LARGEURxHAUTEUR`. */
  format?: string;
  /** Style libre ajouté au prompt (« aquarelle », « pixel art »…). */
  style?: string;
  /** LoRA (nom de fichier sans extension) et poids (0,1 à 1,5 ; 0,8 par défaut). */
  lora?: { name: string; weight?: number };
  /** Graine ; absente ou -1 = aléatoire (celle réellement utilisée est relue dans la réponse). */
  seed?: number;
  /** Prompt négatif ajouté à celui du projet. */
  negative?: string;
  /** Photo de départ (image vers image) : chemin d'un fichier et fidélité 0 à 1 (0,45 par défaut). */
  initImage?: { path: string; fidelity?: number };
}

/** Requête « image vers image » : la photo encodée en base64, et la force du changement. */
export interface Img2ImgPayload extends Txt2ImgPayload {
  init_images: string[];
  denoising_strength: number;
  /** 1 = recadrer et redimensionner la photo à la taille demandée (sans déformer). */
  resize_mode: 1;
}

export function buildImg2ImgPayload(
  request: ImageRequest,
  preset: ImagePreset,
  options: PayloadOptions,
  initImageBase64: string,
  denoisingStrength: number,
): Img2ImgPayload {
  return {
    ...buildTxt2ImgPayload(request, preset, options),
    init_images: [initImageBase64],
    denoising_strength: denoisingStrength,
    resize_mode: 1,
  };
}

export interface Txt2ImgPayload {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  steps: number;
  cfg_scale: number;
  sampler_name: string;
  scheduler: string;
  seed: number;
  batch_size: number;
  n_iter: number;
  send_images: true;
  save_images: false;
  override_settings: Record<string, unknown>;
  override_settings_restore_afterwards: boolean;
}

export const MAX_IMAGES_PER_REQUEST = 4;
export const DEFAULT_LORA_WEIGHT = 0.8;

/** Taille d'après un format nommé ou « 1024x768 » (arrondi aux 64, bornes 512 à 1536). */
export function resolveSize(format: string | undefined, preset: ImagePreset): { width: number; height: number; format: string } {
  const text = (format ?? '').trim().toLowerCase().replace('é', 'e');
  if (!text) {
    const chosen: ImageFormat = preset.defaultFormat;
    return { ...FORMAT_SIZES[chosen], format: chosen };
  }
  const aliases: Record<string, ImageFormat> = {
    carre: 'carre',
    square: 'carre',
    '1:1': 'carre',
    paysage: 'paysage',
    landscape: 'paysage',
    horizontal: 'paysage',
    '3:2': 'paysage',
    '4:3': 'paysage',
    portrait: 'portrait',
    vertical: 'portrait',
    '2:3': 'portrait',
    '3:4': 'portrait',
    '16:9': '16:9',
    '16/9': '16:9',
    miniature: '16:9',
    youtube: '16:9',
    '9:16': '9:16',
    '9/16': '9:16',
    short: '9:16',
    shorts: '9:16',
    tiktok: '9:16',
    story: '9:16',
  };
  const named = aliases[text] ?? (isImageFormat(text) ? text : undefined);
  if (named) return { ...FORMAT_SIZES[named], format: named };
  const match = /^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/.exec(text);
  if (match) {
    const clamp = (n: number) => Math.min(1536, Math.max(512, Math.round(n / 64) * 64));
    const width = clamp(Number(match[1]));
    const height = clamp(Number(match[2]));
    return { width, height, format: `${width}x${height}` };
  }
  const fallback: ImageFormat = preset.defaultFormat;
  return { ...FORMAT_SIZES[fallback], format: fallback };
}

export function clampCount(count: number | undefined): number {
  if (!Number.isFinite(count ?? NaN)) return 1;
  return Math.min(MAX_IMAGES_PER_REQUEST, Math.max(1, Math.round(count as number)));
}

function loraTag(lora: ImageRequest['lora']): string {
  if (!lora?.name?.trim()) return '';
  const name = lora.name.trim().replace(/\.safetensors$/i, '');
  const weight = Number.isFinite(lora.weight ?? NaN) ? Math.min(1.5, Math.max(0.1, lora.weight as number)) : DEFAULT_LORA_WEIGHT;
  return `<lora:${name}:${weight}>`;
}

/** Texte final envoyé à Forge : préfixe du projet, demande, style, suffixe, LoRA. */
export function buildPrompt(request: ImageRequest, preset: ImagePreset): string {
  return [preset.positivePrefix, request.prompt.trim(), request.style?.trim() ?? '', preset.positiveSuffix, loraTag(request.lora)]
    .map((part) => part.trim().replace(/,+$/, ''))
    .filter(Boolean)
    .join(', ');
}

export function buildNegative(request: ImageRequest, preset: ImagePreset): string {
  return [preset.negative, request.negative?.trim() ?? '']
    .map((part) => part.trim().replace(/,+$/, ''))
    .filter(Boolean)
    .join(', ');
}

export interface PayloadOptions {
  /** Nom du checkpoint tel que Forge le liste (`sd_xl_base_1.0.safetensors [hash]`) ; absent = modèle courant. */
  checkpoint?: string;
  /** Nom du fichier VAE ; absent = réglage courant de Forge. */
  vae?: string;
}

export function buildTxt2ImgPayload(request: ImageRequest, preset: ImagePreset, options: PayloadOptions = {}): Txt2ImgPayload {
  const size = resolveSize(request.format, preset);
  const seed = Number.isInteger(request.seed) && (request.seed as number) >= 0 ? (request.seed as number) : -1;
  const overrides: Record<string, unknown> = {};
  if (options.checkpoint) overrides.sd_model_checkpoint = options.checkpoint;
  if (options.vae) overrides.sd_vae = options.vae;
  return {
    prompt: buildPrompt(request, preset),
    negative_prompt: buildNegative(request, preset),
    width: size.width,
    height: size.height,
    steps: preset.steps,
    cfg_scale: preset.cfg,
    sampler_name: preset.sampler,
    scheduler: preset.scheduler,
    seed,
    batch_size: clampCount(request.count),
    n_iter: 1,
    send_images: true,
    save_images: false,
    override_settings: overrides,
    override_settings_restore_afterwards: false,
  };
}

/** Réponse `txt2img` telle que Forge la renvoie (champs utilisés seulement). */
export interface Txt2ImgResponse {
  images?: string[];
  info?: string;
}

export interface GeneratedInfo {
  seeds: number[];
  checkpoint?: string;
}

/** Relit `info` (JSON dans une chaîne) : graines réellement utilisées, modèle. */
export function parseTxt2ImgInfo(info: string | undefined, count: number): GeneratedInfo {
  const fallback: GeneratedInfo = { seeds: Array.from({ length: count }, () => -1) };
  if (!info) return fallback;
  try {
    const parsed = JSON.parse(info) as { seed?: number; all_seeds?: number[]; sd_model_name?: string };
    const seeds =
      Array.isArray(parsed.all_seeds) && parsed.all_seeds.length
        ? parsed.all_seeds.slice(0, count).map((value) => (Number.isInteger(value) ? value : -1))
        : fallback.seeds.map((_, index) => (Number.isInteger(parsed.seed) ? (parsed.seed as number) + index : -1));
    return { seeds, ...(parsed.sd_model_name ? { checkpoint: parsed.sd_model_name } : {}) };
  } catch {
    return fallback;
  }
}
