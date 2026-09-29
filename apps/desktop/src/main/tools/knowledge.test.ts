import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '@jarvis/core';
import { createKnowledgeTools } from './knowledge.js';
import type { KnowledgeStore } from '../knowledge.js';
import type { KnowledgeChunk } from '../knowledge.js';
import type { ToolContext } from '@jarvis/core';

class FakeStore {
  remembered: { text: string; title: string }[] = [];
  cleared = false;
  searchQuery = '';

  async search(query: string): Promise<KnowledgeChunk[]> {
    this.searchQuery = query;
    return [
      {
        id: '1',
        source: 'jarvis-memory',
        title: 'Wi-Fi',
        text: 'Le code est Jarvis42',
        kind: 'memory',
        updatedAt: 1,
      },
    ];
  }

  async remember(text: string, _settings: Settings, title: string): Promise<KnowledgeChunk> {
    this.remembered.push({ text, title });
    return {
      id: '2',
      source: 'jarvis-memory',
      title,
      text,
      kind: 'memory',
      updatedAt: 1,
    };
  }

  async indexFolder(): Promise<{ files: number; chunks: number }> {
    return { files: 3, chunks: 5 };
  }

  async stats() {
    return { chunks: 2, sources: 1, embedded: 0 };
  }

  async clear(): Promise<void> {
    this.cleared = true;
  }
}

function fakeContext(): ToolContext {
  return { requestConfirmation: async () => true };
}

describe('createKnowledgeTools', () => {
  it('déclare cinq outils, lecture en safe, index et clear incompressibles', () => {
    const tools = createKnowledgeTools(
      new FakeStore() as unknown as KnowledgeStore,
      () => defaultSettings,
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      'search_jarvis_memory',
      'remember_jarvis',
      'index_jarvis_folder',
      'get_jarvis_memory_stats',
      'clear_jarvis_memory',
    ]);
    expect(tools[0]?.risk).toBe('safe');
    expect(tools[3]?.risk).toBe('safe');
    expect(tools.find((tool) => tool.name === 'index_jarvis_folder')?.forceConfirm).toBe(true);
    expect(tools.find((tool) => tool.name === 'clear_jarvis_memory')?.forceConfirm).toBe(true);
    expect(tools.find((tool) => tool.name === 'remember_jarvis')?.risk).toBe('confirm');
  });

  it('recherche et mémorise via le store local', async () => {
    const store = new FakeStore();
    const tools = createKnowledgeTools(store as unknown as KnowledgeStore, () => defaultSettings);
    const search = tools.find((tool) => tool.name === 'search_jarvis_memory')!;
    const remember = tools.find((tool) => tool.name === 'remember_jarvis')!;

    const found = await search.run({ query: 'wifi', limit: 6 }, fakeContext());
    expect(found.ok).toBe(true);
    expect(found.content).toContain('Jarvis42');
    expect(store.searchQuery).toBe('wifi');

    const saved = await remember.run({ text: 'un fait', title: 'Note' }, fakeContext());
    expect(saved.ok).toBe(true);
    expect(store.remembered).toEqual([{ text: 'un fait', title: 'Note' }]);
  });

  it('efface l’index', async () => {
    const store = new FakeStore();
    const clear = createKnowledgeTools(
      store as unknown as KnowledgeStore,
      () => defaultSettings,
    ).find((tool) => tool.name === 'clear_jarvis_memory')!;
    await clear.run({}, fakeContext());
    expect(store.cleared).toBe(true);
  });
});
