import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../providers/types.js';
import { createMessage } from '../types.js';
import { TURN_NOTE_LABEL, appendTurnNote, turnNote, withTrailingNote } from './promptTail.js';

const NOTE = 'Date et heure du PC : mardi 17 novembre 2026, 12 h 01.';

describe('note de fin de tour', () => {
  it('la note dit qu’elle vient de Jarvis, et garde le texte tel quel', () => {
    expect(turnNote(` ${NOTE} `)).toBe(`${TURN_NOTE_LABEL} ${NOTE}`);
  });

  it('va en tête de la demande du tour, sans toucher aux messages d’origine', () => {
    const first = createMessage('user', 'Bonjour.');
    const reply = createMessage('assistant', 'Bonjour.');
    const turn = createMessage('user', 'Ouvre le bloc-notes.');
    const messages = [first, reply, turn];
    const out = appendTurnNote(messages, NOTE, turn.id);
    expect(out[2]?.content).toBe(`${TURN_NOTE_LABEL} ${NOTE}\n\nOuvre le bloc-notes.`);
    // La demande reste la dernière chose que le modèle lit.
    expect(out[2]?.content.endsWith('Ouvre le bloc-notes.')).toBe(true);
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(reply);
    expect(turn.content).toBe('Ouvre le bloc-notes.');
    expect(messages[2]).toBe(turn);
  });

  it('reste sur la demande du tour pendant les tours d’outils et un rappel ajouté ensuite', () => {
    const turn = createMessage('user', 'Quel est l’état du PC ?');
    const call = createMessage('assistant', '', { toolCalls: [{ id: 'c', name: 'get_system_info', arguments: {} }] });
    const result = createMessage('tool', 'résultat', { toolCallId: 'c', toolName: 'get_system_info' });
    const reminder = createMessage('user', 'Corrige ta réponse.');
    const out = appendTurnNote([turn, call, result, reminder], NOTE, turn.id);
    expect(out[0]?.content.startsWith(TURN_NOTE_LABEL)).toBe(true);
    expect(out[0]?.content.endsWith('Quel est l’état du PC ?')).toBe(true);
    expect(out[3]?.content).toBe('Corrige ta réponse.');
    expect(out[1]).toBe(call);
    expect(out[2]).toBe(result);
  });

  it('sans identifiant connu : le dernier message de l’utilisateur', () => {
    const a = createMessage('user', 'un');
    const b = createMessage('assistant', 'deux');
    const c = createMessage('user', 'trois');
    expect(appendTurnNote([a, b, c], NOTE, 'inconnu')[2]?.content).toBe(`${TURN_NOTE_LABEL} ${NOTE}\n\ntrois`);
    expect(appendTurnNote([a, b, c], NOTE)[0]).toBe(a);
  });

  it('note vide ou aucun message utilisateur : rien ne change', () => {
    const a = createMessage('assistant', 'seul');
    expect(appendTurnNote([a], NOTE)).toEqual([a]);
    const u = createMessage('user', 'x');
    expect(appendTurnNote([u], '  ')).toEqual([u]);
  });

  it('un message sans texte (photo seule) reçoit la note seule', () => {
    const u = createMessage('user', '');
    expect(appendTurnNote([u], NOTE)[0]?.content).toBe(`${TURN_NOTE_LABEL} ${NOTE}`);
  });

  it('le fournisseur enveloppé ajoute la note à chaque appel, et ne change rien d’autre', async () => {
    const seen: ChatRequest[] = [];
    const events: ChatStreamEvent[] = [{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }];
    const bare: LLMProvider = {
      id: 'ollama',
      label: 'Ollama',
      model: 'modele-synthetique',
      requiresApiKey: false,
      async *streamChat(request) {
        seen.push(request);
        for (const event of events) yield event;
      },
    };
    const turn = createMessage('user', 'Bonjour.');
    const wrapped = withTrailingNote(bare, NOTE, turn.id);
    const request: ChatRequest = { messages: [turn], system: 'consigne', temperature: 0.3, maxTokens: 50 };
    const out: ChatStreamEvent[] = [];
    for await (const event of wrapped.streamChat(request)) out.push(event);
    for await (const _event of wrapped.streamChat(request)) void _event;
    expect(out).toEqual(events);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.messages[0]?.content).toBe(`${TURN_NOTE_LABEL} ${NOTE}\n\nBonjour.`);
    // Même note aux deux appels du tour : le début du prompt reste le même.
    expect(seen[1]?.messages).toEqual(seen[0]?.messages);
    expect(seen[0]).toMatchObject({ system: 'consigne', temperature: 0.3, maxTokens: 50 });
    expect(request.messages[0]?.content).toBe('Bonjour.');
    expect([wrapped.id, wrapped.model]).toEqual(['ollama', 'modele-synthetique']);
    expect(withTrailingNote(bare, '   ')).toBe(bare);
  });
});

describe('la demande parle-t-elle de temps ?', () => {
  it('oui : heure, date, jour, moment, durée, même dits de travers', async () => {
    const { mentionsTime } = await import('./promptTail.js');
    for (const text of [
      'Dis-moi, il est déjà tard là, non ?',
      'Quelle heure il est chez toi',
      'On est quel jour ?',
      'Quelle est la météo à Paris aujourd’hui ?',
      'Et demain ?',
      'Rappelle-moi dans 10 minutes',
      'C’est quand le prochain match ?',
      'Mets un réveil à 7h30',
      'Rendez-vous à 14 h',
      'Quelles sont les dernières actualités ?',
      'Tu fais quoi ce soir',
      'Ça fait combien de temps que le PC est allumé ?',
      'On est en NOVEMBRE ?',
      'Il est midi ?',
    ]) {
      expect(mentionsTime(text), text).toBe(true);
    }
  });

  it('non : une demande sans rapport avec le temps (mots entiers seulement)', async () => {
    const { mentionsTime } = await import('./promptTail.js');
    for (const text of [
      'Bonjour Jarvis, comment vas-tu ?',
      'Ouvre le bloc-notes',
      'Donne-moi les informations sur mon PC : processeur et mémoire.',
      'Quelle fenêtre est active sur mon PC ?',
      'Cherche les fichiers nommés CLAUDE.md dans le dossier C:\\dev\\Jarvis.',
      'Mets de la musique',
      'Explique-moi ce qu’est un trou noir.',
      'Écris une fonction Python qui inverse une chaîne.',
      'Monte le volume',
      '',
    ]) {
      expect(mentionsTime(text), text).toBe(false);
    }
  });
});
