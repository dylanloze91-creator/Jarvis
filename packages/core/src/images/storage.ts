/**
 * Rangement des images : `<racine>/<projet>/<AAAA-MM-JJ>/<HHMMSS>-<sujet>-<n>.png`
 * et, à côté, `<même nom>.txt` avec le prompt et les réglages. Fichier pur (noms et textes).
 */

import type { ImageProject } from './presets.js';
import type { Txt2ImgPayload } from './request.js';

export const DEFAULT_IMAGES_ROOT_WINDOWS = 'C:\\dev\\Jarvis_images';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function dateFolder(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function timePrefix(now: Date): string {
  return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** « Un chat sur un toit, photo » → `un-chat-sur-un-toit-photo` (40 caractères au plus). */
export function imageSlug(text: string, maxLength = 40): string {
  const slug = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'image';
}

export interface ImageFileNames {
  /** Sous-dossier relatif à la racine : `projet/AAAA-MM-JJ`. */
  folder: string;
  /** Nom de base sans extension : `HHMMSS-sujet-1`. */
  base: string;
  png: string;
  txt: string;
  /** Version noir et blanc, si demandée. */
  pngBw: string;
}

export function imageFileNames(input: { project: ImageProject; prompt: string; now: Date; index: number }): ImageFileNames {
  const base = `${timePrefix(input.now)}-${imageSlug(input.prompt)}-${input.index + 1}`;
  return {
    folder: `${input.project}/${dateFolder(input.now)}`,
    base,
    png: `${base}.png`,
    txt: `${base}.txt`,
    pngBw: `${base}-nb.png`,
  };
}

export interface SidecarInput {
  project: ImageProject;
  userPrompt: string;
  payload: Txt2ImgPayload;
  seed: number;
  checkpoint?: string;
  vae?: string;
  lora?: { name: string; weight?: number };
  createdAt: Date;
  blackAndWhiteFile?: string;
  forgeVersion?: string;
}

/** Texte lisible gardé à côté de chaque image : de quoi la refaire. */
export function sidecarText(input: SidecarInput): string {
  const lines = [
    `Image générée par Jarvis (module images, Forge + SDXL)`,
    `Date : ${input.createdAt.toLocaleString('fr-FR')}`,
    `Projet : ${input.project}`,
    `Demande : ${input.userPrompt.trim()}`,
    '',
    `Prompt : ${input.payload.prompt}`,
    `Prompt négatif : ${input.payload.negative_prompt}`,
    `Taille : ${input.payload.width}x${input.payload.height}`,
    `Pas : ${input.payload.steps}  CFG : ${input.payload.cfg_scale}  Échantillonneur : ${input.payload.sampler_name} (${input.payload.scheduler})`,
    `Graine : ${input.seed}`,
    `Modèle : ${input.checkpoint ?? 'modèle courant de Forge'}`,
    `VAE : ${input.vae ?? 'réglage de Forge'}`,
    `LoRA : ${input.lora?.name ? `${input.lora.name} (poids ${input.lora.weight ?? 0.8})` : 'aucun'}`,
  ];
  if (input.blackAndWhiteFile) lines.push(`Version noir et blanc : ${input.blackAndWhiteFile}`);
  if (input.forgeVersion) lines.push(`Forge : ${input.forgeVersion}`);
  return `${lines.join('\n')}\n`;
}
