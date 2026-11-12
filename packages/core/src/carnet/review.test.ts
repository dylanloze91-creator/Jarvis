import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { entryFromDetection } from './store.js';
import { defaultCarnetSettings, parseCarnetSettings } from './settings.js';
import {
  annotateRates,
  dismissRates,
  emptyLedger,
  groupRates,
  pageGroups,
  ratesThisWeek,
  sundayNotice,
} from './review.js';
import type { RateEntry } from './types.js';

/** Phrases synthétiques marquées synthetique-test. */
function row(
  id: string,
  userText: string,
  type: RateEntry['type'] = 'correction',
  at = 1_700_000_000_000,
): RateEntry {
  return entryFromDetection({
    id,
    at,
    edition: 'test',
    place: { kind: 'fenetre' },
    conversationId: 'conv',
    detection: {
      type,
      rule: type === 'lenteur' ? 'lenteur-fenetre' : 'correction-classify',
      userText,
      replyText: 'Il est 3 heures.',
      team: null,
      model: null,
      how: null,
      tools: [],
      durations: {},
    },
  });
}

describe('carnet — revue (synthetique-test)', () => {
  it('synthetique-test parseSettings({}) ne gagne pas le carnet', () => {
    expect(parseSettings({})).not.toHaveProperty('carnet');
    expect(defaultCarnetSettings('test').enabled).toBe(true);
    expect(defaultCarnetSettings('live').enabled).toBe(false);
    expect(parseCarnetSettings({ enabled: true }, 'live').enabled).toBe(true);
    expect(parseCarnetSettings({}, 'test').fenetrePremierMotMs).toBe(10_000);
  });

  it('synthetique-test regroupe le même type aux mots proches, les plus nombreux d’abord', () => {
    const now = 1_700_000_100_000;
    const week = ratesThisWeek(
      [
        row('1', 'ouvre le dossier photos', 'correction', now - 1_000),
        row('2', 'ouvre le dossier photos stp', 'correction', now - 2_000),
        row('3', 'ouvre le dossier photos encore', 'correction', now - 3_000),
        row('4', 'quelle heure est-il', 'lenteur', now - 4_000),
        row('vieux', 'ouvre le dossier photos', 'correction', now - 8 * 24 * 60 * 60 * 1000),
      ],
      now,
    );
    expect(week.map((entry) => entry.id)).not.toContain('vieux');
    const groups = groupRates(week);
    expect(groups.map((group) => group.count)).toEqual([3, 1]);
    expect(groups[0]?.type).toBe('correction');
    expect(groups[0]?.ids).toHaveLength(3);
    const words = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo',
      'foxtrot',
      'golf',
      'hotel',
      'india',
      'juliet',
      'kilo',
      'lima',
    ];
    const many = words.map((word, index) =>
      row(`g${index}`, `sujet ${word} seulement`, 'outil_echec'),
    );
    expect(pageGroups(groupRates(many), false).shown).toHaveLength(10);
    expect(pageGroups(groupRates(many), false).rest).toBe(2);
    expect(pageGroups(groupRates(many), true).shown).toHaveLength(12);
  });

  it('synthetique-test « pas un raté » retire l’entrée et compte la fausse alerte', () => {
    const entries = [
      row('a', 'ouvre le dossier photos'),
      row('b', 'quelle heure est-il', 'lenteur'),
    ];
    const next = dismissRates(entries, ['a'], emptyLedger());
    expect(next.entries.map((entry) => entry.id)).toEqual(['b']);
    expect(next.ledger.counts['correction-classify']).toBe(1);
    const noted = annotateRates(entries, ['b'], { category: 'bogue', expected: 'dire 14 h' });
    expect(noted.find((entry) => entry.id === 'b')).toMatchObject({
      reviewed: true,
      category: 'bogue',
      expected: 'dire 14 h',
    });
  });

  it('synthetique-test le dimanche, une phrase écrite, jamais dite', () => {
    const sunday = new Date(2026, 10, 15, 12, 0, 0);
    expect(sunday.getDay()).toBe(0);
    const notice = sundayNotice(sunday, null, 12);
    expect(notice).toEqual({
      text: "Cette semaine, j'ai noté 12 ratés. Tu veux les voir ?",
      speak: false,
      day: '2026-11-15',
    });
    expect(sundayNotice(sunday, '2026-11-15', 12)).toBeNull();
    expect(sundayNotice(new Date(2026, 10, 12, 12, 0, 0), null, 12)).toBeNull();
    expect(sundayNotice(sunday, null, 0)).toBeNull();
    expect(sundayNotice(sunday, null, 1)?.text).toBe(
      "Cette semaine, j'ai noté 1 raté. Tu veux les voir ?",
    );
  });
});
