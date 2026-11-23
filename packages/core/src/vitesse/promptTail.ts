/**
 * Note de fin de tour (mission « Jarvis plus rapide, sans nouveau modèle »).
 *
 * **Plus utilisée depuis le 19 novembre 2026.** Avec la personnalisation de l'utilisateur (prénom,
 * « réponds court »), la note placée devant la demande faisait répondre le modèle à la note au
 * lieu d'appeler l'outil : informations du PC 2 fois sur 10, contre 10 sur 10 avec la ligne
 * d'heure dans le message système (`rapports/2026-11-19-correction-outils-pc.md`). La ligne
 * d'heure est revenue dans le message système pour toutes les équipes. Ce fichier reste pour
 * mémoire et pour ses tests ; ne pas le rebrancher sans la décision de l'utilisateur et sans
 * repasser `banc:outils-pc`.
 *
 * Ollama garde en mémoire le début d'un prompt déjà lu : tant que ce début ne change pas, il
 * n'est pas relu. La ligne d'heure change chaque minute ; placée dans le message système, elle
 * faisait relire tout ce qui la suit (les outils de l'équipe et tout l'historique) à chaque
 * nouvelle minute. Mesuré sur la RTX 2060 avec `qwen2.5:7b` : 3,0 s pour 3 000 jetons, contre
 * 0,15 à 0,5 s quand la ligne est à la fin.
 *
 * Elle est donc placée dans la demande du tour, juste avant les mots de l'utilisateur, **dans la
 * copie envoyée au modèle seulement**. Tout ce qui précède (consignes, outils, historique) reste
 * identique d'une minute à l'autre. La demande reste la dernière chose que le modèle lit : placée
 * après elle, la note faisait parfois répondre sans appeler l'outil (2 fois sur 7 au banc, contre
 * 0 sur 8 avec la ligne dans le message système). Ce qu'elle dit ne change pas. Le message affiché et enregistré ne change pas.
 * L'agent ne la voit pas non plus : ses règles (musique, recherche, horloge…) lisent la demande
 * telle que l'utilisateur l'a faite.
 */
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../providers/types.js';
import type { ChatMessage } from '../types.js';

/** Dit au modèle que la note vient de Jarvis, pas de l'utilisateur. */
export const TURN_NOTE_LABEL = '[Note de Jarvis, pas de l’utilisateur]';

export function turnNote(text: string): string {
  return `${TURN_NOTE_LABEL} ${text.trim()}`;
}

/**
 * Copie des messages avec la note en tête de la demande du tour (`messageId`), sinon du
 * dernier message de l'utilisateur. Sans message utilisateur, ou note vide : rien ne change.
 */
export function appendTurnNote(messages: readonly ChatMessage[], note: string, messageId?: string): ChatMessage[] {
  const text = note.trim();
  if (!text) return [...messages];
  let index = messageId ? messages.findIndex((message) => message.id === messageId && message.role === 'user') : -1;
  if (index < 0) {
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor]!.role === 'user') {
        index = cursor;
        break;
      }
    }
  }
  if (index < 0) return [...messages];
  const target = messages[index]!;
  const prefix = turnNote(text);
  const content = target.content.trim() ? `${prefix}\n\n${target.content}` : prefix;
  return messages.map((message, position) => (position === index ? { ...message, content } : message));
}

/**
 * Même fournisseur : la note est ajoutée à la demande du tour au moment de l'envoi. Tous les
 * appels du tour (réponse, puis réponse après un outil) portent la même note, donc le même
 * début de prompt.
 */
export function withTrailingNote(provider: LLMProvider, note: string, messageId?: string): LLMProvider {
  if (!note.trim()) return provider;
  return {
    id: provider.id,
    label: provider.label,
    model: provider.model,
    requiresApiKey: provider.requiresApiKey,
    streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
      return provider.streamChat({ ...request, messages: appendTurnNote(request.messages, note, messageId) });
    },
  };
}

/**
 * Mots qui parlent de temps. Dès qu'une demande en contient un, la ligne d'heure reste dans le
 * message système, comme avant : au banc, placée dans la demande, elle n'était plus citée qu'une
 * fois sur deux pour une question d'heure indirecte (« il est déjà tard, non ? »). La liste est
 * large exprès : un mot de trop ne coûte qu'un peu de vitesse, un mot oublié peut coûter une
 * réponse juste.
 */
const TIME_WORDS = [
  'heure', 'heures', 'h', 'minute', 'minutes', 'seconde', 'secondes', 'tard', 'tot', 'retard', 'avance',
  'jour', 'jours', 'journee', 'date', 'dates', 'quand', 'aujourd', 'hui', 'demain', 'hier', 'avant hier',
  'matin', 'matinee', 'midi', 'apres midi', 'aprem', 'soir', 'soiree', 'nuit', 'minuit',
  'semaine', 'semaines', 'week end', 'weekend', 'mois', 'annee', 'annees', 'an', 'ans', 'siecle',
  'temps', 'moment', 'maintenant', 'bientot', 'deja', 'encore', 'actuellement', 'instant', 'duree', 'longtemps',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
  'horloge', 'reveil', 'minuteur', 'chrono', 'chronometre', 'rappel', 'rappelle', 'alarme', 'compte a rebours',
  'rendez vous', 'rdv', 'agenda', 'calendrier', 'horaire', 'horaires', 'planning', 'echeance', 'delai',
  'anniversaire', 'age', 'noel', 'vacances', 'ferie', 'saison', 'ete', 'hiver', 'printemps', 'automne',
  'dernier', 'derniere', 'derniers', 'dernieres', 'prochain', 'prochaine', 'prochains', 'prochaines',
  'recent', 'recente', 'recents', 'recentes', 'actuel', 'actuelle', 'actuels', 'actuelles', 'actualite', 'actualites',
  'il est', 'on est', 'sommes nous', 'nous sommes', 'depuis', 'jusqu', 'pendant', 'dans combien',
];

/** Vrai si la demande parle de temps, d'heure ou de date (mots entiers, sans casse ni accent). */
export function mentionsTime(text: string): boolean {
  const folded = ` ${text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
  if (/\s\d{1,2}\s?h(?:\s?\d{2})?\s/.test(folded)) return true;
  return TIME_WORDS.some((word) => folded.includes(` ${word} `));
}
