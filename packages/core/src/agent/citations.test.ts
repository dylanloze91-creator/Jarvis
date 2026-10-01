import { describe, expect, it } from 'vitest';
import {
  CURRENT_INFO_TURN_PROMPT,
  citedSources,
  currentDatePrompt,
  currentInfoFailureReply,
  formatSourcesFooter,
  stripSourcesFooter,
} from './citations.js';
import type { CurrentSearchResult, CurrentSource } from '../search/currentSearch.js';

const TZ = 'Europe/Paris';

function source(index: number, overrides: Partial<CurrentSource> = {}): CurrentSource {
  return {
    index,
    title: `Titre ${index}`,
    url: `https://media${index}.fr/article-${index}`,
    snippet: '',
    domain: `media${index}.fr`,
    providerId: 'google-news',
    providerLabel: 'Google Actualités (RSS, sans clé)',
    kind: 'news',
    ...overrides,
  };
}

function result(sources: CurrentSource[], attempts: CurrentSearchResult['attempts'] = []): CurrentSearchResult {
  return {
    searchedAt: '2026-10-01T19:30:00.000Z',
    question: 'Qui est le Premier ministre actuel ?',
    query: 'Premier ministre actuel 2026',
    newsQuery: 'Premier ministre',
    sources,
    attempts,
    providersUsed: ['Google Actualités (RSS, sans clé)'],
  };
}

