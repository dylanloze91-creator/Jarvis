/**
 * Reformulation de la demande en consigne Stable Diffusion XL, par le modèle de langage,
 * avant de le décharger. Fichier pur : consignes, lecture de la réponse, contrôles.
 *
 * Pourquoi : SDXL comprend l'anglais structuré (sujet, détails, style, lumière, cadrage,
 * qualité) ; le 7B écrit parfois en français ou trop court. La reformulation est un
 * confort : si elle échoue ou rend quelque chose de douteux, la consigne d'origine est gardée.
 */

import type { ImagePreset, ImageProject } from './presets.js';

export interface RefineInput {
  /** Consigne telle que l'outil l'a reçue (du modèle ou de l'utilisateur). */
  prompt: string;
  project: ImageProject;
  preset: ImagePreset;
  style?: string;
  negative?: string;
  /** Vrai quand une photo sert de base : décrire le résultat final, garder le sujet. */
  fromPhoto?: boolean;
}

export interface RefinedPrompt {
  prompt: string;
  negative?: string;
}

export const REFINE_SYSTEM_PROMPT = [
  'You write prompts for Stable Diffusion XL (SDXL). You receive a request (French or English) and the rules of a project.',
  'Answer ONLY with a JSON object: {"prompt": "...", "negative": "..."}.',
  'prompt: English only, 25 to 70 words, comma-separated phrases in this order: main subject with concrete details (what, who, how many, pose, expression), setting or background, art medium or style, lighting, camera or composition (framing, angle, lens), quality words. Keep every element the user asked for; invent only what is needed to make the picture concrete. No sentences, no "image of", no quotes, no text or letters inside the picture unless asked.',
  'negative: English only, 5 to 20 comma-separated defects to avoid for this request (anatomy, blur, duplicates, text, watermark…). Do not repeat the project rules: they are added automatically.',
  'If the request mentions a base photo, describe the final result and keep the subject recognizable.',
  'Never add brand logos, trademarks or real celebrities. Never answer with anything but the JSON object.',
].join(' ');

export function refineUserMessage(input: RefineInput): string {
  const lines = [
    `Project: ${input.project} — ${input.preset.description}`,
    input.preset.positivePrefix ? `Project style already imposed (do not repeat it): ${input.preset.positivePrefix}` : '',
    `Request: ${input.prompt.trim()}`,
    input.style?.trim() ? `Requested style: ${input.style.trim()}` : '',
    input.negative?.trim() ? `Things to avoid, from the user: ${input.negative.trim()}` : '',
    input.fromPhoto ? 'A base photo is provided (image-to-image): describe the finished picture, keep the subject of the photo.' : '',
  ].filter(Boolean);
  return lines.join('\n');
}

/** Lit `{"prompt": …, "negative": …}`, même entouré de texte ou de ```json. `null` si illisible. */
export function parseRefinedPrompt(raw: string): RefinedPrompt | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { prompt?: unknown; negative?: unknown };
    const prompt = typeof parsed.prompt === 'string' ? cleanPromptText(parsed.prompt) : '';
    if (!prompt) return null;
    const negative = typeof parsed.negative === 'string' ? cleanPromptText(parsed.negative) : '';
    return negative ? { prompt, negative } : { prompt };
  } catch {
    return null;
  }
}

function cleanPromptText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^["'\s,]+|["'\s,]+$/g, '')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

/** Mots français fréquents qui trahissent une consigne non traduite. */
const FRENCH_MARKERS = /\b(une|un|des|le|la|les|et|avec|sur|dans|pour|qui|est|sont|très|style de|fond|lumière|femme|homme|chat|chien|rouge|bleu|vert|noir|blanc)\b/i;

/** Garde-fou : consigne plausible pour SDXL (anglais, longueur raisonnable). */
export function looksLikeSdxlPrompt(prompt: string): boolean {
  const words = prompt.split(/\s+/).filter(Boolean);
  if (words.length < 5 || words.length > 120) return false;
  if (prompt.length > 900) return false;
  const frenchHits = (prompt.match(new RegExp(FRENCH_MARKERS.source, 'gi')) ?? []).length;
  // Un ou deux mots ambigus (« style de », noms propres) passent ; une phrase française non.
  return frenchHits <= 2;
}

/**
 * Décision finale : la consigne reformulée si elle est plausible, sinon celle d'origine.
 * `reason` explique le repli (journal, fichier .txt).
 */
export function chooseRefinedPrompt(original: string, refined: RefinedPrompt | null): { prompt: string; negative?: string; used: boolean; reason?: string } {
  if (!refined) return { prompt: original, used: false, reason: 'réponse illisible' };
  if (!looksLikeSdxlPrompt(refined.prompt)) return { prompt: original, used: false, reason: 'consigne reformulée douteuse (langue ou longueur)' };
  return { prompt: refined.prompt, ...(refined.negative ? { negative: refined.negative } : {}), used: true };
}
