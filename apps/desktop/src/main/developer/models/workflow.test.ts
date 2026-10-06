import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogStore,
  createDefaultRegistry,
  createDefaultSearchRegistry,
  parseSettings,
} from '@jarvis/core';
import type { DeveloperState } from '../../../shared/developerIpc.js';
import { DeveloperController } from '../controller.js';
import { runProcess, type RunSpec } from '../runner.js';
import { FakeOllama } from './fakeOllama.testkit.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-code-model-'));
const realRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const DEFAULT = 'qwen3.6:35b-a3b-coding';
const fake = new FakeOllama();
let ctx: ReturnType<typeof setup>;
beforeAll(async () => {
  mkdirSync(join(base, 'home'), { recursive: true });
  await fake.start();
  ctx = setup();
});
afterAll(async () => {
  await fake.stop();
  rmSync(base, { recursive: true, force: true });
});

function setup(repoPath = '') {
  const settings = parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    baseUrl: fake.url,
    developer: { enabled: true, repoPath },
  });
  const states: DeveloperState[] = [];
  const runs: RunSpec[] = [];
  const audit = new InMemoryAuditLogStore();
  const env: Record<string, string | undefined> = {};
  const instance = new DeveloperController({
    getSettings: () => settings,
    appVersion: () => '0.0.1',
    platform: 'win32',
    home: join(base, 'home'),
    logsDir: () => join(base, 'logs'),
    oneDriveRoots: () => [],
    auditLog: audit,
    emit: (state) => states.push(structuredClone(state)),
    freeBytes: async () => 400e9,
    registry: createDefaultRegistry(),
    searchRegistry: createDefaultSearchRegistry(),
    userDataPath: () => join(base, 'userData'),
    env,
    system: {
      totalmem: () => 64 * 1024 ** 3,
      freemem: () => 48 * 1024 ** 3,
      cpus: () =>
        Array.from({ length: 8 }, () => ({
          model: 'Intel(R) Core(TM) i7-9700KF CPU @ 3.60GHz',
          speed: 3600,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        })),
    },
    run: async (spec) => {
      runs.push(spec);
      if (spec.program === 'nvidia-smi') {
        return {
          display: 'nvidia-smi',
          code: 0,
          stdout: 'NVIDIA GeForce RTX 2060, 6144, 700, 5444, 581.29\n',
          stderr: '',
          timedOut: false,
          cancelled: false,
          truncated: false,
          error: null,
        };
      }
      return runProcess(spec);
    },
  });
  return { instance, states, runs, audit, env };
}

