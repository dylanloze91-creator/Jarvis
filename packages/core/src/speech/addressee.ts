/**
 * 5.0.62 — « est-ce à moi qu'on parle ? ». Pur : pas de réseau, pas de modèle.
 *
 * Deux moments :
 * 1. **Après un réveil** : Vosk entend « Jarvis » partout, y compris dans « tu connais Jarvis ? ».
 *    `wakeWordAddress` lit la transcription : le mot de réveil en tête (après un « bon », « ok »…),
 *    en apostrophe entre virgules ou en fin de phrase = on lui parle ; précédé d'un article, d'une
 *    préposition ou d'une autre phrase = on parle **de** lui.
 * 2. **Pendant la discussion sans mot de réveil** : `followUpAddressee` tranche les cas évidents
 *    (un ordre, une question en « tu », « et demain ? »). Le reste est demandé au modèle par la
 *    session (`addresseeSystemPrompt`, `parseAddresseeReply`) ; en cas de doute, on considère que
 *    c'est pour Jarvis plutôt que de perdre une vraie demande.
 */
import type { ChatMessage } from '../types.js';
import {
  defaultWakeWordVariants,
  levenshteinDistance,
  normalizeForWakeWordMatch,
  type WakeWordTextMatchConfig,
} from './wakeWordTextMatch.js';

export type WakeAddress = 'address' | 'mention' | 'absent';

/** Petits mots qui peuvent précéder « Jarvis » quand on l'appelle. */
const INTERJECTIONS = new Set([
  'bon', 'ok', 'okay', 'oke', 'alors', 'eh', 'he', 'hey', 'dis', 'euh', 'heu', 'salut', 'bonjour', 'bonsoir',
  'coucou', 'allez', 'oui', 'non', 'bah', 'ben', 'bref', 'donc', 'hop', 'yo', 'merci', 'stp', 'pardon', 'ecoute',
  'dismoi', 'moi', 'aussi', 'et', 'ah', 'oh',
]);

/** Mots qui, juste avant « Jarvis », disent qu'on parle de lui (« le Jarvis », « tu connais Jarvis »). */
const MENTION_MARKERS = new Set([
  'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'a', 'au', 'aux', 'avec', 'sur', 'pour', 'par', 'sans', 'chez',
  'mon', 'ton', 'son', 'notre', 'votre', 'leur', 'ce', 'cet', 'cette', 'que', 'qu', 'connais', 'connait',
  'connaissez', 'appelle', 'appele', 'appelee', 'nomme', 'installe', 'installer', 'utilise', 'utiliser',
  'programme', 'code', 'teste', 'tester', 'montre', 'parle', 'parler', 'vu', 'entendu', 'aime', 'deteste',
]);

interface Word {
  plain: string;
  /** Ponctuation collée juste avant / juste après le mot dans le texte d'origine. */
  commaBefore: boolean;
  commaAfter: boolean;
}

function words(text: string): Word[] {
  const out: Word[] = [];
  const regex = /[^\s,;:.!?…«»"]+/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(0, match.index).trimEnd();
    const after = text.slice(match.index + match[0].length).trimStart();
    out.push({
      plain: normalizeForWakeWordMatch(match[0]).replace(/\s+/g, ''),
      commaBefore: /[,;:—–-]$/.test(before),
      commaAfter: /^[,;:—–-]/.test(after) || /^[?!.…]/.test(after),
    });
  }
  return out;
}

function isWakeToken(plain: string, config: WakeWordTextMatchConfig): boolean {
  if (!plain) return false;
  const canonical = normalizeForWakeWordMatch(config.word).replace(/\s+/g, '');
  const variants = [...defaultWakeWordVariants(config.word), ...(config.variants ?? [])]
    .map((variant) => normalizeForWakeWordMatch(variant).replace(/\s+/g, ''))
    .filter(Boolean);
  if (plain === canonical || variants.includes(plain)) return true;
  return canonical.length >= 5 && levenshteinDistance(plain, canonical) <= 1;
}

/**
 * Le mot de réveil s'adresse-t-il à Jarvis ? `absent` : Whisper ne l'a pas écrit (souvent déformé),
 * on garde alors le comportement d'avant (la commande part).
 */
export function wakeWordAddress(transcript: string, config: WakeWordTextMatchConfig): WakeAddress {
  const list = words(transcript);
  const index = list.findIndex((word) => isWakeToken(word.plain, config));
  if (index === -1) return 'absent';
  const before = list.slice(0, index);
  const after = list.slice(index + 1);
  const wake = list[index]!;
  // En tête, ou seulement après des petits mots d'appel (« Bon, Jarvis », « Ok Jarvis »).
  if (before.every((word) => INTERJECTIONS.has(word.plain))) return 'address';
  const previous = before.at(-1)!.plain;
  if (MENTION_MARKERS.has(previous)) return 'mention';
  // En apostrophe : « Dis-moi, Jarvis, quelle heure… », « Quelle heure est-il, Jarvis ? ».
  if (wake.commaBefore && (after.length === 0 || wake.commaAfter)) return 'address';
  // En fin de phrase sans virgule : « C'est quoi la météo Jarvis ».
  if (after.length === 0) return 'address';
  return 'mention';
}

/**
 * « Quelle heure est-il, Jarvis ? » → « Quelle heure est-il ? ». Ne touche qu'au mot de réveil en
 * fin de phrase (le début est déjà retiré par `commandAfterWakeWord`).
 */
