import { describe, expect, it } from 'vitest';
import {
  KEYLESS_NEWS_ORDER,
  KEYLESS_WEB_ORDER,
  describeAttempts,
  newsProviderOrder,
  searchAllMerged,
  searchWithFallback,
  webProviderOrder,
} from './chain.js';
import { SearchProviderRegistry, createDefaultSearchRegistry, createWebSearchRegistry } from './registry.js';
import { SearchProviderError, type SearchProvider, type SearchQuery, type SearchResultItem } from './types.js';

type Behaviour = SearchResultItem[] | Error;

function scripted(behaviours: Record<string, Behaviour>, calls: { id: string; query: SearchQuery; apiKey?: string }[] = []) {
  const registry = new SearchProviderRegistry();
  for (const [id, behaviour] of Object.entries(behaviours)) {
    const requiresApiKey = id.startsWith('key-');
    registry.register({ id, label: `Label ${id}`, requiresApiKey }, (config) => {
      const provider: SearchProvider = {
        id,
        label: `Label ${id}`,
        requiresApiKey,
        async search(query) {
          calls.push({ id, query, apiKey: config.apiKey });
          if (behaviour instanceof Error) throw behaviour;
          return { providerId: id, results: behaviour };
        },
      };
      return provider;
    });
  }
  return registry;
}

const hit = (title: string, url = `https://example.com/${encodeURIComponent(title)}`): SearchResultItem => ({
  title,
  url,
  snippet: '',
});

describe('ordre des fournisseurs', () => {
  it('web sans clé : DuckDuckGo, Bing, Google puis Wikipédia ; actualité : Google Actualités puis Bing Actualités', () => {
    expect(KEYLESS_WEB_ORDER).toEqual(['duckduckgo', 'bing', 'google', 'wikipedia']);
    expect(KEYLESS_NEWS_ORDER).toEqual(['google-news', 'bing-news']);
  });

  it('réglage par défaut (Google) : Google d’abord, puis le repli sans clé', () => {
    const registry = createWebSearchRegistry();
    expect(webProviderOrder(registry, { provider: 'google' })).toEqual(['google', 'duckduckgo', 'bing', 'wikipedia']);
    expect(newsProviderOrder(registry, { provider: 'google' })).toEqual(['google-news', 'bing-news']);
  });

  it('une clé Brave ou Tavily configurée passe en premier, web et actualité', () => {
    const registry = createWebSearchRegistry();
    expect(webProviderOrder(registry, { provider: 'brave', apiKey: 'k' })[0]).toBe('brave');
    expect(newsProviderOrder(registry, { provider: 'tavily', apiKey: 'k' })).toEqual(['tavily', 'google-news', 'bing-news']);
  });

  it('un fournisseur à clé sans clé est sauté (comme createOrFallback)', () => {
    const registry = createWebSearchRegistry();
    expect(webProviderOrder(registry, { provider: 'brave', apiKey: '' })).toEqual(['duckduckgo', 'bing', 'google', 'wikipedia']);
    expect(newsProviderOrder(registry, { provider: 'tavily' })).toEqual(['google-news', 'bing-news']);
  });

  it('le registre par défaut reste inchangé (Google, Wikipédia, Brave)', () => {
    expect(createDefaultSearchRegistry().list().map((item) => item.id)).toEqual(['google', 'wikipedia', 'brave']);
    expect(createWebSearchRegistry().list().map((item) => item.id)).toEqual([
      'google', 'wikipedia', 'brave', 'duckduckgo', 'bing', 'google-news', 'bing-news', 'tavily',
    ]);
  });
});