async function confirmation(states: DeveloperState[], from: number) {
  for (let i = 0; i < 400; i += 1) {
    const found = states.slice(from).find((state) => state.confirmation)?.confirmation;
    if (found) return found;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('pas de carte de confirmation');
}

describe('modèle de code : ordre imposé, rien avant la validation', () => {
  const chats = () =>
    fake.requests
      .filter((r) => r.path === '/api/chat')
      .map((r) => r.body as Record<string, unknown>);

  it('1. rien n’est possible avant la vérification du matériel', async () => {
    expect((await ctx.instance.calibrate()).notice).toMatch(/matériel/);
    expect((await ctx.instance.validateConfig(DEFAULT, false)).notice).toMatch(/matériel/);
    expect((await ctx.instance.pull(DEFAULT)).notice).toMatch(/Valide d’abord/);
    expect(fake.pulls).toEqual([]);
  });

  it('1. matériel : carte, RAM, disque, Ollama ; estimations par défaut ; validation refusée sans étalonnage', async () => {
    const state = await ctx.instance.checkHardware();
    expect(state.model.hardware?.report.ok).toBe(true);
    expect(state.model.hardware?.facts.gpus[0]?.name).toBe('NVIDIA GeForce RTX 2060');
    expect(state.model.calibrationModel).toBe('qwen2.5:3b');
    expect(state.model.candidates.map((c) => c.spec.id)).toEqual([
      DEFAULT,
      'qwen3-coder:30b',
      'qwen3.5:4b',
      'qwen3.6:27b',
    ]);
    expect(state.model.candidates[0]?.experts?.basis).toBe('par défaut');
    expect((await ctx.instance.validateConfig(DEFAULT, false)).notice).toMatch(/étalonnage/);
  });

  it('1. étalonnage sur le modèle déjà installé : carte puis processeur seul, rien téléchargé', async () => {
    const state = await ctx.instance.calibrate();
    expect(state.task?.outcome).toBe('success');
    expect(Math.round(state.model.calibration!.gpuBytesPerSec! / 1e9)).toBe(69);
    expect(Math.round(state.model.calibration!.ramBytesPerSec! / 1e9)).toBe(19);
    expect(
      chats().map((body) => [body.model, (body.options as { num_gpu?: number }).num_gpu]),
    ).toEqual([
      ['qwen2.5:3b', undefined],
      ['qwen2.5:3b', 0],
    ]);
    expect(state.model.candidates[0]?.experts?.basis).toBe('étalonnée');
    expect(fake.pulls).toEqual([]);
  });

  it('2-3. experts en RAM : confirmation de l’utilisateur exigée ; validation explicite sans téléchargement', async () => {
    expect((await ctx.instance.validateConfig(DEFAULT, true)).notice).toMatch(/applique d’abord/);
    expect((await ctx.instance.confirmExperts(true)).model.experts.confirmedAt).not.toBeNull();
    const state = await ctx.instance.validateConfig(DEFAULT, true);
    expect(state.model.validation).toMatchObject({ modelId: DEFAULT, expertsInRam: true });
    expect(state.model.validation?.prediction?.placement).toBe('experts-in-ram');
    expect((await ctx.instance.pull('qwen3-coder:30b')).notice).toMatch(/Valide d’abord/);
    expect(fake.pulls).toEqual([]);
  });

  it('4. téléchargement séparé : carte « Toujours à confirmer » ; refus = rien ; accord = téléchargé', async () => {
    let from = ctx.states.length;
    const refused = ctx.instance.pull(DEFAULT);
    let card = await confirmation(ctx.states, from);
    expect(card.command).toBe(
      `ollama pull ${DEFAULT}\n(23 Go à télécharger dans ${join(base, 'home', '.ollama', 'models')})`,
    );
    expect(card.safety.level).toBe('always-confirm');
    ctx.instance.respondConfirmation(card.requestId, false);
    expect((await refused).task?.outcome).toBe('failed');
    expect(fake.pulls).toEqual([]);
    from = ctx.states.length;
    const approved = ctx.instance.pull(DEFAULT);
    card = await confirmation(ctx.states, from);
    ctx.instance.respondConfirmation(card.requestId, true);
    const state = await approved;
    expect(state.task?.outcome).toBe('success');
    expect(fake.pulls).toEqual([DEFAULT]);
    expect(state.model.hardware?.facts.ollama.models.some((m) => m.name === DEFAULT)).toBe(true);
  });

  it('5. banc de code sur le modèle téléchargé : appels d’outils, modification et correction vérifiées par tsc, mesures', async () => {
    fake.behaviour.set(DEFAULT, 'good');
    await ctx.instance.validate(realRoot);
    const state = await ctx.instance.benchmark(DEFAULT);
    const bench = state.model.benches.find((b) => b.model === DEFAULT)!;
    const tscAvailable =
      state.repo?.ok === true &&
      existsSync(join(realRoot, 'node_modules', 'typescript', 'bin', 'tsc'));
    expect(bench.summary).toEqual({
      toolCalls: '3/3',
      edit: tscAvailable ? true : null,
      fix: tscAvailable ? true : null,
      passed: tscAvailable,
    });
    expect(bench.metrics).toMatchObject({
      outputTokPerSec: 20,
      promptTokPerSec: 400,
      sizeVramBytes: 4e9,
      ramUsedBytes: 20e9,
      gpuUsedMiB: 700,
    });
    expect(bench.metrics.loadMs).toBeGreaterThanOrEqual(3_000);
    expect(bench.expertsInRam).toBe(true);
    const benchBody = chats().find((body) => body.model === DEFAULT)!;
    expect(benchBody).toMatchObject({
      think: false,
      keep_alive: '30m',
      options: { num_ctx: 32_768, num_gpu: 99 },
    });
  }, 120_000);

  it('5. un modèle qui écrit ses appels en texte échoue partout', async () => {
    fake.installed.set('qwen3.5:4b', 3.4e9);
    fake.behaviour.set('qwen3.5:4b', 'bad');
    const state = await ctx.instance.benchmark('qwen3.5:4b');
    const bench = state.model.benches.find((b) => b.model === 'qwen3.5:4b')!;
    expect(bench.summary.toolCalls).toBe('0/3');
    expect(bench.summary.edit).toBe(false);
    expect(bench.summary.passed).toBe(false);
  }, 120_000);

  it('les variables du serveur Ollama ne sont jamais modifiées, tout est journalisé, la validation survit au redémarrage', async () => {
    expect(ctx.env).toEqual({});
    expect(
      ctx.runs.some((spec) =>
        /setx|reg|powershell|launchctl|systemctl/i.test(`${spec.program} ${spec.args.join(' ')}`),
      ),
    ).toBe(false);
    expect(new Set(fake.requests.map((r) => r.path))).toEqual(
      new Set(['/api/version', '/api/tags', '/api/ps', '/api/chat', '/api/pull']),
    );
    const decisions = (await ctx.audit.list()).map(
      (entry) => `${entry.toolName}:${entry.decision}`,
    );
    expect(decisions).toEqual(
      expect.arrayContaining([
        'dev_variables_ollama:approved',
        'dev_valider_configuration:approved',
        'dev_pull_model:refused',
        'dev_pull_model:approved',
      ]),
    );
    const restarted = setup();
    await new Promise((r) => setTimeout(r, 50));
    expect(restarted.instance.state().model.validation?.modelId).toBe(DEFAULT);
  });

  it('5. juste après un redémarrage, le banc revérifie la copie de travail enregistrée pour son tsc', async () => {
    const restarted = setup(realRoot);
    expect(restarted.instance.state().repo).toBeNull();
    fake.behaviour.set('qwen3.5:4b', 'good');
    const state = await restarted.instance.benchmark('qwen3.5:4b');
    expect(state.repo).not.toBeNull();
    const tscAvailable =
      state.repo?.ok === true &&
      existsSync(join(realRoot, 'node_modules', 'typescript', 'bin', 'tsc'));
    const bench = state.model.benches.find((b) => b.model === 'qwen3.5:4b')!;
    expect(bench.summary).toEqual({
      toolCalls: '3/3',
      edit: tscAvailable ? true : null,
      fix: tscAvailable ? true : null,
      passed: tscAvailable,
    });
  }, 120_000);
});
