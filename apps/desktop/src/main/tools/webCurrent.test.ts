import { describe, expect, it } from 'vitest';
import {
  CURRENT_INFO_TOOL_NAME,
  SearchProviderError,
  SearchProviderRegistry,
  parseSettings,
  type SearchQuery,
  type SearchResultItem,
  type ToolContext,
} from '@jarvis/core';
import { createCurrentInfoSearchTool, createWebResearchTool, createWebSearchTool, pageLooksBlocked } from './web.js';

const context: ToolContext = { requestConfirmation: async () => true };

type Behaviour = SearchResultItem[] | Error;

function registry(behaviours: Record<string, Behaviour>, seen: { id: string; query: SearchQuery }[] = []) {
  const reg = new SearchProviderRegistry();
  for (const [id, behaviour] of Object.entries(behaviours)) {
    const requiresApiKey = id === 'brave';
    reg.register({ id, label: `Libellé ${id}`, requiresApiKey }, () => ({
      id,
      label: `Libellé ${id}`,
      requiresApiKey,
      async search(query: SearchQuery) {
        seen.push({ id, query });
        if (behaviour instanceof Error) throw behaviour;
        return { providerId: id, results: behaviour.map((item) => ({ ...item })) };
      },
    }));
  }
  return reg;
}

const item = (title: string, url: string, snippet = 'Résumé.'): SearchResultItem => ({ title, url, snippet });

describe('web_search', () => {
  it('fournisseur choisi qui répond : sortie identique à avant', async () => {
    const tool = createWebSearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry({ google: [item('Node.js', 'https://nodejs.org/')], duckduckgo: [item('Autre', 'https://x.fr')] }),
    });
    const outcome = await tool.run({ query: 'node.js', limit: 5 }, context);
    expect(outcome.content).toBe(
      "Résultats pour « node.js » (via Libellé google) :\n\n1. Node.js — Résumé.\n   Source : https://nodejs.org/\n\nLe premier résultat n'est pas une preuve. Distingue FAIT, SOURCE, INTERPRÉTATION et INCERTITUDE.",
    );
  });

  it('Google bloqué : repli DuckDuckGo, signalé, avec la date quand elle est connue', async () => {
    const seen: { id: string; query: SearchQuery }[] = [];
    const tool = createWebSearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry(
        {
          google: new SearchProviderError('Google a renvoyé une page sans résultats exploitables.'),
          duckduckgo: [{ ...item('Télécharger Node.js', 'https://nodejs.org/fr/download'), publishedAt: '2026-09-22T10:00:00Z' }],
          bing: [item('Ne doit pas être appelé', 'https://bing.example')],
        },
        seen,
      ),
    });
    const outcome = await tool.run({ query: 'node.js', limit: 5 }, context);
    expect(seen.map((call) => call.id)).toEqual(['google', 'duckduckgo']);
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toMatch(/^\(Libellé google n'a pas répondu ; recherche effectuée via Libellé duckduckgo\.\)/);
    expect(outcome.content).toContain('Télécharger Node.js — Résumé. (publié le 22 sept. 2026)');
  });

  it('aucun repli disponible : même message d’échec qu’avant', async () => {
    const tool = createWebSearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry({ google: new SearchProviderError('Google limite temporairement les requêtes (HTTP 429).', 429) }),
    });
    const outcome = await tool.run({ query: 'node.js', limit: 5 }, context);
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toMatch(/^La recherche Internet n'a pas abouti pour « node\.js »\./);
    expect(outcome.content).not.toMatch(/Autres moteurs/);
  });

  it('tous en échec : les autres moteurs essayés sont nommés', async () => {
    const tool = createWebSearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry({ google: new SearchProviderError('bloqué'), duckduckgo: new SearchProviderError('DuckDuckGo limite temporairement les requêtes.') }),
    });
    const outcome = await tool.run({ query: 'node.js', limit: 5 }, context);
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toContain('Autres moteurs essayés — Libellé duckduckgo : DuckDuckGo limite temporairement les requêtes.');
  });
});

