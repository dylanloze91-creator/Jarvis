import { describe, expect, it } from 'vitest';
import { bestPassage, formatCurrentSearchForModel, searchCurrentInfo, type CurrentSearchRequest } from './currentSearch.js';
import { SearchProviderRegistry } from './registry.js';
import type { SearchResultItem } from './types.js';

const NOW = new Date('2026-10-01T19:30:00Z');

function registryWith(results: Record<string, SearchResultItem[] | Error>): SearchProviderRegistry {
  const registry = new SearchProviderRegistry();
  for (const [id, value] of Object.entries(results)) {
    registry.register({ id, label: `L-${id}`, requiresApiKey: false }, () => ({
      id,
      label: `L-${id}`,
      requiresApiKey: false,
      async search() {
        if (value instanceof Error) throw value;
        return { providerId: id, results: value.map((item) => ({ ...item })) };
      },
    }));
  }
  return registry;
}

const news = (title: string, publishedAt: string, url = `https://news.example/${encodeURIComponent(title)}`): SearchResultItem => ({
  title,
  url,
  snippet: '',
  source: 'media.fr',
  publisher: 'Média',
  publishedAt,
});
const web = (title: string, url: string, snippet = ''): SearchResultItem => ({ title, url, snippet, source: new URL(url).hostname });

const request = (overrides: Partial<CurrentSearchRequest> = {}): CurrentSearchRequest => ({
  question: 'Quel a été le score du dernier match du PSG ?',
  query: 'score dernier match PSG',
  newsQuery: 'score match PSG',
  freshness: 'week',
  preferNews: true,
  ...overrides,
});

