/**
 * Note ajoutée au prompt système, jamais au message utilisateur, quand ce
 * message vient de la reconnaissance vocale plutôt que du clavier. Elle
 * n'est donc jamais stockée dans une `ChatMessage`, jamais affichée dans
 * l'historique visible, et jamais persistée par le `ConversationStore` :
 * seul le texte transcrit (propre) l'est.
 *
 * Motivation concrète : Whisper transcrit de façon reproductible « ouvre »
 * en « ouf » chez certains utilisateurs (limite du modèle de transcription,
 * pas un bug de découpage — voir le rapport `whisper-local-transcription`).
 * Un modèle de conversation prévenu de l'origine vocale interprète
 * correctement « ouf Chrome » comme « ouvre Chrome » ; sans cette note, il
 * prend le texte au pied de la lettre.
 */
export const VOICE_TRANSCRIPTION_NOTICE = [
  "Note système (jamais montrée à l'utilisateur) : le message qui suit vient d'une",
  'transcription vocale automatique, pas du clavier. Il peut contenir des erreurs',
  "phonétiques (mot déformé en un autre qui se prononce presque pareil) : interprète",
  "l'intention plutôt que le texte exact si un mot ne fait pas sens.",
  'IMPORTANT : chez cet utilisateur, le mot « ouf » est TOUJOURS une erreur de',
  "transcription pour le verbe « ouvre » (jamais l'interjection). Remplace-le avant de",
  'répondre. Exemple : « ouf Chrome » = « ouvre Chrome » -> appelle open_application,',
  'jamais close_application.',
].join(' ');

export type MessageOrigin = 'voice' | 'text';

/**
 * Ajoute la note ci-dessus au prompt système pour ce tour, seulement quand
 * le dernier message utilisateur vient de la voix. Ne modifie jamais le
 * prompt système des réglages ni le contenu du message : l'appelant doit
 * passer le résultat uniquement à l'agent pour ce tour précis.
 */
export function withVoiceOriginNotice(systemPrompt: string, origin: MessageOrigin): string {
  if (origin !== 'voice') return systemPrompt;
  return `${systemPrompt}\n\n${VOICE_TRANSCRIPTION_NOTICE}`;
}