describe('currentDatePrompt', () => {
  it('donne la date et l’heure du PC dans le fuseau demandé', () => {
    const text = currentDatePrompt(new Date('2026-10-01T19:30:00Z'), TZ);
    expect(text).toContain('jeudi 1 octobre 2026');
    expect(text).toContain('21:30');
  });

  it('la consigne du tour d’actualité interdit la réponse de mémoire et les liens dans le texte', () => {
    expect(CURRENT_INFO_TURN_PROMPT).toMatch(/pas de mémoire/);
    expect(CURRENT_INFO_TURN_PROMPT).toMatch(/source et sa date/);
    expect(CURRENT_INFO_TURN_PROMPT).toMatch(/N'écris pas de liens/);
  });
});

describe('formatSourcesFooter', () => {
  it('liste les sources citées avec média, date et lien', () => {
    const sources = [
      source(1, { title: 'Lecornu présente le budget', publisher: 'Le Monde.fr', domain: 'lemonde.fr', publishedAt: '2026-09-28T09:18:00Z' }),
      source(2, { title: 'Autre sujet', publisher: 'BFM', domain: 'bfmtv.com', publishedAt: '2026-09-29T08:00:00Z' }),
    ];
    const footer = formatSourcesFooter(result(sources), 'Selon Le Monde, le Premier ministre est Sébastien Lecornu.', TZ);
    expect(footer.startsWith('\n\nSources (recherche web du jeudi 1 octobre 2026, 21:30) :\n')).toBe(true);
    expect(footer).toContain('\n- [1] Lecornu présente le budget — Le Monde.fr (lemonde.fr), 28 sept. 2026 — https://media1.fr/article-1');
    expect(footer).not.toContain('[2]');
  });

  it('ajoute l’heure pour une source de moins de 48 h', () => {
    const footer = formatSourcesFooter(
      result([source(1, { publisher: 'Ouest-France', domain: 'ouest-france.fr', publishedAt: '2026-10-01T05:00:00Z' })]),
      'Selon Ouest-France…',
      TZ,
    );
    expect(footer).toMatch(/1 oct\. 2026, 07:00/);
  });

  it('sans date connue, pas de date inventée', () => {
    const footer = formatSourcesFooter(
      result([source(1, { kind: 'web', domain: 'fr.wikipedia.org', title: 'Livret A' })]),
      'Selon Wikipédia, le taux est de 1,7 %.',
      TZ,
    );
    expect(footer).toContain('[1] Livret A — fr.wikipedia.org — https://media1.fr/article-1');
  });

  it('sans source nommée dans la réponse, garde les trois premières', () => {
    const sources = [source(1), source(2), source(3), source(4)];
    const footer = formatSourcesFooter(result(sources), 'Réponse sans nom de source.', TZ);
    expect(footer).toContain('[1]');
    expect(footer).toContain('[3]');
    expect(footer).not.toContain('[4]');
  });

  it('reconnaît « [2] » et un média écrit autrement (« Le Monde » ↔ lemonde.fr)', () => {
    const sources = [source(1, { domain: 'bfmtv.com', publisher: 'BFM' }), source(2, { domain: 'lemonde.fr', publisher: 'Le Monde.fr' }), source(3)];
    expect(citedSources('Voir [3].', sources).map((item) => item.index)).toEqual([3]);
    expect(citedSources('Selon le Monde, oui.', sources).map((item) => item.index)).toEqual([2]);
  });

  it('« selon Wikipédia » reconnaît fr.wikipedia.org ; la source du passage clé est toujours listée', () => {
    const sources = [source(1, { publisher: 'BFM', domain: 'bfmtv.com' }), source(2, { domain: 'fr.wikipedia.org', kind: 'web' }), source(3)];
    expect(citedSources('Selon Wikipédia, oui.', sources).map((item) => item.index)).toEqual([2]);
    const withKey = { ...result(sources), keyPassage: { index: 3, text: 'phrase' } };
    const footer = formatSourcesFooter(withKey, 'Selon BFM, oui.', TZ);
    expect(footer).toContain('- [1]');
    expect(footer).toContain('- [3]');
    expect(footer).not.toContain('- [2]');
  });

  it('ne répète pas un lien déjà écrit dans la réponse', () => {
    const sources = [source(1, { publisher: 'BFM', domain: 'bfmtv.com' })];
    expect(formatSourcesFooter(result(sources), 'Selon BFM (https://media1.fr/article-1).', TZ)).toBe('');
  });

  it('aucune source : aucun bloc', () => {
    expect(formatSourcesFooter(result([]), 'texte', TZ)).toBe('');
  });
});

describe('currentInfoFailureReply', () => {
  it('dit clairement l’échec, refuse la réponse de mémoire, et donne les raisons', () => {
    const reply = currentInfoFailureReply(
      result([], [
        { providerId: 'google-news', label: 'Google Actualités (RSS, sans clé)', ok: false, count: 0, ms: 10, error: 'Google Actualités indisponible : fetch failed' },
        { providerId: 'duckduckgo', label: 'DuckDuckGo (sans clé)', ok: false, count: 0, ms: 10, error: 'DuckDuckGo limite temporairement les requêtes (défi anti-robot).' },
      ]),
      undefined,
      TZ,
    );
    expect(reply).toMatch(/^Je n'ai pas pu faire la recherche sur Internet/);
    expect(reply).toMatch(/ne pas répondre de mémoire/);
    expect(reply).toMatch(/Recherche et mémoire/);
    expect(reply).toContain('Détail de la recherche (jeudi 1 octobre 2026, 21:30) :');
    expect(reply).toContain('Google Actualités (RSS, sans clé) : Google Actualités indisponible : fetch failed');
    expect(reply).toContain('DuckDuckGo (sans clé) : DuckDuckGo limite temporairement');
  });

  it('sans résultat structuré, reprend le message de l’outil', () => {
    expect(currentInfoFailureReply(null, 'Outil inconnu.', TZ)).toContain('Outil inconnu.');
  });
});

describe('stripSourcesFooter (synthèse vocale)', () => {
  it('retire le bloc des sources ajouté par Jarvis', () => {
    const footer = formatSourcesFooter(result([source(1)]), 'Réponse.', TZ);
    expect(stripSourcesFooter(`Réponse.${footer}`)).toBe('Réponse.');
  });

  it('retire le détail technique d’un échec', () => {
    const reply = currentInfoFailureReply(result([]), 'raison', TZ);
    const spoken = stripSourcesFooter(reply);
    expect(spoken).toMatch(/^Je n'ai pas pu faire la recherche sur Internet/);
    expect(spoken).not.toContain('Détail de la recherche');
  });

  it('laisse tout autre texte intact, liens compris', () => {
    const texts = [
      'Il est 21 h 30.',
      'Sources : voir https://example.com',
      'Lecture : On verra — Nekfeu',
      'Ligne 1\n\nLigne 2',
      '',
    ];
    for (const text of texts) expect(stripSourcesFooter(text)).toBe(text);
  });
});
