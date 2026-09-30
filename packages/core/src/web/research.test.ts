import { describe, expect, it } from 'vitest';
import {
  assessHtml,
  compareSources,
  dedupeHits,
  formatClaimLabels,
  selectSources,
  type ReadSource,
} from './research.js';

describe('recherche approfondie', () => {
  it('déduplique et ne retient pas seulement le premier domaine', () => {
    const hits = dedupeHits([
      { title: 'A', url: 'https://www.Example.com/a#x', snippet: 'un' },
      { title: 'A2', url: 'https://example.com/a', snippet: 'deux' },
      { title: 'B', url: 'https://b.example/b', snippet: 'trois' },
      { title: 'C', url: 'https://c.example/c', snippet: 'quatre' },
    ]);
    expect(hits).toHaveLength(3);
    const selected = selectSources(
      [
        { title: 'Premier', url: 'https://news.example/1', snippet: 'a' },
        { title: 'Même site', url: 'https://news.example/2', snippet: 'b' },
        { title: 'Autre', url: 'https://officiel.example/2', snippet: 'c' },
      ],
      2,
    );
    expect(selected.map((hit) => hit.title)).toEqual(['Premier', 'Autre']);
  });

  it('ne traite pas le premier texte comme un fait s’il est seul', () => {
    const reads: ReadSource[] = [
      {
        url: 'https://a.example/x',
        title: 'A',
        text: 'Le chiffre d’affaires atteint 12 milliards selon ce communiqué officiel.',
        assessment: { empty: false, antiBot: false, invalidHtml: false },
      },
    ];
    const brief = compareSources(reads);
    expect(brief.facts).toHaveLength(0);
    const text = formatClaimLabels(brief);
    expect(text).toMatch(/FAIT — aucun fait recoupé/);
    expect(text).toMatch(/SOURCE —/);
    expect(text).toMatch(/INTERPRÉTATION —/);
    expect(text).toMatch(/INCERTITUDE —/);
    expect(text).toMatch(/premier résultat n’est pas/i);
  });

  it('recoupe un fait présent dans deux domaines et signale une contradiction', () => {
    const shared = 'Le chiffre d’affaires annuel atteint 12 milliards d’euros.';
    const reads: ReadSource[] = [
      {
        url: 'https://a.example/x',
        title: 'A',
        text: shared,
        assessment: { empty: false, antiBot: false, invalidHtml: false },
      },
      {
        url: 'https://b.example/y',
        title: 'B',
        text: 'Le chiffre d’affaires annuel atteint 9 milliards d’euros.',
        assessment: { empty: false, antiBot: false, invalidHtml: false },
      },
    ];
    const brief = compareSources(reads);
    expect(brief.uncertainty.some((line) => /contradictoires/i.test(line))).toBe(true);
    expect(brief.facts).toHaveLength(0);
  });

  it('repère une page vide, un mur anti-robot et un HTML invalide', () => {
    expect(assessHtml('<html>captcha unusual traffic</html>', '')).toMatchObject({ antiBot: true });
    expect(assessHtml('<html><p>court</p></html>', 'court')).toMatchObject({ empty: true });
    expect(assessHtml('binaire \u0000 sans balise du tout ici', '')).toMatchObject({ invalidHtml: true });
  });
});
