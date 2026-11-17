import { describe, expect, it } from 'vitest';
import { InMemoryConversationStore, newConversation, type Conversation, type TurnLogEntry } from '@jarvis/core';
import { VoiceStartBook, voicePlaceKey, VOICE_SOUND_MAX_MS } from './voix.js';

function ligne(userMessageId: string, extra: Partial<TurnLogEntry> = {}): TurnLogEntry {
  return {
    userMessageId,
    assistantMessageIds: [],
    team: null,
    how: null,
    provider: 'aucun',
    model: null,
    place: null,
    source: 'voix',
    tools: [],
    durationMs: 1000,
    at: 1,
    ...extra,
  };
}

async function conversationAvec(store: InMemoryConversationStore, entries: TurnLogEntry[]): Promise<Conversation> {
  const conversation = { ...newConversation(), turnLog: entries };
  await store.save(conversation);
  return conversation;
}

describe('chronomètre « voix »', () => {
  it('lieux : la fenêtre et chaque enceinte, jamais le téléphone', () => {
    expect(voicePlaceKey(undefined)).toBe('fenetre');
    expect(voicePlaceKey({ kind: 'fenetre' })).toBe('fenetre');
    expect(voicePlaceKey({ kind: 'enceinte', name: 'salon' })).toBe('enceinte:salon');
    expect(voicePlaceKey({ kind: 'telephone' })).toBeNull();
  });

  it('son avant le journal : la session le lit, rien n’est réécrit sur le disque', async () => {
    const store = new InMemoryConversationStore();
    const conversation = await conversationAvec(store, []);
    let now = 10_000;
    const book = new VoiceStartBook(store, () => now);
    book.turnStarted('fenetre', { conversationId: conversation.id, userMessageId: 'u1', startedAt: 10_000 });
    now = 12_300;
    await book.sound('fenetre');
    expect(book.journalised('fenetre', 'u1')).toBe(2300);
    expect((await store.get(conversation.id))?.turnLog).toEqual([]);
  });

  it('son après le journal : la ligne du tour est complétée, les autres ne bougent pas', async () => {
    const store = new InMemoryConversationStore();
    const conversation = await conversationAvec(store, [ligne('u0'), ligne('u1', { etapes: { premierMot: 400 } })]);
    let now = 0;
    const book = new VoiceStartBook(store, () => now);
    book.turnStarted('fenetre', { conversationId: conversation.id, userMessageId: 'u1', startedAt: 0 });
    expect(book.journalised('fenetre', 'u1')).toBeNull();
    now = 3100;
    await book.sound('fenetre');
    // Un second son du même tour (phrase suivante) ne change rien.
    now = 9000;
    await book.sound('fenetre');
    const log = (await store.get(conversation.id))?.turnLog ?? [];
    expect(log[0]).toEqual(ligne('u0'));
    expect(log[1]?.etapes).toEqual({ premierMot: 400, voix: 3100 });
  });

  it('un son sans tour, d’un autre lieu, ou trop tardif n’écrit rien', async () => {
    const store = new InMemoryConversationStore();
    const conversation = await conversationAvec(store, [ligne('u1')]);
    let now = 0;
    const book = new VoiceStartBook(store, () => now);
    await book.sound('fenetre');
    book.turnStarted('fenetre', { conversationId: conversation.id, userMessageId: 'u1', startedAt: 0 });
    book.journalised('fenetre', 'u1');
    await book.sound('enceinte:salon');
    now = VOICE_SOUND_MAX_MS + 1;
    await book.sound('fenetre');
    expect((await store.get(conversation.id))?.turnLog?.[0]?.etapes).toBeUndefined();
  });

  it('le journal d’un autre tour ne reçoit pas le son du tour en cours', async () => {
    const store = new InMemoryConversationStore();
    const conversation = await conversationAvec(store, []);
    const book = new VoiceStartBook(store, () => 500);
    book.turnStarted('fenetre', { conversationId: conversation.id, userMessageId: 'u2', startedAt: 0 });
    await book.sound('fenetre');
    expect(book.journalised('fenetre', 'u1')).toBeNull();
    expect(book.journalised('fenetre', 'u2')).toBe(500);
  });

  it('une conversation sans journal du tour (Jarvis Live) n’est jamais réécrite', async () => {
    const store = new InMemoryConversationStore();
    const conversation = newConversation();
    await store.save(conversation);
    const book = new VoiceStartBook(store, () => 500);
    book.turnStarted('fenetre', { conversationId: conversation.id, userMessageId: 'u1', startedAt: 0 });
    book.journalised('fenetre', 'u1');
    await book.sound('fenetre');
    expect(await store.get(conversation.id)).toEqual(conversation);
  });
});
