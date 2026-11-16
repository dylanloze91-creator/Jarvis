import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import { previousFromHistory } from './history.js';

describe('carnet — tour précédent (synthetique-test)', () => {
  it('synthetique-test retrouve la demande et la réponse d’avant', () => {
    const previous = previousFromHistory([
      createMessage('user', 'Quelle heure est-il ?'),
      createMessage('assistant', 'Il est 3 heures.'),
      createMessage('user', "ça n'a pas marché"),
    ]);
    expect(previous).toMatchObject({
      userText: 'Quelle heure est-il ?',
      replyText: 'Il est 3 heures.',
    });
  });

  it('synthetique-test rien à noter s’il n’y a pas encore de réponse', () => {
    expect(previousFromHistory([createMessage('user', 'bonjour')])).toBeNull();
  });
});
