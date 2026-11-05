import { describe, expect, it } from 'vitest';
import { SETTINGS_SEARCH_INDEX } from './searchIndex.js';

describe('SETTINGS_SEARCH_INDEX', () => {
  it('trouve spotify, mission, micro et voix', () => {
    const find = (query: string) =>
      SETTINGS_SEARCH_INDEX.filter((entry) =>
        [entry.label, ...entry.keywords].some((term) => term.toLowerCase().includes(query.toLowerCase())),
      );
    expect(find('spotify').some((e) => e.subcategory === 'spotify')).toBe(true);
    expect(find('mission').some((e) => e.subcategory === 'developer-general')).toBe(true);
    expect(find('micro').some((e) => e.category === 'parler')).toBe(true);
    expect(find('voix').some((e) => e.category === 'parler')).toBe(true);
  });
});
