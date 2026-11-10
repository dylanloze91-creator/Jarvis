/**
 * Ce qui se regarde se dit court à l'enceinte et s'affiche sur le PC.
 * Une phrase ordinaire, tapée ou dite au PC, ne passe pas par ici.
 */

import { speechTextForSpeaker } from './speaker.js';

/** Pas d'estimation Imager avant le calcul : phrase fixe. */
export const SPEAKER_IMAGE_WAIT = 'Je la prépare sur le PC, ça prend environ une minute.';

export const SPEAKER_IMAGE_READY = "C'est fait, l'image est sur l'écran du PC.";

export const SPEAKER_LIST_ON_PC = "Je t'ai mis la liste sur le PC.";

export const SPEAKER_DETAIL_ON_PC = 'Le détail est sur le PC.';

export interface SpeakerEarsReply {
  spoken: string;
  /** La fenêtre du PC doit montrer la discussion de l'enceinte. */
  showOnPc: boolean;
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isGeneratedImage(text: string): boolean {
  return /image générée/i.test(text) || /images générées/i.test(text);
}

function isListOrTable(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => /^(?:[-*+]|\d+[.)])\s+\S/.test(line));
  if (bullets.length >= 4) return true;
  return lines.some((line) => /\|?\s*:?-{3,}:?\s*\|/.test(line));
}

function hasCode(text: string): boolean {
  return /```/.test(text);
}

function hasSources(text: string): boolean {
  return /\n\s*sources?\s*:/i.test(text) || /\[[^\]]{2,80}\]\(https?:\/\//.test(text);
}

function hasDocument(text: string): boolean {
  return /\.(?:pdf|docx?|xlsx?|pptx?|md)\b/i.test(text);
}

function withDetail(prose: string): string {
  const head = sentencesOf(prose).slice(0, 3).join(' ');
  if (!head) return SPEAKER_DETAIL_ON_PC;
  if (head.includes(SPEAKER_DETAIL_ON_PC)) return head;
  return `${head} ${SPEAKER_DETAIL_ON_PC}`;
}

/**
 * Phrase courte et vraie pour l'enceinte. Le texte complet reste dans la
 * discussion, sur l'écran du PC quand `showOnPc` est vrai.
 */
export function speakerReplyForEars(reply: string): SpeakerEarsReply {
  const raw = reply.trim();
  if (!raw) return { spoken: '', showOnPc: false };
  if (isGeneratedImage(raw)) return { spoken: SPEAKER_IMAGE_READY, showOnPc: true };
  if (isListOrTable(raw)) return { spoken: SPEAKER_LIST_ON_PC, showOnPc: true };
  const prose = speechTextForSpeaker(raw);
  const long = sentencesOf(prose).length > 3;
  if (hasCode(raw) || hasSources(raw) || hasDocument(raw) || long) {
    return { spoken: withDetail(prose), showOnPc: true };
  }
  return { spoken: prose, showOnPc: false };
}
