/**
 * Consigne ajoutée au prompt : la mémoire documentaire passe par les outils,
 * jamais par un dump automatique de l’index dans le prompt.
 */
export const KNOWLEDGE_SYSTEM_PROMPT_FRAGMENT = [
  'Pour retrouver une information personnelle, un projet passé, une décision précédente ou un document déjà indexé, utilise search_jarvis_memory ou search_documents.',
  "N'injecte jamais toute la mémoire : seulement les passages renvoyés par l'outil.",
  "N'affirme jamais qu'une information vient de la mémoire si tu ne l'as pas retrouvée avec l'outil.",
  "Pour une demande explicite de mémorisation longue durée d'un fait (pas une préférence de ton/nom), utilise remember_jarvis.",
  'Pour lire un document déjà indexé, utilise read_document. Pour indexer un dossier choisi par l’utilisateur, utilise index_folder ou index_jarvis_folder — seulement sur demande, et après confirmation.',
  'Toute cette mémoire reste sur ce PC ; tu n’as pas accès à un nuage ni à ChatGPT.',
].join(' ');

export function withKnowledgePrompt(systemPrompt: string): string {
  if (/search_jarvis_memory/i.test(systemPrompt)) return systemPrompt;
  return `${systemPrompt} ${KNOWLEDGE_SYSTEM_PROMPT_FRAGMENT}`.trim();
}
