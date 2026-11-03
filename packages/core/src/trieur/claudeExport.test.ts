import { describe, expect, it } from 'vitest';
import {
  CLAUDE_EXPORT_SOURCE,
  claudeHumanMessageText,
  extractFromClaudeExport,
  isPastedCodeBlock,
  mergeToSortLines,
  shouldKeepClaudeUserPhrase,
  type ClaudeExportConversation,
} from './claudeExport.js';
import { extractFromConversations, phraseKey } from './extract.js';
import { createMessage } from '../types.js';

const SYNTHETIQUE = { synthetiqueTest: true } as const;

function synthConversation(messages: ClaudeExportConversation['chat_messages']): ClaudeExportConversation {
  return {
    uuid: 'synthetique-test-conv',
    chat_messages: messages,
  };
}

describe('trieur claude export', () => {
  it('garde seulement les messages utilisateur, verbatim, avec le message utilisateur précédent comme contexte', () => {
    const conversations = [
      synthConversation([
        {
          uuid: 'm1',
          sender: 'human',
          text: 'Première question',
          created_at: '2026-01-01T10:00:00.000Z',
        },
        {
          uuid: 'm2',
          sender: 'assistant',
          text: 'Réponse longue de Claude',
          created_at: '2026-01-01T10:00:01.000Z',
          parent_message_uuid: 'm1',
        },
        {
          uuid: 'm3',
          sender: 'human',
          text: 'Et demain ?',
          created_at: '2026-01-01T10:00:02.000Z',
          parent_message_uuid: 'm2',
        },
      ]),
    ];
    const lines = extractFromClaudeExport(conversations, SYNTHETIQUE);
    expect(lines).toHaveLength(2);
    const first = lines.find((line) => line.phrase === 'Première question');
    const follow = lines.find((line) => line.phrase === 'Et demain ?');
    expect(first?.context).toBe('');
    expect(follow?.context).toBe('Première question');
    expect(lines.every((line) => line.source === CLAUDE_EXPORT_SOURCE)).toBe(true);
    expect(lines.every((line) => line.synthetiqueTest)).toBe(true);
  });

  it('ignore assistant, doublons, vide, >400 caractères et blocs de code', () => {
    const long = 'a'.repeat(401);
    const conversations = [
      synthConversation([
        { uuid: 'a1', sender: 'human', text: 'Bonjour' },
        { uuid: 'a2', sender: 'human', text: 'Bonjour' },
        { uuid: 'a3', sender: 'human', text: '   ' },
        { uuid: 'a4', sender: 'human', text: long },
        { uuid: 'a5', sender: 'human', text: '```python\nprint(1)\n```' },
        { uuid: 'a6', sender: 'assistant', text: 'Je ne dois pas apparaître' },
      ]),
    ];
    const lines = extractFromClaudeExport(conversations, SYNTHETIQUE);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.phrase).toBe('Bonjour');
  });

  it('lit les blocs content[] texte sans réécrire', () => {
    const text = 'Garde  les   espaces';
    expect(
      claudeHumanMessageText({
        uuid: 'c1',
        sender: 'human',
        content: [{ type: 'text', text }],
      }),
    ).toBe(text);
  });

  it('détecte un collage de code indenté', () => {
    const code = 'function x() {\n    return 1;\n}\nconsole.log(x());';
    expect(isPastedCodeBlock(code)).toBe(true);
    expect(shouldKeepClaudeUserPhrase('Ouvre le fichier config')).toBe(true);
  });

  it('fusionne avec les conversations Jarvis sans écraser les suggestions', () => {
    const user = createMessage('user', 'Lance Spotify');
    const jarvis = extractFromConversations([
      {
        id: 'j1',
        title: 't',
        createdAt: 0,
        updatedAt: 0,
        messages: [user],
        routeLog: [{ userMessageId: user.id, team: 'musique' }],
      },
    ]);
    const claude = extractFromClaudeExport(
      [synthConversation([{ uuid: 'x1', sender: 'human', text: 'Autre phrase' }])],
      SYNTHETIQUE,
    );
    const merged = mergeToSortLines(jarvis, claude);
    expect(merged).toHaveLength(2);
    const spotify = merged.find((line) => line.phrase.includes('Spotify'));
    expect(spotify?.suggestion).toBe('musique');
    const autre = merged.find((line) => line.phrase === 'Autre phrase');
    expect(autre?.source).toBe(CLAUDE_EXPORT_SOURCE);
    expect(phraseKey('Autre phrase', '')).toBe(autre?.id);
  });
});
