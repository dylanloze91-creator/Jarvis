/**
 * Ce qui se regarde se dit court à l'enceinte et s'affiche sur le PC.
 * Une phrase ordinaire, tapée ou dite au PC, ne passe pas par ici.
 */

import { SPEAKER_CONFIRMATION_REFUSAL, SPEAKER_MISSION_PROPOSAL, speechTextForSpeaker } from './speaker.js';
import { speakerReflexPhrase } from './reflex.js';

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
/** Même plafond que `speakerReplyForEars` : 3 phrases, ou 300 caractères. */
export const SPEAKER_EARLY_SENTENCES = 3;
export const SPEAKER_EARLY_CHARS = 300;

/**
 * Pendant que le texte arrive : dès que la partie dite est complète, on peut
 * répondre à l'enceinte. Réponse déjà finie : la règle d'aujourd'hui
 * (`speakerReplyForEars`), y compris une phrase courte sans « le détail est sur le PC ».
 */
export function earlySpeakerUtterance(
  partial: string,
  finished: boolean,
): { ready: boolean; spoken: string; showOnPc: boolean } {
  if (finished) {
    const ears = speakerReplyForEars(partial);
    return { ready: Boolean(ears.spoken), spoken: ears.spoken, showOnPc: ears.showOnPc };
  }
  const raw = partial.trim();
  if (!raw) return { ready: false, spoken: '', showOnPc: false };
  if (isGeneratedImage(raw)) return { ready: true, spoken: SPEAKER_IMAGE_READY, showOnPc: true };
  if (isListOrTable(raw)) return { ready: true, spoken: SPEAKER_LIST_ON_PC, showOnPc: true };
  const prose = speechTextForSpeaker(raw);
  const complete = sentencesOf(prose).filter((sentence) => /[.!?…]$/u.test(sentence));
  if (complete.length < SPEAKER_EARLY_SENTENCES && prose.length < SPEAKER_EARLY_CHARS) {
    return { ready: false, spoken: '', showOnPc: false };
  }
  const head =
    complete.length >= SPEAKER_EARLY_SENTENCES
      ? complete.slice(0, SPEAKER_EARLY_SENTENCES).join(' ')
      : prose.slice(0, SPEAKER_EARLY_CHARS).trim();
  if (!head) return { ready: false, spoken: '', showOnPc: false };
  const spoken = head.includes(SPEAKER_DETAIL_ON_PC) ? head : `${head} ${SPEAKER_DETAIL_ON_PC}`;
  return { ready: true, spoken, showOnPc: true };
}

export interface SpeakerSpeechDecision {
  ready: boolean;
  spoken: string;
  showOnPc: boolean;
  /** Un outil déjà connu : phrase courte, le détail reste sur le PC. */
  reflex: boolean;
}

/**
 * Ce que l'enceinte doit dire maintenant. `finished` : le tour est fini.
 * Un outil Spotify réussi raccourcit la phrase tout de suite. Une carte
 * reste la phrase de refus d'aujourd'hui.
 */
export function decideSpeakerSpeech(input: {
  reply: string;
  finished: boolean;
  refused: boolean;
  mission: boolean;
  notAddressed: boolean;
  tools: readonly string[];
  userText: string;
}): SpeakerSpeechDecision {
  if (input.notAddressed) return { ready: true, spoken: '', showOnPc: false, reflex: true };
  if (input.refused) {
    return { ready: true, spoken: SPEAKER_CONFIRMATION_REFUSAL, showOnPc: false, reflex: true };
  }
  for (let index = input.tools.length - 1; index >= 0; index -= 1) {
    const phrase = speakerReflexPhrase(input.tools[index]!, input.userText);
    if (phrase) return { ready: true, spoken: phrase, showOnPc: true, reflex: true };
  }
  if (input.mission && input.finished) {
    return { ready: true, spoken: SPEAKER_MISSION_PROPOSAL, showOnPc: true, reflex: false };
  }
  const early = earlySpeakerUtterance(input.reply, input.finished);
  return { ready: early.ready, spoken: early.spoken, showOnPc: early.showOnPc, reflex: false };
}

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
