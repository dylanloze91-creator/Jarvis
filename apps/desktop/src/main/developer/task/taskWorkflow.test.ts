import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogStore,
  classifyCommand,
  createDefaultRegistry,
  parseSettings,
  type CommandSafetyLevel,
} from '@jarvis/core';
import type { DevConfirmation, DeveloperState } from '../../../shared/developerIpc.js';
import { DeveloperController } from '../controller.js';
import { FakeOllama } from '../models/fakeOllama.testkit.js';
import { displayCommand, runProcess, type Runner } from '../runner.js';
import { ChatActivity } from './chatActivity.js';
import { createFixtureRepo, taskScript } from './taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-tache-'));
const repo = join(base, 'Jarvis');
const MODEL = 'scripte:essai';
const fake = new FakeOllama();
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(MODEL, 3e9);
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

interface Harness {
  instance: DeveloperController;
  states: DeveloperState[];
  cards: DevConfirmation[];
  ran: Array<{ display: string; level: CommandSafetyLevel }>;
  audit: InMemoryAuditLogStore;
  chat: ChatActivity;
}

function setup(answer: (card: DevConfirmation) => boolean, approvePlan = true): Harness {
  const settings = parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    baseUrl: fake.url,
    developer: { enabled: true, repoPath: repo, codeModel: MODEL },
  });
  const states: DeveloperState[] = [];
  const cards: DevConfirmation[] = [];
  const ran: Harness['ran'] = [];
  const audit = new InMemoryAuditLogStore();
  const chat = new ChatActivity();
  const run: Runner = (spec) => {
    const display = spec.display ?? displayCommand(spec.program, spec.args);
    ran.push({ display, level: classifyCommand(display, spec.context ?? {}).level });
    return runProcess(spec);
  };
  let answeredPlan = false;
  const seen = new Set<string>();
  const harness = { states, cards, ran, audit, chat } as Harness;
  harness.instance = new DeveloperController({
    getSettings: () => settings,
    appVersion: () => '0.0.1',
    platform: process.platform,
    home: join(base, 'home'),
    logsDir: () => join(base, 'logs'),
    oneDriveRoots: () => [],
    auditLog: audit,
    freeBytes: async () => 400e9,
    registry: createDefaultRegistry(),
    userDataPath: () => join(base, 'userData'),
    env: {},
    run,
    chat,
    chatGraceMs: 0,
    emit: (state) => {
      states.push(structuredClone(state));
      const card = state.confirmation;
      if (card && !seen.has(card.requestId)) {
        seen.add(card.requestId);
        cards.push(structuredClone(card));
        const ok = answer(card);
        setTimeout(() => harness.instance.respondConfirmation(card.requestId, ok), 0);
      }
      if (state.codeTask?.status === 'awaiting-approval' && !answeredPlan) {
        answeredPlan = true;
        setTimeout(() => harness.instance.approvePlan(approvePlan), 0);
      }
    },
  });
  return harness;
}

const expected = (card: DevConfirmation) =>
  card.toolName === 'dev_install_sandbox' ||
  card.toolName === 'dev_review_diff' ||
  card.toolName === 'dev_rollback' ||
  card.toolName === 'dev_discard_sandbox' ||
  (card.toolName === 'dev_edit_file' && Boolean(card.reason?.includes('cœur')));

