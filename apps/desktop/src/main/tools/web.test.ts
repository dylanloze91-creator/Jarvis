import { describe, expect, it } from 'vitest';
import {
  SearchProviderRegistry,
  parseSettings,
  type SearchProvider,
  type SearchQuery,
  type ToolContext,
} from '@jarvis/core';
import { createWebResearchTool, normalizeUrl, sourceDomain } from './web.js';

function fakeContext(): ToolContext {
  return { requestConfirmation: async () => true };
}

function fakeProvider(
  resultsByQuery: Record<string, { title: string; url: string; snippet: string }[]>,
): SearchProvider {
  return {
    id: 'fake',
    label: 'Fake Search',
    requiresApiKey: false,
    async search(query: SearchQuery) {
      const results = (resultsByQuery[query.query] ?? []).map((item) => ({
        ...item,
        source: sourceDomain(item.url),
      }));
      return { providerId: 'fake', results };
    },
  };
}

describe('web_research', () => {
  it('déduplique les URL et plafonne le résultat', async () => {
    const registry = new SearchProviderRegistry().register(
      { id: 'fake', label: 'Fake Search', requiresApiKey: false },
      () =>
        fakeProvider({
          nvidia: [
            { title: 'Nvidia', url: 'https://www.nvidia.com/fr/', snippet: 'Officiel' },
            { title: 'Wiki', url: 'https://fr.wikipedia.org/wiki/Nvidia', snippet: 'Encyclopédie' },
          ],
          'nvidia source officielle': [
            { title: 'Nvidia home', url: 'https://www.nvidia.com/fr/', snippet: 'Doublon' },
            { title: 'SEC', url: 'https://www.sec.gov/nvidia', snippet: 'Dépôt' },
          ],
        }),
    );

    const tool = createWebResearchTool({
      getSettings: () => parseSettings({ searchProvider: 'fake' }),
      searchRegistry: registry,
      readPage: async () => ({ title: 'Lecture', text: 'Page lue sans recopier l’adresse.' }),
    });

    const outcome = await tool.run(
      { queries: ['nvidia', 'nvidia source officielle'], limitPerQuery: 4 },
      fakeContext(),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.content).toMatch(/Recherche multi-angle/);
    expect(outcome.content).toMatch(/nvidia\.com/);
    expect(outcome.content).toMatch(/wikipedia\.org/);
    expect(outcome.content).toMatch(/sec\.gov/);
    const nvidiaMentions = [...outcome.content.matchAll(/nvidia\.com\/fr/gi)];
    expect(nvidiaMentions).toHaveLength(1);
  });

  it('signale l’échec si toutes les requêtes sont vides', async () => {
    const registry = new SearchProviderRegistry().register(
      { id: 'fake', label: 'Fake Search', requiresApiKey: false },
      () => fakeProvider({}),
    );
    const tool = createWebResearchTool({
      getSettings: () => parseSettings({ searchProvider: 'fake' }),
      searchRegistry: registry,
      readPage: async () => ({ title: 'Lecture', text: 'Page lue sans recopier l’adresse.' }),
    });
    const outcome = await tool.run(
      { queries: ['rien', 'toujours rien'], limitPerQuery: 3 },
      fakeContext(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toMatch(/aucun résultat/i);
  });

  it('normalise les URL pour la déduplication', () => {
    expect(normalizeUrl('https://Example.com/path/#hash')).toBe('https://example.com/path');
    expect(sourceDomain('https://www.Example.com/a')).toBe('example.com');
  });
});
