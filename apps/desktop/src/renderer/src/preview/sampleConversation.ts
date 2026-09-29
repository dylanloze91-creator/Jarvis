import type { Conversation } from '@jarvis/core';

/** Conversation d’exemple pour prévisualiser l’interface (captures, mode aperçu). */
export const SAMPLE_CONVERSATION: Conversation = {
  id: 'preview-chat',
  title: 'Actualités du jour',
  createdAt: 1,
  updatedAt: 2,
  messages: [
    {
      id: 'u1',
      role: 'user',
      content: 'Quelles sont les actualités importantes aujourd’hui ?',
      createdAt: 1,
    },
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      createdAt: 2,
      toolCalls: [{ id: 't1', name: 'web_research', arguments: {} }],
    },
    {
      id: 't1',
      role: 'tool',
      toolName: 'web_research',
      toolCallId: 't1',
      content:
        'Recherche multi-angle terminée via Google.\nRequêtes : actualités importantes aujourd’hui | sources officielles\n\n1. Titres du jour — Le Monde\n   URL : https://www.lemonde.fr',
      createdAt: 3,
    },
    {
      id: 'a2',
      role: 'assistant',
      content:
        'Voici ce que je retiens des sources du jour :\n\n- **Europe** — discussions budgétaires et énergie restent en tête des unes.\n- **Tech** — les modèles locaux continuent de progresser pour un usage hors-ligne.\n\nSource citée : [Le Monde](https://www.lemonde.fr). Je n’ai pas traité les extraits du moteur comme une preuve.',
      createdAt: 4,
    },
  ],
};
