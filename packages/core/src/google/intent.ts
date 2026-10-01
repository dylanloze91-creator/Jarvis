import type { ChatMessage } from '../types.js';

export function isGoogleToolName(name: string): boolean {
  return name.startsWith('google_');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, "'");
}

const GOOGLE_VOCABULARY = [
  /\bg ?mail\b/,
  /\be-?mails?\b/,
  /\bmails?\b/,
  /\bcourriels?\b/,
  /\bboite (?:de reception|mail|aux lettres)\b/,
  /\binbox\b/,
  /\bbrouillons?\b/,
  /\b(?:mes|nouveaux|derniers|dernier) messages?\b/,
  /\bmessages? (?:non lus?|recus?)\b/,
  /\bagenda\b/,
  /\bcalendrier\b/,
  /\bcalendar\b/,
  /\brendez-vous\b/,
  /\brdv\b/,
  /\breunions?\b/,
  /\bplanning\b/,
  /\bemploi du temps\b/,
  /\bde prevu\b/,
  /\b(?:suis-je|je suis|est-ce que je suis) (?:libre|dispo)/,
  /\bj'ai quoi\b/,
  /\bqu'est-ce que j'ai (?:aujourd'hui|demain|ce|cette|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/,
  /\bevenements? (?:dans|de|a) (?:mon|l')agenda\b/,
  /\b(?:google )?drive\b/,
  /\bgoogle docs?\b/,
  /\bdocs? google\b/,
  /\bdocuments? google\b/,
  /\bgoogle (?:sheets?|agenda|calendar|workspace)\b/,
  /\bsheets?\b/,
  /\bfeuilles? de calcul\b/,
  /\btableurs?\b/,
  /\bspreadsheets?\b/,
  /docs\.google\.com|drive\.google\.com/,
];

/**
 * Demande qui concerne Gmail, l'agenda, Drive, Docs ou Sheets. Sert
 * uniquement à proposer les outils `google_*` au modèle pour ce tour : un
 * « cherche sur Google » reste une recherche web, « ouvre Chrome » reste une
 * application.
 */
export function looksLikeGoogleIntent(prompt: string): boolean {
  const text = normalize(prompt.trim());
  if (!text) return false;
  return GOOGLE_VOCABULARY.some((pattern) => pattern.test(text));
}

/**
 * Un suivi (« envoie-le », « décale-le à 15 h ») garde les outils Google
 * si l'un des deux échanges précédents s'en est servi.
 */
export function recentlyUsedGoogleTools(conversation: ChatMessage[], userTurns = 2): boolean {
  let seenUsers = 0;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message) continue;
    if (message.role === 'user') {
      seenUsers += 1;
      if (seenUsers > userTurns) return false;
      continue;
    }
    if (message.toolCalls?.some((call) => isGoogleToolName(call.name))) return true;
    if (message.role === 'tool' && message.toolName && isGoogleToolName(message.toolName)) return true;
  }
  return false;
}
