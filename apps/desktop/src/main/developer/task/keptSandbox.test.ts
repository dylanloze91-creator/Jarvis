import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness } from '../controllerHarness.testkit.js';
import { FakeOllama } from '../models/fakeOllama.testkit.js';
import { createFixtureRepo, taskScript } from './taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-garder-'));
const repo = join(base, 'Jarvis');
const MODEL = 'scripte:garder';
const fake = new FakeOllama();

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

describe('« Garder la branche » puis « Anciennes tâches » (observation 2 du test 0.5.0)', () => {
  it('la copie gardée apparaît tout de suite, sans redémarrage, et peut être jetée', async () => {
    const h = createHarness({ base, repo, fake, developer: { codeModel: MODEL } });
    const done = await h.instance.startTask('Ajoute une constante VERSION, puis garde la branche.');
    const branch = done.codeTask!.branch;
    expect(done.codeTask?.report?.verdict).toBe('success');

    const kept = await h.instance.keepTask();
    expect(kept.codeTask?.closed).toBe('kept');
    const listed = kept.sandboxes?.find((s) => s.branch === branch);
    expect(listed).toBeDefined();
    expect(listed?.current).toBe(false);

    const refreshed = await h.instance.listSandboxes();
    expect(refreshed.sandboxes?.find((s) => s.branch === branch)?.current).toBe(false);

    const cleaned = await h.instance.cleanSandboxes([listed!.path]);
    expect(cleaned.sandboxes?.some((s) => s.branch === branch)).toBe(false);
    expect(
      execFileSync('git', ['branch', '--list', branch], { cwd: repo, encoding: 'utf8' }).trim(),
    ).toBe('');
  }, 120_000);
});
