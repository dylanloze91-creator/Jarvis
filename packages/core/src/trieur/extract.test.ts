import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import {
  extractFromConversations,
  normalizePhrase,
  parseToSortLine,
  phraseKey,
  type StoredConversation,
} from './extract.js';
import { routerUserPrompt } from '../agent/orchestra.js';

describe('trieur extract', () => {
  it('garde le contexte comme routerUserPrompt (4 derniers échanges)', () => {
    const messages = [
      createMessage('user', 'Ouvre Chrome'),
      createMessage('assistant', 'C’est fait.'),
      createMessage('user', 'Et ferme-le'),
    ];
    const conversation: StoredConversation = {
      id: 'c1',
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      messages,
    };
    const lines = extractFromConversations([conversation]);
    expect(lines).toHaveLength(2);
    const last = lines.find((line) => line.phrase.includes('ferme'));
    expect(last?.context).toBe(routerUserPrompt('Et ferme-le', messages.slice(0, 2)));
  });

  it('retire les doublons (même phrase et même contexte) et les phrases vides', () => {
    const conv = (): StoredConversation => ({
      id: createMessage('user', 'x').id,
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      messages: [createMessage('user', 'Bonjour')],
    });
    expect(extractFromConversations([conv(), conv()])).toHaveLength(1);
    expect(
      extractFromConversations([
        { ...conv(), messages: [createMessage('user', 'Bonjour'), createMessage('user', '   ')] },
      ]),
    ).toHaveLength(1);
  });

  it('suggestion jamais confondue avec une réponse (champ séparé)', () => {
    const user = createMessage('user', 'Lance Spotify');
    const conversation: StoredConversation = {
      id: 'c1',
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      messages: [user],
      routeLog: [{ userMessageId: user.id, team: 'musique', how: 'express' }],
    };
    const [line] = extractFromConversations([conversation]);
    expect(line?.suggestion).toBe('musique');
    const parsed = parseToSortLine(JSON.parse(JSON.stringify(line)));
    expect(parsed?.suggestion).toBe('musique');
    expect(parsed).not.toHaveProperty('team');
  });

  it('exemples synthétiques marqués synthetique-test', () => {
    const raw = {
      id: phraseKey('test', ''),
      phrase: 'test',
      context: '',
      meta: { 'synthetique-test': true },
    };
    expect(parseToSortLine(raw)?.synthetiqueTest).toBe(true);
  });

  it('normalise les espaces', () => {
    expect(normalizePhrase('a  \n b')).toBe('a b');
  });
});
