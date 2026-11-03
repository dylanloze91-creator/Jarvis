import { describe, expect, it } from 'vitest';
import { formatSourcesFooter } from './citations.js';
import type { CurrentSearchResult, CurrentSource } from '../search/currentSearch.js';
import {
  mediaLabelFromFooterSegment,
  splitSourcesFooterForDisplay,
} from './sourcesDisplay.js';

const TZ = 'Europe/Paris';

function source(index: number, publisher: string, url: string): CurrentSource {
  return {
    index,
    title: `Titre ${index}`,
    url,
    snippet: 'extrait',
    domain: 'media1.fr',
    publisher,
    providerId: 'google',
    providerLabel: 'Google',
    kind: 'news',
  };
}

function result(sources: CurrentSource[]): CurrentSearchResult {
  return {
    searchedAt: '2026-10-01T19:30:00.000Z',
    question: 'Q ?',
    query: 'Q',
    newsQuery: '*',
    sources,
    attempts: [],
    providersUsed: [],
  };
}

describe('splitSourcesFooterForDisplay', () => {
  it('retire le bloc long et extrait médias + liens http(s)', () => {
    const footer = formatSourcesFooter(
      result([
        source(1, 'Le Monde', 'https://www.lemonde.fr/a'),
        source(2, 'BFMTV', 'https://www.bfmtv.com/b'),
      ]),
      'Réponse sans lien.',
      TZ,
    );
    const text = `Réponse sans lien.${footer}`;
    const split = splitSourcesFooterForDisplay(text);
    expect(split.body).toBe('Réponse sans lien.');
    expect(split.links).toEqual([
      { label: 'Le Monde', url: 'https://www.lemonde.fr/a' },
      { label: 'BFMTV', url: 'https://www.bfmtv.com/b' },
    ]);
  });

  it('ignore les URL non http(s)', () => {
    const split = splitSourcesFooterForDisplay(
      'Corps.\n\nSources (recherche web du jeudi 1 octobre 2026, 21:30) :\n- [1] T — Média — javascript:alert(1)',
    );
    expect(split.body).toBe('Corps.');
    expect(split.links).toEqual([]);
  });
});

describe('mediaLabelFromFooterSegment', () => {
  it('prend le nom avant le domaine entre parenthèses', () => {
    expect(mediaLabelFromFooterSegment('Le Monde (lemonde.fr), jeudi 1 octobre')).toBe('Le Monde');
  });
});
