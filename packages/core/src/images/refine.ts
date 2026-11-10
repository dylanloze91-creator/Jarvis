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
  /** Rendu voulu : `anime` = étiquettes Danbooru (personnage, série) ; `realiste` = photo. */
  render?: 'auto' | 'realiste' | 'anime';
}

export interface RefinedPrompt {
  prompt: string;
  negative?: string;
}

export const REFINE_SYSTEM_PROMPT = [
  'You describe pictures for Stable Diffusion XL (SDXL), as the describing step of "Jarvis Imager". You receive a request (French or English) and the rules of a project.',
  'Answer ONLY with a JSON object: {"prompt": "...", "negative": "..."}.',
  'prompt: English only, 20 to 60 words, comma-separated phrases in this order: main subject with concrete details (what, who, exactly how many people, age, pose, expression, clothing), setting or background, art medium or style, lighting, camera or composition (framing, angle, lens). Translate EVERY French word into natural English, including the subject noun and adjectives (femme → woman, homme → man, chat → cat, rouge → red) and put adjectives before nouns ("red lingerie", never "lingerie red"). Keep every element the user asked for; invent only what is needed to make the picture concrete. Do NOT add quality words (no "high quality", "detailed", "masterpiece", "8k"): Jarvis Imager adds them. No sentences, no "image of", no quotes, no text or letters inside the picture unless asked.',
  'negative: English only, 3 to 12 comma-separated defects to avoid, chosen for THIS request only (for a building: warped perspective, melted windows; for an animal: extra legs, wrong number of tails; for food: unappetizing colors…). Anatomy defects (hands, fingers, limbs, faces), blur, watermark and text are already handled by Jarvis Imager: do not list them.',
  'Art medium: keep the one the user asked for. If none is given, infer it from the context (a game, anime or manga character → anime style; a product, place or real person → photo, realistic; "sticker", "logo", "icon" → flat vector illustration). Never impose an unrelated medium such as watercolor or oil painting on your own.',
  'Framing: "close-up" only when the user asks for a face portrait. When clothing, body pose, props, water, furniture or a place matter, choose "upper body", "cowboy shot" (hips up) or "full body" so that everything asked for is visible in the picture (observed failure: "bikini in a jacuzzi" rendered as a face close-up).',
  'Proper names: keep the names of characters, series, games, places and styles exactly as given (Hinata from Naruto stays "Hinata Hyuga, Naruto"). Never replace a named character by a generic description, and never invent their hair or eye colour: the image model knows the character by name.',
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
    input.render === 'anime'
      ? 'Rendering: anime (an anime model trained on Danbooru tags will draw it). Write "prompt" as Danbooru-style tags: first 1girl, 1boy, 2girls… then the character\'s full name and the series in parentheses, e.g. "hyuuga hinata, naruto (series)", then appearance, outfit, pose, expression, setting, lighting, and one framing tag (portrait, upper body, cowboy shot or full body: the one that shows the outfit and setting asked for). Keep character and series names exactly as given.'
      : input.render === 'realiste'
        ? 'Rendering: realistic photograph.'
        : '',
  ].filter(Boolean);
  return lines.join('\n');
}

/** Second essai : le modèle revoit sa réponse quand elle contient encore du français ou n'est pas lisible. */
export function refineRetryMessage(previousAnswer: string): string {
  return [
    `Your previous answer was: ${previousAnswer.trim().slice(0, 600)}`,
    'It is rejected: it still contains French words, is not valid JSON, or is too short or too long.',
    'Answer again with ONLY the JSON object {"prompt": "...", "negative": "..."}, every word in English, adjectives before nouns, 25 to 70 words in "prompt".',
  ].join('\n');
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

/** Mots-outils français : un ou deux peuvent venir d'un nom propre (« La Défense »), au-delà c'est du français. */
const FRENCH_FUNCTION_WORDS = /\b(une|un|des|le|la|les|et|avec|sur|dans|pour|qui|est|sont|très|trop|pas|style de)\b/gi;
/** Noms et adjectifs français courants : un seul suffit, le modèle n'a pas traduit le sujet (observé : « femme in lingerie red »). */
const FRENCH_CONTENT_WORDS =
  /\b(femme|femmes|homme|hommes|fille|garçon|enfant|chat|chats|chien|chiens|oiseau|voiture|maison|ville|montagne|forêt|foret|plage|fleur|fleurs|rouge|bleu|bleue|vert|verte|noir|noire|blanc|blanche|jaune|lumière|lumiere|fond|dessin|photo de|portrait de|paysage de|ciel|nuit|jour|soleil|pluie|neige|cheveux|robe|visage|sourire|pudique|vulgaire|flou|floue|déformé|deforme|moche)\b/gi;

/** Garde-fou : consigne plausible pour SDXL (anglais, longueur raisonnable). */
export function looksLikeSdxlPrompt(prompt: string): boolean {
  const words = prompt.split(/\s+/).filter(Boolean);
  if (words.length < 5 || words.length > 120) return false;
  if (prompt.length > 900) return false;
  const functionHits = (prompt.match(FRENCH_FUNCTION_WORDS) ?? []).length;
  const contentHits = (prompt.match(FRENCH_CONTENT_WORDS) ?? []).length;
  return functionHits <= 2 && contentHits === 0;
}

/**
 * Décision finale : la consigne reformulée si elle est plausible, sinon celle d'origine.
 * `reason` explique le repli (journal, fichier .txt).
 */
export function chooseRefinedPrompt(original: string, refined: RefinedPrompt | null): { prompt: string; negative?: string; used: boolean; reason?: string } {
  if (!refined) return { prompt: original, used: false, reason: 'réponse illisible' };
  if (!looksLikeSdxlPrompt(refined.prompt)) return { prompt: original, used: false, reason: 'consigne reformulée douteuse (langue ou longueur)' };
  // Négatif en français (observé : « très pudique, pudique ») : écarté seul, la consigne est gardée.
  const negative = refined.negative && looksLikeEnglishNegative(refined.negative) ? refined.negative : undefined;
  return { prompt: keepOneFramingTag(refined.prompt), ...(negative ? { negative } : {}), used: true };
}

/** Étiquettes de cadrage qui s'excluent (Danbooru et photo) : la première l'emporte. */
const FRAMING_TAGS = new Set(['close-up', 'close up', 'portrait', 'headshot', 'bust shot', 'upper body', 'cowboy shot', 'full body', 'wide shot']);

/**
 * Une seule étiquette de cadrage : le modèle en met parfois deux (observé « upper body, …, full body »),
 * et Stable Diffusion tranche au hasard. La première, placée près du sujet, est gardée.
 */
export function keepOneFramingTag(prompt: string): string {
  let seen = false;
  const kept: string[] = [];
  for (const part of prompt.split(',')) {
    const tag = part.trim().toLowerCase();
    if (FRAMING_TAGS.has(tag)) {
      if (seen) continue;
      seen = true;
    }
    kept.push(part.trim());
  }
  return kept.filter(Boolean).join(', ');
}

/** Négatif plausible : anglais, sans mot français (un négatif douteux est simplement écarté). */
export function looksLikeEnglishNegative(negative: string): boolean {
  const functionHits = (negative.match(FRENCH_FUNCTION_WORDS) ?? []).length;
  const contentHits = (negative.match(FRENCH_CONTENT_WORDS) ?? []).length;
  return functionHits === 0 && contentHits === 0 && negative.length <= 600;
}
