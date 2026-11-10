/**
 * Demande d'image : sert au chemin express du chef d'orchestre (équipe « images »)
 * et, sans orchestre, à ne proposer les outils d'image qu'au tour qui en parle.
 */

import type { ChatMessage } from '../types.js';

export const IMAGE_TOOL_NAMES = ['generer_image', 'images_etat'] as const;

export function isImageToolName(name: string): boolean {
  return (IMAGE_TOOL_NAMES as readonly string[]).includes(name);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'");
}

/** Ce que l'on génère : une image et ses synonymes. */
const SUBJECTS =
  '(?:images?|illustrations?|dessins?|stickers?|autocollants?|logos?|miniatures?|visuels?|affiches?|posters?|icones?|fonds? d\'ecran|wallpapers?|vignettes?|artworks?|portraits? (?:dessine|illustre)s?)';

/** Verbes de création. */
const VERBS = '(?:genere|generer|cree|creer|dessine|dessiner|fais|faire|fabrique|fabriquer|produis|produire|invente|inventer|imagine|imaginer|realise|realiser|conçois|concevoir|peins|peindre)';

const PATTERNS = [
  // « génère une image de… », « fais-moi un sticker… », « crée 3 miniatures… »
  new RegExp(`\\b${VERBS}(?:[- ]?(?:moi|nous|en|lui))?\\s+(?:une?|des|le|la|les|\\d+|un nouveau|une nouvelle|mon|ma|mes)?\\s*(?:nouvel(?:le)?s?\\s+)?${SUBJECTS}\\b`),
  // « une image de … » en tête de phrase, sans verbe (« une image d'un chat sur un toit »)
  new RegExp(`^(?:une?|des|\\d+)\\s+${SUBJECTS}\\s+(?:de|d'|du|des|pour|avec|qui|representant|montrant)\\b`),
  // « dessine-moi un chat » (sans le mot image)
  /\b(?:dessine|dessiner|peins|peindre)(?:[- ]?(?:moi|nous))?\s+(?:une?|des|le|la|les|\d+|mon|ma|mes)\b/,
  // outils et vocabulaire du domaine
  /\b(?:stable diffusion|sdxl|forge|text[- ]to[- ]image|txt2img|lora)\b/,
  /\bgeneration d'images?\b/,
  /\b(?:en|au format|version)\s+(?:16:9|9:16)\b.*\b(?:image|miniature|visuel)/,
];

/** Pas une génération : parler des images déjà faites, d'une image disque, d'un fichier. */
const EXCLUSIONS = [
  /\bimage (?:disque|iso|systeme|docker)\b/,
  /\b(?:ouvre|affiche|montre|cherche|trouve|supprime|renomme|deplace|copie|envoie|lis)\b[^.]*\b(?:l'image|les images|cette image|ces images|le dessin|ce fichier)\b/,
];

export function looksLikeImageIntent(prompt: string): boolean {
  const text = normalize(prompt.trim());
  if (!text) return false;
  if (EXCLUSIONS.some((pattern) => pattern.test(text))) return false;
  return PATTERNS.some((pattern) => pattern.test(text));
}

/** Un suivi (« la même en 16:9 », « encore une ») garde les outils si un des deux échanges précédents les a utilisés. */
export function recentlyUsedImageTools(conversation: ChatMessage[], userTurns = 2): boolean {
  let seenUsers = 0;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message) continue;
    if (message.role === 'user') {
      seenUsers += 1;
      if (seenUsers > userTurns) return false;
      continue;
    }
    if (message.toolCalls?.some((call) => isImageToolName(call.name))) return true;
    if (message.role === 'tool' && message.toolName && isImageToolName(message.toolName)) return true;
  }
  return false;
}

/** Consigne ajoutée au tour qui propose les outils d'image (chat sans orchestre et équipe Images). */
export function imagesTurnPrompt(): string {
  return [
    'JARVIS IMAGER : pour toute image, appelle generer_image tout de suite, sans phrase d’introduction (l’outil prévient lui-même l’utilisateur et met une à trois minutes). N’écris pas la consigne Stable Diffusion toi-même : transmets dans « demande » les mots de l’utilisateur, le projet (jarvis, vx, drivers-ink ou perso ; perso si rien ne l’indique), le « type » (personne, objet, paysage, logo-sticker, scene, autre), « nombrePersonnes » si la demande en parle, « rendu » (anime si l’utilisateur parle d’anime, de manga, de dessin animé ou d’un personnage de série ; realiste s’il veut une photo ; sinon rien), et seulement les options demandées (format, nombre d’images, graine, LoRA, agrandir). Si le message porte une « Photo jointe », passe son chemin dans photoDeBase (et fidelite entre 0 et 1 si l’utilisateur dit à quel point rester proche de la photo).',
    'Ta réponse finale donne le chemin des fichiers renvoyés par l’outil, tel quel. Ne décris jamais une image que l’outil n’a pas produite, et ne dis jamais « je vais générer » sans appeler l’outil.',
  ].join(' ');
}