describe('searchCurrentInfo', () => {
  it('actualité d’abord, les plus récentes en tête, puis le web ; sources numérotées', async () => {
    const registry = registryWith({
      'google-news': [news('PSG match nul à Lens', '2026-09-27T20:00:00Z'), news('PSG score 5-0 contre Louvain', '2026-10-01T20:00:00Z')],
      duckduckgo: [web('PSG — résultats et score des matchs', 'https://www.psg.fr/resultats')],
    });
    const result = await searchCurrentInfo(request(), { registry, config: { provider: 'google' }, now: () => NOW });
    expect(result.sources.map((source) => [source.index, source.kind, source.title])).toEqual([
      [1, 'news', 'PSG score 5-0 contre Louvain'],
      [2, 'news', 'PSG match nul à Lens'],
      [3, 'web', 'PSG — résultats et score des matchs'],
    ]);
    expect(result.searchedAt).toBe(NOW.toISOString());
    expect(result.providersUsed).toEqual(['L-google-news', 'L-duckduckgo']);
  });

  it('version ou prix : le web d’abord', async () => {
    const registry = registryWith({
      'google-news': [news('Node.js 26.10 publié avec un correctif', '2026-09-22T10:00:00Z')],
      duckduckgo: [web('Node.js — Télécharger', 'https://nodejs.org/fr/download', 'Node.js v26.10.0 Current')],
    });
    const result = await searchCurrentInfo(
      request({ question: 'Dernière version de Node.js ?', query: 'dernière version Node.js 2026', newsQuery: 'version Node.js', preferNews: false }),
      { registry, config: { provider: 'google' }, now: () => NOW },
    );
    expect(result.sources[0]?.kind).toBe('web');
    expect(result.sources[1]?.kind).toBe('news');
  });

  it('écarte un vieil article quand il en reste de frais', async () => {
    const registry = registryWith({
      'google-news': [news('Deno 2.0 prêt à affronter Node.js', '2024-10-16T17:00:00Z'), news('Node.js 26 sort cette semaine', '2026-09-28T10:00:00Z')],
    });
    const result = await searchCurrentInfo(
      request({ question: 'Node.js ?', query: 'Node.js', newsQuery: 'Node.js' }),
      { registry, config: { provider: 'google' }, now: () => NOW },
    );
    expect(result.sources.map((source) => source.title)).toEqual(['Node.js 26 sort cette semaine']);
  });

  it('météo d’une ville : Open-Meteo en premier, pas de pages web, deux articles au plus', async () => {
    const registry = registryWith({
      'google-news': [news('Météo Paris : orages', '2026-10-01T08:00:00Z'), news('Météo Paris : pluie', '2026-10-01T07:00:00Z'), news('Météo Paris : vent', '2026-10-01T06:00:00Z')],
      duckduckgo: [web('Météo Paris', 'https://meteo.example/paris')],
    });
    const result = await searchCurrentInfo(
      request({ question: 'Quel temps à Paris ?', query: 'météo Paris', newsQuery: 'météo Paris', city: 'Paris', preferNews: false, freshness: 'day' }),
      {
        registry,
        config: { provider: 'google' },
        now: () => NOW,
        weather: async (city) => ({ title: `Météo ${city}`, url: 'https://open-meteo.com/en/docs', snippet: 'Maintenant : 17 °C.', source: 'open-meteo.com', publisher: 'Open-Meteo', publishedAt: '2026-10-01T19:15:00Z' }),
      },
    );
    expect(result.sources.map((source) => source.kind)).toEqual(['weather', 'news', 'news']);
    expect(result.attempts[0]).toMatchObject({ providerId: 'open-meteo', ok: true });
  });

  it('lit les deux premières pages à lien direct, jamais les redirections Google Actualités', async () => {
    const read: string[] = [];
    const registry = registryWith({
      'google-news': [news('PSG Louvain 5-0', '2026-10-01T20:00:00Z', 'https://news.google.com/rss/articles/abc')],
      duckduckgo: [web('PSG score Louvain', 'https://www.lequipe.fr/psg'), web('PSG Louvain score résumé', 'https://www.psg.fr/match'), web('PSG Louvain score fiche', 'https://www.ligue1.fr/psg')],
    });
    const result = await searchCurrentInfo(request(), {
      registry,
      config: { provider: 'google' },
      now: () => NOW,
      readPage: async (url) => {
        read.push(url);
        return { text: 'Menu\nAccueil\nLe PSG a battu Louvain sur le score de 5-0 au Campus PSG jeudi soir.\nPublicité' };
      },
    });
    expect(read).toEqual(['https://www.lequipe.fr/psg', 'https://www.psg.fr/match']);
    expect(result.sources.find((source) => source.url === 'https://www.lequipe.fr/psg')?.pageExcerpt).toBe(
      'Le PSG a battu Louvain sur le score de 5-0 au Campus PSG jeudi soir.',
    );
  });

  it('lit aussi Wikipédia et met en tête la phrase qui répond (passage clé copié de la page)', async () => {
    const read: string[] = [];
    const registry = registryWith({
      'google-news': [news('Trump reçoit Xi Jinping', '2026-09-25T10:00:00Z', 'https://news.google.com/rss/articles/x')],
      duckduckgo: [
        web('Président actuel : actualités', 'https://www.lequipe.fr/a'),
        web('Président des États-Unis, fonction actuelle', 'https://www.lefigaro.fr/b'),
        web('Président des États-Unis', 'https://fr.wikipedia.org/wiki/Pr%C3%A9sident_des_%C3%89tats-Unis'),
      ],
    });
    const result = await searchCurrentInfo(
      request({ question: 'Qui est le président actuel des États-Unis ?', query: 'président actuel États-Unis 2026', newsQuery: 'président États-Unis' }),
      {
        registry,
        config: { provider: 'google' },
        now: () => NOW,
        readPage: async (url) => {
          read.push(url);
          return url.includes('wikipedia')
            ? { text: "En 2008, la victoire de Barack Obama est un événement historique pour les États-Unis.\nLe président des États-Unis actuellement en fonction est le républicain Donald Trump depuis le 20 janvier 2025." }
            : { text: 'Menu\nPublicité\nAbonnez-vous' };
        },
      },
    );
    expect(read).toContain('https://fr.wikipedia.org/wiki/Pr%C3%A9sident_des_%C3%89tats-Unis');
    const wiki = result.sources.find((source) => source.url.includes('wikipedia'));
    expect(result.keyPassage).toEqual({
      index: wiki?.index,
      text: 'Le président des États-Unis actuellement en fonction est le républicain Donald Trump depuis le 20 janvier 2025.',
    });
    const text = formatCurrentSearchForModel(result, { timeZone: 'Europe/Paris' });
    expect(text.split('\n')[2]).toBe(
      `Passage clé lu sur la source [${wiki?.index}] (fr.wikipedia.org) : « Le président des États-Unis actuellement en fonction est le républicain Donald Trump depuis le 20 janvier 2025. »`,
    );
  });

  it('tout en panne : aucune source et les raisons', async () => {
    const registry = registryWith({ 'google-news': new Error('réseau'), 'bing-news': new Error('réseau'), duckduckgo: new Error('202') });
    const result = await searchCurrentInfo(request(), { registry, config: { provider: 'google' }, now: () => NOW });
    expect(result.sources).toEqual([]);
    expect(result.attempts.every((attempt) => !attempt.ok)).toBe(true);
  });
});

