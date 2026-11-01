import { describe, expect, it } from 'vitest';
import { COMPARE_RULE, compareBench, comparisonMarkdown, comparisonReport, comparisonText, majority, type BenchReport } from './labCompare.js';

/** Faux rapport du banc : par modèle, une liste de missions et, pour chacune, les passages réussis (sur 3). */
function fakeReport(scores: Record<string, Record<string, number | 'excluded'>>, runs = 3): BenchReport {
  return {
    at: '2026-11-02T00:00:00.000Z',
    results: Object.entries(scores).map(([model, missions]) => ({
      model,
      runs: Array.from({ length: runs }, (_, index) => ({
        run: index + 1,
        missions: Object.entries(missions).map(([id, passed]) => ({
          id,
          level: Number(id[1]),
          passed: passed !== 'excluded' && index < passed,
          excluded: passed === 'excluded',
        })),
      })),
    })),
  };
}

const ids = ['e1-a', 'e1-b', 'e1-c', 'e2-d', 'e2-e', 'e2-f', 'e3-g', 'e3-h'];
function scores(values: readonly (number | 'excluded')[]): Record<string, number | 'excluded'> {
  return Object.fromEntries(ids.map((id, index) => [id, values[index]!]));
}

describe('examen : comparaison de deux modèles', () => {
  it('conseille un candidat qui dépasse la base sans perdre plus de deux missions', () => {
    const report = fakeReport({
      'qwen2.5-coder:7b': scores([3, 3, 3, 2, 0, 0, 1, 0]),
      'jarvis-coder': scores([3, 3, 3, 3, 3, 2, 0, 0]),
    });
    const result = compareBench(report, 'qwen2.5-coder:7b', 'jarvis-coder');
    expect(result.base).toEqual({ model: 'qwen2.5-coder:7b', passed: 12, total: 24, perRun: [5, 4, 3], succeeded: 4 });
    expect(result.candidate).toEqual({ model: 'jarvis-coder', passed: 17, total: 24, perRun: [6, 6, 5], succeeded: 6 });
    expect(result.won).toEqual(['e2-e', 'e2-f']);
    expect(result.lost).toEqual([]);
    expect(result.verdict).toBe('meilleur');
    expect(result.advised).toBe(true);
    expect(result.reason).toContain('conseillé');
    expect(result.missions.find((mission) => mission.id === 'e3-g')).toEqual({
      id: 'e3-g',
      level: 3,
      base: 1,
      candidate: 0,
      runs: 3,
      baseSucceeded: false,
      candidateSucceeded: false,
      change: 'stable',
    });
  });

  it('ne conseille pas un total meilleur qui perd plus de deux missions que la base réussissait', () => {
    const report = fakeReport({
      base: scores([3, 3, 3, 3, 0, 0, 0, 0]),
      candidat: scores([0, 0, 0, 3, 3, 3, 3, 1]),
    });
    const result = compareBench(report, 'base', 'candidat');
    expect(result.verdict).toBe('meilleur');
    expect(result.lost).toEqual(['e1-a', 'e1-b', 'e1-c']);
    expect(result.lost.length).toBeGreaterThan(COMPARE_RULE.maxLost);
    expect(result.advised).toBe(false);
    expect(result.reason).toContain('non conseillé');
    expect(result.reason).toContain('e1-a, e1-b, e1-c');
  });

  it('« pareil » et « moins bon » ne sont jamais conseillés', () => {
    const same = compareBench(fakeReport({ base: scores([3, 2, 1, 0, 0, 0, 0, 0]), candidat: scores([0, 0, 0, 0, 1, 2, 3, 0]) }), 'base', 'candidat');
    expect(same.verdict).toBe('pareil');
    expect(same.advised).toBe(false);
    const worse = compareBench(fakeReport({ base: scores([3, 3, 3, 3, 3, 3, 3, 3]), candidat: scores([3, 3, 3, 3, 3, 3, 3, 0]) }), 'base', 'candidat');
    expect(worse.verdict).toBe('moins bon');
    expect(worse.advised).toBe(false);
    expect(worse.lost).toEqual(['e3-h']);
  });

  it('une mission écartée d’un passage ne compte ni au total ni dans la majorité', () => {
    const report = fakeReport({ base: scores([3, 'excluded', 3, 3, 3, 3, 3, 3]), candidat: scores([3, 'excluded', 3, 3, 3, 3, 3, 3]) });
    const result = compareBench(report, 'base', 'candidat');
    expect(result.base.total).toBe(21);
    expect(result.missions.map((mission) => mission.id)).not.toContain('e1-b');
    expect(result.verdict).toBe('pareil');
  });

  it('retrouve un modèle sans étiquette (:latest) et refuse un modèle absent, sauté ou identique', () => {
    const report = fakeReport({ 'qwen2.5-coder:7b': scores([3, 3, 3, 3, 3, 3, 3, 3]), 'jarvis-coder:latest': scores([3, 3, 3, 3, 3, 3, 3, 3]) });
    expect(compareBench(report, 'qwen2.5-coder:7b', 'jarvis-coder').verdict).toBe('pareil');
    expect(() => compareBench(report, 'qwen2.5-coder:7b', 'absent')).toThrow(/absent n’est pas dans le rapport/);
    expect(() => compareBench(report, 'a', 'a')).toThrow(/deux modèles différents/);
    const skipped: BenchReport = { results: [...report.results, { model: 'saute', skipped: 'saute est absent : série bloquée, aucun score inventé', runs: [] }] };
    expect(() => compareBench(skipped, 'qwen2.5-coder:7b', 'saute')).toThrow(/sauté par le banc/);
  });

  it('la majorité exige strictement plus de la moitié des passages', () => {
    expect(majority(2, 3)).toBe(true);
    expect(majority(1, 3)).toBe(false);
    expect(majority(1, 2)).toBe(false);
    expect(majority(1, 1)).toBe(true);
    expect(majority(0, 0)).toBe(false);
  });

  it('écrit un tableau Markdown mission par mission, un texte console et un JSON sans énoncé', () => {
    const report = fakeReport({ base: scores([3, 3, 3, 2, 0, 0, 1, 0]), candidat: scores([3, 3, 3, 3, 3, 2, 0, 0]) });
    const result = compareBench(report, 'base', 'candidat');
    const at = new Date('2026-11-02T10:00:00Z');
    const markdown = comparisonMarkdown(result, at);
    expect(markdown).toContain('# Examen : candidat contre base');
    expect(markdown).toContain('| Mission | Niveau | base | candidat | Évolution |');
    expect(markdown).toContain('| e2-e | 2 | 0/3 | 3/3 | gagnée |');
    expect(markdown).toContain('**Total** : base 12/24 (par passage 5, 4, 3) · candidat 17/24 (par passage 6, 6, 5).');
    expect(markdown).toContain('## Verdict : meilleur (conseillé)');
    expect(markdown).toContain('Date : 2026-11-02');
    const text = comparisonText(result);
    expect(text).toContain('Verdict : meilleur — conseillé');
    expect(text).toContain('e2-f');
    const json = comparisonReport(result, at);
    expect(json).toMatchObject({ at: at.toISOString(), set: 'eval', rule: { maxLost: 2 }, verdict: 'meilleur', advised: true, won: ['e2-e', 'e2-f'], lost: [] });
    const serialized = JSON.stringify(json);
    expect(serialized).not.toMatch(/prompt|goal|content|Fichier|\\\\|\/tmp/);
  });
});
