import { describe, expect, it } from 'vitest';
import { sourcePillLabel, sourcePills } from './sources';

describe('sourcePills', () => {
  it('ne fabrique pas de source', () => {
    expect(
      sourcePills(
        [
          { kind: 'user', text: 'Bonjour' },
          { kind: 'assistant', text: 'Rien à citer.' },
        ],
        1,
      ),
    ).toEqual([]);
  });

  it('compte les hôtes des URL présentes, une fois chacune', () => {
    const pills = sourcePills(
      [
        { kind: 'user', text: 'Les infos ?' },
        {
          kind: 'tool',
          content: '1. Titre\nURL : https://www.lemonde.fr/une\nAussi https://www.lemonde.fr/une',
        },
        {
          kind: 'assistant',
          text: 'Voir [Le Monde](https://www.lemonde.fr/une) et [Wikipédia](https://fr.wikipedia.org/wiki/Test).',
        },
      ],
      2,
    );
    expect(pills).toEqual([
      { host: 'lemonde.fr', count: 1 },
      { host: 'fr.wikipedia.org', count: 1 },
    ]);
    expect(sourcePillLabel(pills[0]!)).toBe('lemonde.fr · 1 source');
  });

  it('s’arrête au message utilisateur précédent', () => {
    const pills = sourcePills(
      [
        { kind: 'tool', content: 'https://example.com/ancien' },
        { kind: 'user', text: 'Autre question' },
        { kind: 'assistant', text: 'Sans lien.' },
      ],
      2,
    );
    expect(pills).toEqual([]);
  });
});
