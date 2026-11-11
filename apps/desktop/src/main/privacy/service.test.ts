import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyPersonalization, parseSettings, unzipStore, type KnowChunk, type PersonalizationProfile } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { PrivacyService } from './service.js';

describe('ce que Jarvis sait', () => {
  it('compte, exporte sans secret, et n’efface que la catégorie', async () => {
    let profile: PersonalizationProfile = { ...emptyPersonalization(), user: { prenom: 'Camarade' }, rules: ['phrases courtes'] };
    let chunks: KnowChunk[] = [
      { id: 'mem', kind: 'memory', text: 'clé sk-abcdefghijklmnopqrst à ne pas exporter' },
      { id: 'doc', kind: 'file', title: 'note.txt', text: 'un document' },
      { id: 'pref', kind: 'memory', learning: { type: 'preference', content: 'tutoiement' } },
    ];
    const conversations = [{ id: 'c1', title: 'Discussion' }];
    let wiped = false;
    const sorter = await mkdtemp(join(tmpdir(), 'jarvis-trieur-'));
    await writeFile(join(sorter, 'a-trier.jsonl'), '{"texte":"range les vis"}\n');
    const kept = await mkdtemp(join(tmpdir(), 'jarvis-projets-'));
    await writeFile(join(kept, 'settings.json'), '{"apiKey":""}');
    await writeFile(join(kept, 'projet.txt'), 'projet utilisateur');
    const service = new PrivacyService({
      userData: () => kept,
      getSettings: () => parseSettings({ orchestra: { enabled: true, brain: 'qwen2.5:3b', trieurDataDir: sorter } }),
      personalization: {
        get: async () => profile,
        reset: async () => {
          profile = emptyPersonalization();
          return profile;
        },
      },
      knowledge: {
        listChunks: async () => chunks,
        replaceChunks: async (next) => {
          chunks = next;
        },
        clearMemoryFiles: async () => undefined,
      },
      conversations: {
        list: async () => conversations,
        read: async () => 'bonjour',
        remove: async (id) => {
          const index = conversations.findIndex((item) => item.id === id);
          if (index >= 0) conversations.splice(index, 1);
        },
        clear: async () => {
          conversations.splice(0, conversations.length);
        },
      },
      questionnaire: {
        read: async () => ({ answers: { talkMode: 'text' } }),
        wipe: async () => {
          wiped = true;
        },
      },
      wake: { count: async () => 2, clear: async () => undefined },
    });
    const summary = await service.summary();
    expect(summary.find((item) => item.id === 'personalization')?.count).toBe(2);
    expect(summary.find((item) => item.id === 'memories')?.count).toBe(1);
    expect(summary.find((item) => item.id === 'documents')?.count).toBe(1);
    expect(summary.find((item) => item.id === 'learning')?.count).toBe(1);
    expect(summary.find((item) => item.id === 'sorter')?.included).toBe(true);
    const packed = await service.exportAll();
    const text = unzipStore(packed).map((file) => new TextDecoder().decode(file.data)).join('\n');
    expect(text).not.toContain('sk-abcdefghijklmnopqrst');
    expect(text).toContain('Camarade');
    await service.erase('memories');
    expect(chunks.map((chunk) => chunk.id)).toEqual(['doc', 'pref']);
    expect(await readFile(join(kept, 'settings.json'), 'utf8')).toContain('apiKey');
    expect(await readFile(join(kept, 'projet.txt'), 'utf8')).toBe('projet utilisateur');
    await service.erase('conversations', 'c1');
    expect(conversations).toEqual([]);
    await service.eraseAll();
    expect(wiped).toBe(true);
    expect(profile.user).toEqual({});
    await expect(readFile(join(sorter, 'a-trier.jsonl'))).rejects.toThrow();
    expect(await readFile(join(kept, 'projet.txt'), 'utf8')).toBe('projet utilisateur');
  });

  it('exporte les conversations en entier et masque une clé sans bloquer', async () => {
    const long = 'phrase '.repeat(200);
    const secret = 'sk-abcdefghijklmnopqrst';
    let chunks: KnowChunk[] = [];
    const service = new PrivacyService({
      userData: () => '/tmp',
      getSettings: () => parseSettings({}),
      personalization: { get: async () => emptyPersonalization(), reset: async () => emptyPersonalization() },
      knowledge: { listChunks: async () => chunks, replaceChunks: async (next) => { chunks = next; }, clearMemoryFiles: async () => undefined },
      conversations: {
        list: async () => [{ id: 'c1', title: 'Discussion' }],
        read: async () => JSON.stringify({ messages: [{ role: 'user', content: `${long} ${secret}` }, { role: 'assistant', content: 'réponse complète' }] }),
        remove: async () => undefined,
        clear: async () => undefined,
      },
      questionnaire: { read: async () => ({ answers: {} }), wipe: async () => undefined },
      wake: { count: async () => 0, clear: async () => undefined },
    });
    const packed = await service.exportAll();
    const text = (await import('@jarvis/core')).unzipStore(packed).map((file) => new TextDecoder().decode(file.data)).join('\n');
    expect(text).toContain('réponse complète');
    expect(text.length).toBeGreaterThan(500);
    expect(text).not.toContain(secret);
    expect(text).toContain('[REDACTED]');
  });

  it('un identifiant inconnu n’efface pas les corrections', async () => {
    let chunks: KnowChunk[] = [{ id: 'pref', kind: 'memory', learning: { type: 'preference', content: 'tutoiement' } }];
    const service = new PrivacyService({
      userData: () => '/tmp',
      getSettings: () => parseSettings({}),
      personalization: { get: async () => emptyPersonalization(), reset: async () => emptyPersonalization() },
      knowledge: { listChunks: async () => chunks, replaceChunks: async (next) => { chunks = next; }, clearMemoryFiles: async () => undefined },
      conversations: { list: async () => [], read: async () => '', remove: async () => undefined, clear: async () => undefined },
      questionnaire: { read: async () => ({}), wipe: async () => undefined },
      wake: { count: async () => 0, clear: async () => undefined },
    });
    await expect(service.erase('invente' as never)).rejects.toThrow(/inconnue/);
    expect(chunks.map((chunk) => chunk.id)).toEqual(['pref']);
  });
});