describe('formatCurrentSearchForModel', () => {
  it('date et heure de la recherche, sources datées, consigne après les résultats', async () => {
    const registry = registryWith({
      'google-news': [news('Lecornu présente le budget', '2026-09-28T09:18:00Z')],
      duckduckgo: [web('Premier ministre français', 'https://fr.wikipedia.org/wiki/Premier_ministre_fran%C3%A7ais', 'Liste des Premiers ministres.')],
    });
    const result = await searchCurrentInfo(
      request({ question: 'Qui est le Premier ministre ?', query: 'Premier ministre actuel 2026', newsQuery: 'Premier ministre' }),
      { registry, config: { provider: 'google' }, now: () => NOW },
    );
    const text = formatCurrentSearchForModel(result, { timeZone: 'Europe/Paris' });
    expect(text.split('\n')[0]).toBe('Recherche web effectuée le jeudi 1 octobre 2026, 21:30 (heure du PC).');
    expect(text).toContain('[1] Lecornu présente le budget — Média (media.fr) — publié le 28 sept. 2026');
    expect(text).toContain('[2] Premier ministre français — fr.wikipedia.org — date non indiquée');
    expect(text).toContain('Extrait : Liste des Premiers ministres.');
    expect(text.trim().split('\n').at(-1)).toMatch(/^Consigne : réponds en français à partir de ces résultats seulement/);
    expect(text).toMatch(/au lieu de répondre de mémoire/);
  });

  it('sans source : le dit', () => {
    const text = formatCurrentSearchForModel(
      { searchedAt: NOW.toISOString(), question: 'Q ?', query: 'q', newsQuery: 'q', sources: [], attempts: [], providersUsed: [] },
      { timeZone: 'Europe/Paris' },
    );
    expect(text).toBe('Recherche web du jeudi 1 octobre 2026, 21:30 : aucun résultat exploitable pour « Q ? ».');
  });
});

describe('bestPassage', () => {
  it('trouve la valeur d’une infobox sur deux lignes, pas le sommaire', () => {
    const text = 'Sommaire\n3\nFrameworks pour Node.js\n5\nCertification Node.js\nDernière version\n26.10.0 ( 22 septembre 2026 ) [ 1 ]\nDépôt\ngithub.com/nodejs/node';
    expect(bestPassage(text, 'Quelle est la dernière version de Node.js ?')).toContain('Dernière version : 26.10.0 ( 22 septembre 2026 )');
    expect(bestPassage(text, 'Quelle est la dernière version de Node.js ?')).not.toContain('Frameworks');
  });

  it('rien de pertinent : chaîne vide', () => {
    expect(bestPassage('Accueil\nContact\nMentions légales', 'taux du livret A')).toBe('');
  });
});

describe('passage clé — présent plutôt qu’histoire', () => {
  it('une phrase qui ne cite que des années anciennes perd face à un article de la semaine', async () => {
    const registry = registryWith({
      'google-news': [],
      'bing-news': [news('Lecornu demande à ses ministres d’annuler leurs déplacements', '2026-10-01T07:07:00Z', 'https://www.rfi.fr/lecornu')],
      duckduckgo: [web('Premier ministre français', 'https://fr.wikipedia.org/wiki/Premier_ministre_fran%C3%A7ais')],
    });
    const result = await searchCurrentInfo(
      request({ question: 'Qui est le Premier ministre actuel en France ?', query: 'Premier ministre actuel France 2026', newsQuery: 'Premier ministre France' }),
      {
        registry,
        config: { provider: 'google' },
        now: () => NOW,
        readPage: async (url) =>
          url.includes('wikipedia')
            ? { text: 'La Constitution du 4 octobre 1958 substitue le titre de Premier ministre de France à celui de président du Conseil.' }
            : { text: 'Le Premier ministre français Sébastien Lecornu a demandé jeudi à ses ministres de renoncer à leurs déplacements.' },
      },
    );
    expect(result.keyPassage?.text).toBe(
      'Le Premier ministre français Sébastien Lecornu a demandé jeudi à ses ministres de renoncer à leurs déplacements.',
    );
  });

  it('l’infobox « Titulaire actuel » donne le nom et la date', () => {
    const text = 'Premier ministre français\nTitulaire actuel\nSébastien Lecornu\ndepuis le 9 septembre 2025\nCréation\n8 janvier 1959';
    expect(bestPassage(text, 'Qui est le Premier ministre actuel en France ?', 600, NOW)).toContain(
      'Titulaire actuel : Sébastien Lecornu depuis le 9 septembre 2025',
    );
  });
});