describe('web_research', () => {
  it('une requête sans résultat passe par le repli, les autres gardent le fournisseur choisi', async () => {
    const seen: { id: string; query: SearchQuery }[] = [];
    const tool = createWebResearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry(
        {
          google: [item('Nvidia officiel', 'https://www.nvidia.com/fr/')],
          duckduckgo: [item('Nvidia SEC dépôt', 'https://www.sec.gov/nvidia')],
        },
        seen,
      ),
      readPage: async () => ({ title: 'Lecture', text: 'Page lue.' }),
    });
    const outcome = await tool.run({ queries: ['nvidia', 'nvidia sec'], limitPerQuery: 3 }, context);
    expect(outcome.ok).toBe(true);
    expect(seen.filter((call) => call.id === 'google')).toHaveLength(2);
    expect(seen.filter((call) => call.id === 'duckduckgo')).toHaveLength(0);
  });

  it('fournisseur choisi en panne : repli requête par requête, signalé', async () => {
    const seen: { id: string; query: SearchQuery }[] = [];
    const tool = createWebResearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry(
        { google: new SearchProviderError('bloqué'), duckduckgo: [item('Nvidia résultats trimestriels', 'https://www.nvidia.com/ir')] },
        seen,
      ),
      readPage: async () => ({ title: 'Lecture', text: 'Page lue.' }),
    });
    const outcome = await tool.run({ queries: ['nvidia résultats', 'nvidia trimestriels'], limitPerQuery: 3 }, context);
    expect(outcome.ok).toBe(true);
    expect(seen.filter((call) => call.id === 'duckduckgo')).toHaveLength(2);
    expect(outcome.content).toContain("Libellé google n'a pas répondu pour certaines requêtes ; repli : Libellé duckduckgo.");
    expect(outcome.content).toContain('Recherche multi-angle terminée via Libellé duckduckgo.');
  });
});

describe('pageLooksBlocked (lecture des pages pour l’actualité)', () => {
  it('une page riche qui cite « captcha » dans ses scripts reste lisible (Wikipédia)', () => {
    const text = 'Le président des États-Unis actuellement en fonction est Donald Trump. '.repeat(60);
    expect(pageLooksBlocked('<script>var wgConfirmEditCaptcha = 1;</script><p>…</p>', text)).toBe(false);
  });

  it('un vrai mur anti-robot est écarté', () => {
    expect(pageLooksBlocked('<html><body>Please complete the captcha to continue</body></html>', 'Please complete the captcha')).toBe(true);
  });
});

describe('web_search_current (outil interne)', () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  it('outil interne, résultats numérotés et datés pour le modèle, données structurées pour les citations', async () => {
    const tool = createCurrentInfoSearchTool({
      getSettings: () => parseSettings({ searchProvider: 'google' }),
      searchRegistry: registry({
        'google-news': [{ ...item('Lecornu présente le budget', 'https://www.lemonde.fr/budget', ''), publisher: 'Le Monde.fr', source: 'lemonde.fr', publishedAt: recent }],
        duckduckgo: [item('Premier ministre français', 'https://fr.wikipedia.org/wiki/Premier_ministre_fran%C3%A7ais')],
      }),
      readPage: async () => ({ text: 'Sébastien Lecornu est Premier ministre depuis septembre 2025.' }),
    });
    expect(tool.name).toBe(CURRENT_INFO_TOOL_NAME);
    expect(tool.internal).toBe(true);
    const outcome = await tool.run(
      { question: 'Qui est le Premier ministre ?', query: 'Premier ministre actuel 2026', newsQuery: 'Premier ministre', freshness: 'month', preferNews: true },
      context,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toMatch(/^Recherche web effectuée le /);
    expect(outcome.content).toContain('[1] Lecornu présente le budget — Le Monde.fr (lemonde.fr) — publié le');
    expect(outcome.content).toContain('Lu sur la page : Sébastien Lecornu est Premier ministre depuis septembre 2025.');
    const data = outcome.data as { sources: { url: string }[] };
    expect(data.sources.map((source) => source.url)).toEqual([
      'https://www.lemonde.fr/budget',
      'https://fr.wikipedia.org/wiki/Premier_ministre_fran%C3%A7ais',
    ]);
  });

  it('aucune source : échec explicite, et la clé n’apparaît nulle part', async () => {
    const secret = 'BSA-secret-key-123456';
    const tool = createCurrentInfoSearchTool({
      getSettings: () => parseSettings({ searchProvider: 'brave', searchApiKey: secret }),
      searchRegistry: registry({
        brave: new SearchProviderError(`Clé ${secret} refusée`),
        'google-news': new SearchProviderError('Google Actualités indisponible : fetch failed'),
      }),
    });
    const outcome = await tool.run(
      { question: 'Prix du SP95 ?', query: 'prix SP95', newsQuery: 'prix SP95', freshness: 'day', preferNews: false },
      context,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.content).toMatch(/^La recherche Internet n'a rien donné pour « Prix du SP95 \? »/);
    expect(`${outcome.content} ${outcome.technicalDetail ?? ''} ${JSON.stringify(outcome.data)}`).not.toContain(secret);
  });
});
