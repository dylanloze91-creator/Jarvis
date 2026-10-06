import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogStore,
  createDefaultRegistry,
  createDefaultSearchRegistry,
  parseSettings,
} from '@jarvis/core';
import type { DevConfirmation, DeveloperState } from '../../../shared/developerIpc.js';
import { DeveloperController } from '../controller.js';
import { FakeOllama } from '../models/fakeOllama.testkit.js';
import { displayCommand, runProcess, type Runner } from '../runner.js';
import { ChatActivity } from './chatActivity.js';
import { createFixtureRepo, taskScript } from './taskWorkflow.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-essais-'));
const repo = join(base, 'Jarvis');
const MODEL = 'scripte:essais';
const fake = new FakeOllama();

beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  createFixtureRepo(repo);
  await fake.start();
  fake.installed.set(MODEL, 3e9);
  fake.scripts.set(MODEL, taskScript({ neverFix: true }));
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

const expectedCard = (card: DevConfirmation) =>
  card.toolName === 'dev_install_sandbox' ||
  card.toolName === 'dev_review_diff' ||
  card.toolName === 'dev_discard_sandbox' ||
  (card.toolName === 'dev_edit_file' && Boolean(card.reason?.includes('cœur')));

function controller(maxFixAttempts: number) {
  const settings = parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    baseUrl: fake.url,
    developer: { enabled: true, repoPath: repo, codeModel: MODEL, maxFixAttempts },
  });
  const typechecks: string[] = [];
  const run: Runner = (spec) => {
    const display = spec.display ?? displayCommand(spec.program, spec.args);
    if (display === 'npm run typecheck') typechecks.push(display);
    return runProcess(spec);
  };
  const seen = new Set<string>();
  let answeredPlan = false;
  const instance: DeveloperController = new DeveloperController({
    getSettings: () => settings,
    appVersion: () => '0.0.1',
    platform: process.platform,
    home: join(base, 'home'),
    logsDir: () => join(base, 'logs'),
    oneDriveRoots: () => [],
    auditLog: new InMemoryAuditLogStore(),
    freeBytes: async () => 400e9,
    registry: createDefaultRegistry(),
    searchRegistry: createDefaultSearchRegistry(),
    userDataPath: () => join(base, 'userData'),
    env: {},
    run,
    chat: new ChatActivity(),
    chatGraceMs: 0,
    emit: (state: DeveloperState) => {
      const card = state.confirmation;
      if (card && !seen.has(card.requestId)) {
        seen.add(card.requestId);
        const ok = expectedCard(card);
        setTimeout(() => instance.respondConfirmation(card.requestId, ok), 0);
      }
      if (state.codeTask?.status === 'awaiting-approval' && !answeredPlan) {
        answeredPlan = true;
        setTimeout(() => instance.approvePlan(true), 0);
      }
    },
  });
  return { instance, typechecks };
}

describe('tâche de code avec developer.maxFixAttempts', () => {
  it('une seule correction : 3 séries de tests au plus, puis verdict « échec »', async () => {
    const { instance, typechecks } = controller(1);
    const state = await instance.startTask('Ajoute une constante VERSION, une seule correction.');
    const task = state.codeTask!;
    expect(task.maxAttempts).toBe(1);
    expect(task.plan?.maxTestSeries).toBe(3);
    expect(task.attempts).toBe(1);
    expect(task.testSeriesUsed).toBe(3);
    expect(typechecks).toHaveLength(3);
    expect(task.report?.verdict).toBe('failed');
    expect(state.task?.message).toMatch(/échouent encore après 1 correction/);
    const cleaned = await instance.discardTask();
    expect(cleaned.codeTask?.closed).toBe('discarded');
  }, 120_000);
});