describe('searchWithFallback', () => {
  it('passe au suivant quand un fournisseur échoue, et note chaque essai', async () => {
    const calls: { id: string; query: SearchQuery }[] = [];
    const registry = scripted(
      { a: new SearchProviderError('A bloqué.'), b: [], c: [hit('Node.js 26 est sorti')] },
      calls,
    );
    const response = await searchWithFallback(registry, ['a', 'b', 'c'], { provider: 'a' }, { query: 'version Node.js' });
    expect(calls.map((call) => call.id)).toEqual(['a', 'b', 'c']);
    expect(response.providerId).toBe('c');
    expect(response.label).toBe('Label c');
    expect(response.results).toHaveLength(1);
    expect(response.attempts.map((attempt) => [attempt.providerId, attempt.ok])).toEqual([
      ['a', false],
      ['b', false],
      ['c', true],
    ]);
    expect(describeAttempts(response.attempts)).toBe('Label a : A bloqué. ; Label b : aucun résultat.');
  });

  it('s’arrête au premier fournisseur pertinent', async () => {
    const calls: { id: string; query: SearchQuery }[] = [];
    const registry = scripted({ a: [hit('Prix du SP95 aujourd’hui')], b: [hit('Prix du SP95')] }, calls);
    await searchWithFallback(registry, ['a', 'b'], { provider: 'a' }, { query: 'prix SP95' });
    expect(calls.map((call) => call.id)).toEqual(['a']);
  });

  it('écarte les résultats hors sujet (Bing depuis une IP jugée robotique)', async () => {
    const registry = scripted({
      bing: [hit('Courrier et calendrier Microsoft Outlook'), hit('Tarifs HubSpot')],
      duckduckgo: [hit('Télécharger Node.js', 'https://nodejs.org/fr/download')],
    });
    const response = await searchWithFallback(registry, ['bing', 'duckduckgo'], { provider: 'google' }, { query: 'Quelle est la dernière version de Node.js 2026' });
    expect(response.providerId).toBe('duckduckgo');
    expect(response.attempts[0]).toMatchObject({ providerId: 'bing', ok: false, error: '2 résultat(s) hors sujet écarté(s).' });
  });

  it('un fournisseur « de confiance » garde ses résultats tels quels', async () => {
    const registry = scripted({ a: [hit('Sans rapport')] });
    const response = await searchWithFallback(registry, ['a'], { provider: 'a' }, { query: 'node js version', trusted: ['a'] });
    expect(response.results).toHaveLength(1);
  });

  it('ne lève pas si tout échoue : résultats vides et raisons', async () => {
    const registry = scripted({ a: new Error('réseau'), b: new Error('quota') });
    const response = await searchWithFallback(registry, ['a', 'b'], { provider: 'a' }, { query: 'x y z' });
    expect(response.results).toEqual([]);
    expect(response.providerId).toBe('');
    expect(response.attempts).toHaveLength(2);
  });

  it('la clé ne part qu’au fournisseur configuré et n’apparaît dans aucun message', async () => {
    const calls: { id: string; query: SearchQuery; apiKey?: string }[] = [];
    const secret = 'sk-SECRET-1234';
    const registry = scripted(
      { 'key-a': new Error(`refus pour la clé ${secret}`), b: [hit('Résultat utile')] },
      calls,
    );
    const response = await searchWithFallback(registry, ['key-a', 'b'], { provider: 'key-a', apiKey: secret }, { query: 'résultat utile' });
    expect(calls.find((call) => call.id === 'key-a')?.apiKey).toBe(secret);
    expect(calls.find((call) => call.id === 'b')?.apiKey).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(describeAttempts(response.attempts)).toContain('•••');
  });

  it('Wikipédia reçoit les mots-clés, pas la question', async () => {
    const calls: { id: string; query: SearchQuery }[] = [];
    const registry = scripted({ wikipedia: [hit('Node.js', 'https://fr.wikipedia.org/wiki/Node.js')] }, calls);
    const response = await searchWithFallback(registry, ['wikipedia'], { provider: 'google' }, { query: 'Quelle est la dernière version de Node.js 2026' });
    expect(calls[0]?.query.query).toBe('Node.js');
    expect(response.results).toHaveLength(1);
  });

  it('transmet la fraîcheur et la langue', async () => {
    const calls: { id: string; query: SearchQuery }[] = [];
    const registry = scripted({ a: [hit('PSG Louvain')] }, calls);
    await searchWithFallback(registry, ['a'], { provider: 'a' }, { query: 'PSG', freshness: 'week' });
    expect(calls[0]?.query).toMatchObject({ freshness: 'week', language: 'fr' });
  });
});

describe('searchAllMerged (actualité)', () => {
  it('garde le rang Google Actualités et prend le lien direct et l’extrait de Bing Actualités', async () => {
    const title = 'Le PSG corrige Louvain et signe sa première victoire en Ligue des champions';
    const registry = scripted({
      'google-news': [
        { title, url: 'https://news.google.com/rss/articles/abc', snippet: '', publisher: 'Flashscore' },
        { title: 'Autre article PSG du jour', url: 'https://news.google.com/rss/articles/def', snippet: '' },
      ],
      'bing-news': [
        { title, url: 'https://www.flashscore.fr/psg-louvain', snippet: 'Victoire 5-0 du PSG.' },
        { title: 'Article PSG seulement chez Bing', url: 'https://www.lequipe.fr/psg', snippet: 'PSG' },
      ],
    });
    const response = await searchAllMerged(registry, ['google-news', 'bing-news'], { provider: 'google' }, { query: 'PSG' });
    expect(response.results.map((item) => item.url)).toEqual([
      'https://www.flashscore.fr/psg-louvain',
      'https://news.google.com/rss/articles/def',
      'https://www.lequipe.fr/psg',
    ]);
    expect(response.results[0]?.snippet).toBe('Victoire 5-0 du PSG.');
    expect(response.label).toBe('Label google-news + Label bing-news');
  });

  it('un flux en panne n’empêche pas l’autre', async () => {
    const registry = scripted({ 'google-news': new Error('panne'), 'bing-news': [hit('PSG gagne')] });
    const response = await searchAllMerged(registry, ['google-news', 'bing-news'], { provider: 'google' }, { query: 'PSG' });
    expect(response.results).toHaveLength(1);
    expect(response.attempts.map((attempt) => attempt.ok)).toEqual([false, true]);
  });
});