export function stripTrailingWakeWord(text: string, config: WakeWordTextMatchConfig): string {
  const match = /^(.*?)[\s,;:—–-]+([^\s,;:.!?…«»"]+)\s*([?!.…]*)\s*$/su.exec(text.trim());
  if (!match) return text.trim();
  const [, head, last, end] = match;
  if (!head?.trim() || !isWakeToken(normalizeForWakeWordMatch(last ?? '').replace(/\s+/g, ''), config)) return text.trim();
  return `${head.trim()}${end === '?' || end === '!' ? ` ${end}` : end ?? ''}`.trim();
}

export type AddresseeVerdict = 'yes' | 'no' | 'unsure';

const COMMAND_START =
  /^(?:et\s+)?(?:ouvre|ferme|lance|mets|met|joue|arr[eê]te|coupe|baisse|monte|augmente|diminue|cherche|trouve|lis|montre|affiche|dis[- ]moi|donne|calcule|rappelle|ajoute|supprime|enl[eè]ve|cr[ée]e|envoie|[ée]cris|r[ée]sume|traduis|explique|continue|recommence|refais|r[ée]p[eè]te|passe|reprends|pause|suivant|pr[ée]c[ée]dent|bloque|d[ée]bloque|active|d[ée]sactive|v[ée]rifie|regarde|note|retiens|oublie|programme|planifie|annule|valide|confirme|r[ée]ponds)\b/iu;
const SECOND_PERSON_QUESTION =
  /^(?:et\s+)?(?:est[- ]ce que (?:tu|vous)|peux[- ]tu|pourrais[- ]tu|tu (?:peux|pourrais|sais|connais|as|veux|penses|crois)|sais[- ]tu|as[- ]tu|connais[- ]tu)\b/iu;
const SHORT_FOLLOW_UP = /^(?:et\s+(?:demain|apr[eè]s|maintenant|ensuite|pour|si|le|la|les|l['’]|en|avec|celui|celle|[àa])\b|merci\b|oui\b|non\b|d['’]accord\b|ok\b|vas[- ]y\b|parfait\b|super\b)/iu;

/**
 * Règles sûres pour une parole sans mot de réveil, pendant la discussion. `unsure` : la session
 * demande au modèle.
 */
export function followUpAddressee(text: string, config: WakeWordTextMatchConfig): AddresseeVerdict {
  const trimmed = text.trim();
  if (!trimmed) return 'no';
  const wake = wakeWordAddress(trimmed, config);
  if (wake === 'address') return 'yes';
  if (wake === 'mention') return 'no';
  const plain = trimmed.replace(/^[\s«"'-]+/u, '');
  if (COMMAND_START.test(plain) || SECOND_PERSON_QUESTION.test(plain) || SHORT_FOLLOW_UP.test(plain)) return 'yes';
  return 'unsure';
}

export const ADDRESSEE_SYSTEM_PROMPT = [
  'Tu entends ce qui se dit dans une pièce où se trouve Jarvis, un assistant vocal.',
  'Jarvis vient de répondre à l’utilisateur. Une nouvelle phrase a été prononcée, sans le mot « Jarvis ».',
  'Dis si cette phrase s’adresse à Jarvis (une suite de la conversation, une demande, une question pour lui)',
  'ou à quelqu’un d’autre dans la pièce (une discussion entre personnes, au téléphone, un commentaire sur Jarvis).',
  'Réponds par un seul mot : oui si elle s’adresse à Jarvis, non sinon.',
].join(' ');

/** Fin de la conversation (3 derniers échanges) puis la phrase entendue. */
export function addresseeUserPrompt(text: string, history: readonly ChatMessage[]): string {
  const recent = history
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
    .slice(-3)
    .map((message) => {
      const content = message.content.replace(/\s+/g, ' ').trim();
      return `${message.role === 'user' ? 'Utilisateur' : 'Jarvis'} : ${content.length > 200 ? `${content.slice(0, 200)}…` : content}`;
    });
  return [
    recent.length ? `Conversation récente :\n${recent.join('\n')}\n` : '',
    `Phrase entendue : « ${text.trim()} »`,
    'S’adresse-t-elle à Jarvis ?',
  ]
    .filter(Boolean)
    .join('\n');
}

/** « non » seulement si le modèle le dit clairement ; tout le reste vaut « oui » (ne jamais perdre une demande). */
export function parseAddresseeReply(reply: string): 'yes' | 'no' {
  const first = normalizeForWakeWordMatch(reply).split(' ').find(Boolean) ?? '';
  return first === 'non' || first === 'no' ? 'no' : 'yes';
}

/** Fenêtre de suivi par défaut, après la fin d'une réponse : 8 s. */
export const DEFAULT_FOLLOW_UP_SECONDS = 8;

export function followUpWindowMs(voice: { followUpSeconds?: number | undefined } | undefined): number {
  const seconds = voice?.followUpSeconds;
  return Math.round((seconds === undefined ? DEFAULT_FOLLOW_UP_SECONDS : Math.max(0, Math.min(120, seconds))) * 1000);
}

/** Vérification « est-ce pour moi ? » : active sauf si l'utilisateur l'a coupée. */
export function addresseeCheckEnabled(voice: { addresseeCheck?: boolean | undefined } | undefined): boolean {
  return voice?.addresseeCheck !== false;
}
