import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness } from '../controllerHarness.testkit.js';
import { FakeOllama } from '../models/fakeOllama.testkit.js';
import { createFixtureRepo, taskScript } from './taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-appliquer-'));
const repo = join(base, 'Jarvis');
const MODEL = 'scripte:appliquer';
const fake = new FakeOllama();
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const REQUEST = 'Ajoute une constante VERSION et exporte-la.';

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(MODEL, 3e9);
  fake.scripts.set(MODEL, taskScript());
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

async function finishedTask(answer?: Parameters<typeof createHarness>[0]['answer']) {
  const h = createHarness({ base, repo, fake, developer: { codeModel: MODEL }, answer });
  await h.instance.validate(repo);
  const done = await h.instance.startTask(REQUEST);
  expect(done.codeTask?.report?.verdict).toBe('success');
  return h;
}

describe('« Appliquer » une tâche réussie (0.5.3)', () => {
  it('fusion --no-ff dans la copie après la carte, puis annulation par git revert', async () => {
    const head = git('rev-parse', 'HEAD');
    const h = await finishedTask();
    expect(existsSync(join(repo, 'src/version.ts'))).toBe(false);

    const applied = await h.instance.applyTask();
    expect(applied.task?.outcome, applied.task?.message).toBe('success');
    const card = h.cards.find((c) => c.toolName === 'dev_apply_task')!;
    expect(card.safety.level).toBe('always-confirm');
    expect(card.command).toContain('git merge --no-ff --no-verify --no-edit --no-gpg-sign');
    expect(card.diff?.map((f) => f.path)).toEqual(
      expect.arrayContaining(['src/version.ts', 'src/index.ts']),
    );
    const merge = git('rev-parse', 'HEAD');
    expect(applied.codeTask?.applied).toMatchObject({
      preHead: head,
      merge,
      branch: 'main',
      revertedAt: null,
    });
    expect(git('rev-parse', 'HEAD^1')).toBe(head);
    expect(git('log', '-1', '--format=%an|%s')).toMatch(
      /^Jarvis Développeur\|Jarvis Développeur : Ajoute une constante VERSION/,
    );
    expect(existsSync(join(repo, 'src/version.ts'))).toBe(true);
    expect(git('log', '-1', '--format=%G?')).toBe('N');
    expect(git('status', '--porcelain')).toBe('');
    expect(applied.codeTask?.report?.markdown).toContain('### Application');
    expect(h.ran.some((r) => /\bgit push\b/.test(r.display))).toBe(false);

    expect((await h.instance.applyTask()).notice).toMatch(/déjà appliquée/);

    const reverted = await h.instance.revertTask();
    expect(reverted.task?.outcome, reverted.task?.message).toBe('success');
    expect(h.cards.find((c) => c.toolName === 'dev_revert_apply')?.safety.level).toBe(
      'always-confirm',
    );
    expect(git('rev-parse', 'HEAD^')).toBe(merge);
    expect(existsSync(join(repo, 'src/version.ts'))).toBe(false);
    expect(reverted.codeTask?.applied?.revertedAt).not.toBeNull();

    const audited = (await h.audit.list()).map((e) => `${e.toolName}:${e.decision}`);
    expect(audited).toEqual(
      expect.arrayContaining(['dev_apply_task:approved', 'dev_revert_apply:approved']),
    );
    await h.instance.discardTask();
  }, 120_000);

  it('carte refusée : la copie ne change pas', async () => {
    const head = git('rev-parse', 'HEAD');
    const h = await finishedTask((card) => card.toolName !== 'dev_apply_task');
    const state = await h.instance.applyTask();
    expect(state.task?.message).toMatch(/refusée/);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(state.codeTask?.applied ?? null).toBeNull();
    await h.instance.discardTask();
  }, 120_000);

  it('conflit : fusion annulée (git merge --abort), copie intacte', async () => {
    const h = await finishedTask();
    writeFileSync(join(repo, 'src/index.ts'), 'export const AUTRE = 1;\n');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qam',
      'changement à moi',
    );
    const head = git('rev-parse', 'HEAD');
    const state = await h.instance.applyTask();
    expect(state.task?.outcome).toBe('failed');
    expect(state.task?.message).toMatch(/annulée : ta copie n’a pas changé/);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('status', '--porcelain')).toBe('');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    await h.instance.discardTask();
  }, 120_000);

  it('copie modifiée non enregistrée : refus avant la carte', async () => {
    const h = await finishedTask();
    writeFileSync(join(repo, 'src/index.ts'), 'export const BROUILLON = 2;\n');
    const head = git('rev-parse', 'HEAD');
    const state = await h.instance.applyTask();
    expect(state.task?.outcome).toBe('failed');
    expect(state.task?.message).toMatch(/non enregistré/);
    expect(h.cards.some((c) => c.toolName === 'dev_apply_task')).toBe(false);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    git('checkout', '--', 'src/index.ts');
    await h.instance.discardTask();
  }, 120_000);
});