describe('tâche de code : plan → validation → modification → tests → correction → rapport', () => {
  it('plan refusé : rien n’est créé ni écrit', async () => {
    fake.scripts.set(MODEL, taskScript());
    const h = setup(() => false, false);
    const state = await h.instance.startTask('Ajoute une constante VERSION exportée.');
    expect(state.codeTask?.status).toBe('refused');
    expect(state.codeTask?.plan?.files.map((f) => [f.path, f.action, Boolean(f.core)])).toEqual([
      ['src/version.ts', 'create', false],
      ['src/index.ts', 'edit', false],
      ['package.json', 'edit', true],
    ]);
    expect(state.codeTask?.plan?.testCommands).toEqual(['npm run typecheck', 'npm test']);
    expect(h.cards).toEqual([]);
    expect(git(repo, 'worktree', 'list')).not.toContain('jarvis-dev');
    expect(existsSync(join(base, 'Jarvis-taches'))).toBe(false);
  }, 60_000);

  let success: Harness;
  it('validé : copie isolée, référence, modification, revue du diff, échec, correction, réussite', async () => {
    let pausedOnce = false;
    const chat = { current: null as ChatActivity | null };
    fake.scripts.set(
      MODEL,
      taskScript({
        onEditRound: (round) => {
          if (round === 2 && !pausedOnce && chat.current) {
            pausedOnce = true;
            chat.current.begin();
            setTimeout(() => chat.current!.end(), 150);
          }
        },
      }),
    );
    success = setup(expected);
    chat.current = success.chat;
    const headBefore = git(repo, 'rev-parse', 'HEAD');
    const state = await success.instance.startTask('Ajoute une constante VERSION exportée.');
    const task = state.codeTask!;
    expect(state.task?.outcome).toBe('success');
    expect(task.report?.verdict).toBe('success');
    expect(task.report?.markdown).toMatch(
      /\| Série \| typecheck \| test \| Nouveaux échecs \|\n\| --- \| --- \| --- \| --- \|\n\| Référence \(avant\) \|/,
    );
    expect(task.branch).toMatch(
      /^jarvis-dev\/\d{4}-\d{2}-\d{2}-ajoute-une-constante-version-exportee$/,
    );
    expect(task.worktreePath).toBe(
      join(base, 'Jarvis-taches', task.branch.slice('jarvis-dev/'.length)),
    );
    expect(task.baseline?.map((r) => [r.suite, r.failures])).toEqual([
      ['typecheck', []],
      ['test', ['test src/old.test.ts > ancien > échoue déjà']],
    ]);
    expect(task.runs.map((r) => [r.label, r.ok, r.newFailures])).toEqual([
      [
        'Après modification',
        false,
        [expect.stringContaining('typecheck: tsc src/version.ts TS2322')],
      ],
      ['Correction 1', true, []],
    ]);
    expect(task.attempts).toBe(1);
    expect(task.testSeriesUsed).toBe(3);
    expect(task.diff.map((f) => [f.path, f.status])).toEqual([
      ['package.json', 'modified'],
      ['src/index.ts', 'modified'],
      ['src/version.ts', 'added'],
    ]);
    expect(task.checkpoints.map((c) => c.label)).toEqual([
      'Modification (plan validé)',
      'Correction 1',
    ]);
    expect(task.findings.map((f) => f.category)).toEqual(['network']);
    expect(state.task?.steps.map((s) => `${s.id}:${s.status}`)).toEqual(
      expect.arrayContaining(['fix-1:done', 'retest-1:done', 'pause-1:done', 'report:done']),
    );
    expect(task.pauses).toHaveLength(1);
    expect(fake.unloaded).toContain(MODEL);
    // La copie de l'utilisateur n'a pas bougé.
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(readFileSync(join(repo, 'src', 'index.ts'), 'utf8')).toBe('export {};\n');
    expect(readFileSync(join(task.worktreePath, 'src', 'version.ts'), 'utf8')).not.toContain(
      'TYPE_ERROR',
    );
  }, 120_000);

  it('décision 9 : cartes seulement pour le cœur, les téléchargements et le code sensible ; le reste validé par le plan', async () => {
    const cards = success.cards.map((c) => [
      c.toolName,
      c.safety.level,
      Boolean(c.diff?.length),
      Boolean(c.findings?.length),
    ]);
    expect(cards).toEqual([
      ['dev_install_sandbox', 'always-confirm', false, false],
      ['dev_edit_file', 'always-confirm', true, false],
      ['dev_review_diff', 'always-confirm', false, true],
    ]);
    expect(success.cards[1]!.diff![0]!.path).toBe('package.json');
    const task = success.instance.state().codeTask!;
    expect(task.asked).toBe(3);
    expect(task.planApproved.map((a) => `${a.tool} ${a.target}`)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^dev_create_branch jarvis-dev\//),
        'dev_create_file src/version.ts',
        'dev_edit_file src/index.ts',
        'dev_run_tests typecheck',
        'dev_run_tests test',
      ]),
    );
    const entries = await success.audit.list();
    expect(entries.find((e) => e.toolName === 'dev_create_file')?.resultSummary).toMatch(
      /^Validé par le plan\./,
    );
    expect(entries.find((e) => e.toolName === 'dev_install_sandbox')?.decision).toBe('approved');
    expect(entries.find((e) => e.toolName === 'dev_review_diff')?.decision).toBe('approved');
  });

  it('chaque commande est passée par le tri : tests automatiques dans la copie isolée, rien de refusé, aucun push', () => {
    expect(success.ran.filter((r) => r.level === 'denied')).toEqual([]);
    expect(
      success.ran.filter((r) => r.display === 'npm run typecheck').every((r) => r.level === 'auto'),
    ).toBe(true);
    expect(
      success.ran.filter((r) => r.display === 'npm test').every((r) => r.level === 'auto'),
    ).toBe(true);
    expect(success.ran.find((r) => r.display.startsWith('npm ci'))?.level).toBe('always-confirm');
    expect(success.ran.some((r) => /\b(push|publish)\b/.test(r.display))).toBe(false);
  });

  it('un modèle qui ne corrige pas : arrêt net dès que la correction reproduit le même échec, verdict « échec » honnête', async () => {
    fake.scripts.set(MODEL, taskScript({ neverFix: true }));
    const h = setup(expected);
    const state = await h.instance.startTask(
      'Ajoute une constante VERSION, essai sans correction.',
    );
    const task = state.codeTask!;
    expect(state.task?.outcome).toBe('failed');
    expect(state.task?.message).toMatch(
      /^Arrêt net : la correction 1 reproduit exactement le même échec/,
    );
    expect(state.task?.message).toMatch(/Les 2 correction\(s\) restante\(s\) ne sont pas tentées/);
    expect(task.status).toBe('failed');
    expect(task.report?.verdict).toBe('failed');
    expect(task.attempts).toBe(1);
    expect(task.repeatedFailure).toMatchObject({ attempt: 1, unused: 2 });
    expect(task.testSeriesUsed).toBe(3);
    expect(h.ran.filter((r) => r.display === 'npm run typecheck')).toHaveLength(3);
    expect(task.report?.markdown).toContain('Arrêt net');
    expect(task.report?.markdown).toContain('Échecs restants');
    const cleaned = await h.instance.discardTask();
    expect(cleaned.codeTask?.closed).toBe('discarded');
  }, 120_000);

  it('retour arrière puis « jeter » : toujours confirmés ; la branche et le dossier disparaissent', async () => {
    const { instance } = success;
    const before = instance.state().codeTask!;
    const first = before.checkpoints[0]!.sha;
    const rolled = await instance.rollbackTask(first);
    expect(rolled.task?.outcome).toBe('success');
    expect(readFileSync(join(before.worktreePath, 'src', 'version.ts'), 'utf8')).toContain(
      'TYPE_ERROR',
    );
    expect(rolled.codeTask?.checkpoints).toHaveLength(1);
    const discarded = await instance.discardTask();
    expect(discarded.task?.outcome).toBe('success');
    expect(discarded.codeTask?.closed).toBe('discarded');
    expect(existsSync(before.worktreePath)).toBe(false);
    expect(git(repo, 'branch', '--list', 'jarvis-dev/*')).toBe('');
    expect(success.cards.slice(-2).map((c) => c.toolName)).toEqual([
      'dev_rollback',
      'dev_discard_sandbox',
    ]);
  }, 60_000);
});
