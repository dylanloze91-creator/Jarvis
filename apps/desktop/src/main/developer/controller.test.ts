import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogStore,
  createDefaultRegistry,
  createDefaultSearchRegistry,
  parseSettings,
  type Settings,
} from '@jarvis/core';
import type { DeveloperState } from '../../shared/developerIpc.js';
import { DeveloperController } from './controller.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-dev-controller-'));
const repo = join(base, 'Jarvis');
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=t@example.com',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    { cwd, stdio: 'pipe' },
  ).toString();

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

beforeAll(() => {
  write(
    repo,
    'package.json',
    JSON.stringify({
      name: 'jarvis',
      version: '0.3.0',
      workspaces: ['packages/*', 'apps/*'],
      scripts: { test: 'vitest run' },
    }),
  );
  write(
    repo,
    'apps/desktop/package.json',
    JSON.stringify({
      name: '@jarvis/desktop',
      version: '0.4.23',
      dependencies: { electron: '44' },
    }),
  );
  write(
    repo,
    'packages/core/package.json',
    JSON.stringify({ name: '@jarvis/core', version: '0.3.0' }),
  );
  write(
    repo,
    'apps/desktop/src/main/tools/index.ts',
    "import { a } from './a';\n\nexport function createToolManager() {\n  return [a];\n}\n",
  );
  write(repo, 'apps/desktop/src/main/tools/a.ts', "export const a = defineTool({ name: 'a' });\n");
  write(repo, 'packages/core/src/agent/agent.ts', 'export class Agent {}\n');
  write(repo, 'packages/core/src/tools/manager.ts', 'export class ToolManager {}\n');
  write(repo, 'packages/core/src/settings.ts', 'export const settingsSchema = {};\n');
  write(
    repo,
    'apps/desktop/src/shared/ipc.ts',
    "export const IpcChannel = {\n  chatSend: 'chat:send',\n  chatCancel: 'chat:cancel',\n} as const;\n",
  );
  write(
    repo,
    'apps/desktop/src/renderer/src/components/ConfirmationCard.tsx',
    'export function ConfirmationCard() {}\n',
  );
  git(repo, 'init');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'initial');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/dylanloze91-creator/Jarvis.git');
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function controller(settings: Partial<Settings['developer']> = {}, installed = '0.4.23') {
  let current = parseSettings({ developer: { enabled: true, repoPath: '', ...settings } });
  const states: DeveloperState[] = [];
  const audit = new InMemoryAuditLogStore();
  const instance = new DeveloperController({
    getSettings: () => current,
    appVersion: () => installed,
    platform: process.platform,
    home: base,
    logsDir: () => join(base, 'logs'),
    oneDriveRoots: () => [],
    auditLog: audit,
    emit: (state) => states.push(structuredClone(state)),
    repoUrl: join(base, 'absent.git'),
    now: () => new Date(2026, 9, 2, 15, 0),
    freeBytes: async () => 100 * 1024 ** 3,
    registry: createDefaultRegistry(),
    searchRegistry: createDefaultSearchRegistry(),
    userDataPath: () => join(base, 'userData'),
  });
  return {
    instance,
    states,
    audit,
    disable: () => (current = parseSettings({ developer: { enabled: false } })),
  };
}

describe('mode Développeur coupé : rien ne se fait', () => {
  it('chaque action répond « coupé » sans lancer de commande ni toucher au disque', async () => {
    const { instance, states, audit } = controller({ enabled: false });
    for (const action of [
      () => instance.detect(),
      () => instance.validate(repo),
      () => instance.checkEnvironment(),
      () => instance.clone(join(base, 'x')),
      () => instance.install(),
      () => instance.analyze(),
    ]) {
      const state = await action();
      expect(state.enabled).toBe(false);
      expect(state.notice).toMatch(/coupé/);
      expect(state.task).toBeNull();
    }
    expect(states).toHaveLength(0);
    expect(await audit.list()).toHaveLength(0);
    expect(existsSync(join(base, 'x'))).toBe(false);
  });
});

describe('copie de travail et environnement', () => {
  it('valide une copie de Jarvis et refuse une copie plus ancienne que le Jarvis installé', async () => {
    const ok = await controller().instance.validate(repo);
    expect(ok.repo?.ok).toBe(true);
    expect(ok.repo?.branch).toBe('main');
    const old = await controller({}, '0.5.0').instance.validate(repo);
    expect(old.repo?.ok).toBe(false);
    expect(old.repo?.checks.find((check) => check.id === 'version')?.detail).toMatch(
      /plus ancienne/,
    );
  });

  it('détecte la copie enregistrée dans les réglages', async () => {
    const state = await controller({ repoPath: repo }).instance.detect();
    expect(state.repoPath).toBe(repo);
    expect(state.repo?.ok).toBe(true);
  });

  it('vérifie Git, Node, npm et le disque sur cette machine', async () => {
    const state = await controller().instance.checkEnvironment();
    const ids = state.environment?.checks.map((check) => check.id);
    expect(ids).toEqual(expect.arrayContaining(['git', 'node', 'npm', 'disk']));
    expect(state.environment?.checks.find((check) => check.id === 'git')?.status).toBe('ok');
    expect(state.environment?.checks.find((check) => check.id === 'node')?.status).not.toBe('fail');
  }, 30_000);
});

describe('carte de confirmation avec le tri de sécurité', () => {
  it('cloner : carte « Toujours à confirmer », refus = rien de cloné, et c’est journalisé', async () => {
    const { instance, states, audit } = controller();
    const target = join(base, 'clone-refuse');
    const running = instance.clone(target);
    let confirmation = states.find((state) => state.confirmation)?.confirmation;
    for (let i = 0; i < 200 && !confirmation; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      confirmation = states.find((state) => state.confirmation)?.confirmation;
    }
    expect(confirmation).toMatchObject({ toolName: 'dev_clone_repository', forced: true });
    expect(confirmation?.command).toBe(`git clone ${join(base, 'absent.git')} "${target}"`);
    expect(confirmation?.safety.level).toBe('always-confirm');
    expect(confirmation?.safety.label).toBe('Toujours à confirmer');
    instance.respondConfirmation(confirmation!.requestId, false);
    const final = await running;
    expect(final.task?.outcome).toBe('failed');
    expect(final.task?.steps.find((step) => step.id === 'confirm')?.status).toBe('failed');
    expect(existsSync(target)).toBe(false);
    expect((await audit.list()).map((entry) => [entry.toolName, entry.decision])).toEqual([
      ['dev_clone_repository', 'refused'],
    ]);
  }, 30_000);
});

describe('« Analyser mon architecture »', () => {
  it('rapport en lecture seule qui cite le vrai registre des outils, étapes visibles', async () => {
    const { instance, states, audit } = controller({ repoPath: repo });
    await instance.validate(repo);
    const state = await instance.analyze();
    expect(state.task?.outcome).toBe('success');
    expect(state.task?.steps.every((step) => step.status === 'done')).toBe(true);
    expect(state.report?.markdown).toContain(
      'Dans `apps/desktop/src/main/tools/index.ts` (ligne 3), fonction `createToolManager`',
    );
    expect(state.report?.markdown).toContain('`packages/core/src/agent/agent.ts` (ligne 1)');
    expect(state.report?.markdown).toContain('2 canaux dans `apps/desktop/src/shared/ipc.ts`');
    expect(states.some((s) => s.task?.steps.some((step) => step.status === 'running'))).toBe(true);
    const tools = new Set((await audit.list()).map((entry) => entry.toolName));
    expect([...tools].every((name) => name.startsWith('dev_'))).toBe(true);
    expect((await audit.list()).every((entry) => entry.decision === 'auto')).toBe(true);
  }, 30_000);

  const realRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
  it.skipIf(!existsSync(join(realRoot, '.git')))(
    'sur le vrai code de Jarvis : « où sont enregistrés les outils ? » → apps/desktop/src/main/tools/index.ts',
    async () => {
      const { instance } = controller({ repoPath: realRoot }, '0.0.1');
      await instance.validate(realRoot);
      const state = await instance.analyze();
      expect(state.task?.outcome).toBe('success');
      expect(state.report?.markdown).toMatch(
        /\*\*Où sont enregistrés les outils \?\*\* Dans `apps\/desktop\/src\/main\/tools\/index\.ts` \(ligne \d+\)/,
      );
      expect(state.report?.markdown).toContain('`packages/core/src/agent/agent.ts`');
    },
    60_000,
  );
});
