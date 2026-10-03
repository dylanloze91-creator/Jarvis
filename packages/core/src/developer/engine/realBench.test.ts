import { describe, expect, it } from 'vitest';
import {
  REAL_BENCH_TASKS,
  judgeAsk,
  judgeReview,
  realBenchTask,
  scoreRoles,
  singleHunkDiff,
  type AskTask,
  type CompleteTask,
  type EditTask,
  type RealBenchTaskResult,
  type ReviewTask,
} from './realBench.js';
import { SPECIALIST_ROLES } from './roles.js';

describe('banc réel (0.5.1)', () => {
  it('chaque rôle a au moins une tâche ; identifiants uniques', () => {
    for (const role of SPECIALIST_ROLES) {
      expect(
        REAL_BENCH_TASKS.some((task) => task.roles.includes(role)),
        role,
      ).toBe(true);
    }
    const ids = REAL_BENCH_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('mutations : la correction inverse la comparaison ; la revue retire la confirmation', () => {
    const fix = realBenchTask('fix-mutation') as EditTask;
    const source = 'function f() {\n    if (diff !== 0) return diff < 0 ? -1 : 1;\n}\n';
    expect(fix.mutate!(source)).toContain('diff < 0 ? 1 : -1');
    expect(fix.mutate!('rien ici')).toBeNull();
    const trap = realBenchTask('review-trap') as ReviewTask;
    const shell =
      "export const runCommandTool = defineTool({\n  risk: 'confirm',\n  forceConfirm: true,\n});\n";
    const mutated = trap.mutate(shell)!;
    expect(mutated).not.toContain('forceConfirm');
    const diff = singleHunkDiff('apps/desktop/src/main/tools/shell.ts', shell, mutated);
    expect(diff).toContain('-  forceConfirm: true,');
    expect(diff.startsWith('--- a/apps/desktop/src/main/tools/shell.ts\n+++ b/')).toBe(true);
    const clean = realBenchTask('review-clean') as ReviewTask;
    const commented = clean.mutate(shell)!;
    expect(singleHunkDiff('x.ts', shell, commented)).toMatch(/^\+\/\/ /m);
  });

  it('question : valeur attendue, fichier cité et au moins une citation vérifiée', () => {
    const task = realBenchTask('ask-rounds') as AskTask;
    const good = judgeAsk(task, {
      answer: 'Six tours au plus (6).',
      files: [{ path: 'packages/core/src/agent/agent.ts', exists: true }],
      citations: [
        {
          path: 'packages/core/src/agent/agent.ts',
          excerpt: 'HARD_TOOL_ROUND_CAP = 6',
          status: 'verified',
        },
      ],
      verified: 1,
    });
    expect(good.ok).toBe(true);
    const unproved = judgeAsk(task, {
      answer: '6, dans agent.ts',
      files: [{ path: 'packages/core/src/agent/agent.ts', exists: true }],
      citations: [
        { path: 'packages/core/src/agent/agent.ts', excerpt: 'MAX = 6', status: 'not-found' },
      ],
      verified: 0,
    });
    expect(unproved).toEqual({ ok: false, detail: 'aucune citation vérifiée dans le fichier' });
  });

  it('revue : le piège doit être bloquant ; le diff sain ne doit pas l’être', () => {
    const trap = realBenchTask('review-trap') as ReviewTask;
    const clean = realBenchTask('review-clean') as ReviewTask;
    const blocking = {
      verdict: 'refusé' as const,
      findings: [{ severity: 'bloquant' as const, message: 'confirmation retirée' }],
    };
    const fine = { verdict: 'ok' as const, findings: [] };
    expect(judgeReview(trap, blocking).ok).toBe(true);
    expect(judgeReview(trap, fine).ok).toBe(false);
    expect(judgeReview(clean, fine).ok).toBe(true);
    expect(judgeReview(clean, blocking).ok).toBe(false);
  });

  it('tâches de complétion : réponses acceptées ou refusées', () => {
    const needle = realBenchTask('context-needle') as CompleteTask;
    expect(needle.accept('Elle vaut 3e9 octets.')).toBe(true);
    expect(needle.accept('Elle vaut 5 Go.')).toBe(false);
    const doc = realBenchTask('doc-explain') as CompleteTask;
    expect(doc.accept('La fonction compare deux numéros de version et renvoie -1, 0 ou 1.')).toBe(
      true,
    );
    expect(doc.accept('Compares two versions.')).toBe(false);
    const research = realBenchTask('research-pages') as CompleteTask;
    expect(research.accept('Google, sans clé (Page 2).')).toBe(true);
    expect(research.accept('Google.')).toBe(false);
    const tester = realBenchTask('test-write') as CompleteTask;
    expect(
      tester.accept(
        "describe('v', () => { it('a', () => { expect(compareVersions('1','2')).toBe(-1); expect(1).toBe(1); expect(2).toBe(2); }); });",
      ),
    ).toBe(true);
    const missing = { 'packages/core/src/developer/repoCheck.ts': 'rien' };
    expect(doc.prompt(missing)).toBeNull();
  });

  it('score par rôle : réussis sur mesurables, rien de choisi', () => {
    const results: RealBenchTaskResult[] = [
      {
        id: 'a',
        label: 'a',
        roles: ['CODER'],
        ok: true,
        detail: '',
        durationMs: 1,
        outputTokPerSec: 10,
        calls: 1,
      },
      {
        id: 'b',
        label: 'b',
        roles: ['CODER', 'DEBUGGER'],
        ok: false,
        detail: '',
        durationMs: 1,
        outputTokPerSec: 10,
        calls: 1,
      },
      {
        id: 'c',
        label: 'c',
        roles: ['CODER'],
        ok: null,
        detail: 'tsc absent',
        durationMs: 0,
        outputTokPerSec: null,
        calls: 0,
      },
    ];
    const scores = scoreRoles(results);
    expect(scores.find((s) => s.role === 'CODER')).toEqual({
      role: 'CODER',
      passed: 1,
      measured: 2,
      total: 3,
      score: 0.5,
    });
    expect(scores.find((s) => s.role === 'REVIEWER')?.score).toBeNull();
    expect(scores).toHaveLength(8);
  });
});
