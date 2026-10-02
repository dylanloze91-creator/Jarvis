import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfirmationRequest, ToolCallOutcome } from '@jarvis/core';
import { runProcess, type RunSpec } from '../runner.js';
import {
  DEVELOPER_READ_TOOLS,
  DEVELOPER_SETUP_TOOLS,
  createDeveloperToolManager,
} from './index.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-dev-tools-'));
const repo = join(base, 'Jarvis');
const logs = join(base, 'logs');
const bare = join(base, 'origin.git');
const NEVER = { apps: 'never', files: 'never', capture: 'never', shell: 'never' } as const;

function write(path: string, content: string): void {
  mkdirSync(join(repo, path, '..'), { recursive: true });
  writeFileSync(join(repo, path), content);
}
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

beforeAll(() => {
  mkdirSync(repo, { recursive: true });
  write(
    'package.json',
    JSON.stringify({ name: 'jarvis', version: '0.3.0', scripts: { test: 'vitest run' } }),
  );
  write(
    'apps/desktop/package.json',
    JSON.stringify({ name: '@jarvis/desktop', version: '0.4.23' }),
  );
  write(
    'apps/desktop/src/main/tools/index.ts',
    'import { a } from "./a";\n\nexport function createToolManager() {\n  return [a];\n}\n',
  );
  write(
    'apps/desktop/src/main/tools/a.ts',
    "export const a = defineTool({ name: 'a' });\nexport const b = defineTool({ name: 'b' });\n",
  );
  write('CLAUDE.md', '# Jarvis\nLis ce fichier avant de modifier le code.\n');
  write('.env', 'createToolManager=sk-live-secretvalue0123456789\n');
  write('settings.json', '{ "searchApiKey": "tvly-dev-0123456789abcdef" }\n');
  git(repo, 'init');
  git(repo, 'add', '-A');
  git(repo, 'add', '-f', '.env');
  git(repo, 'commit', '-m', 'initial');
  if (process.platform !== 'win32') {
    symlinkSync('/etc', join(repo, 'dehors'));
    symlinkSync('.env', join(repo, 'innocent.txt'));
  }
  mkdirSync(logs);
  writeFileSync(
    join(logs, 'voice-capture.log'),
    '[démarrage] ok\nclé searchApiKey=tvly-dev-0123456789abcdef\n',
  );
  git(base, 'clone', '--bare', repo, bare);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

function setup(
  overrides: { getRoot?: () => string | null; run?: typeof runProcess; approve?: boolean } = {},
) {
  const asked: ConfirmationRequest[] = [];
  const manager = createDeveloperToolManager({
    getRoot: overrides.getRoot ?? (() => repo),
    run: overrides.run ?? runProcess,
    logsDir: () => logs,
    repoUrl: bare,
    getNode: async () => ({ nodePath: process.execPath, npmCli: join(base, 'npm-cli.js') }),
    freeBytes: async () => 100 * 1024 ** 3,
  });
  const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolCallOutcome> =>
    manager.execute(
      { id: `${name}-${Math.random()}`, name, arguments: args },
      {
        policies: NEVER,
        requestConfirmation: async (request) => {
          asked.push(request);
          return overrides.approve ?? false;
        },
      },
    );
  return { manager, call, asked };
}

describe('gestionnaire d’outils développeur (séparé du chat)', () => {
  it('six outils de lecture safe, deux outils de préparation toujours confirmés', () => {
    const { manager } = setup();
    const tools = manager
      .list()
      .map((tool) => ({
        name: tool.name,
        risk: tool.risk,
        forceConfirm: tool.forceConfirm,
        category: tool.category ?? null,
      }));
    expect(tools).toEqual([
      ...DEVELOPER_READ_TOOLS.map((name) => ({
        name,
        risk: 'safe',
        forceConfirm: false,
        category: null,
      })),
      ...DEVELOPER_SETUP_TOOLS.map((name) => ({
        name,
        risk: 'confirm',
        forceConfirm: true,
        category: null,
      })),
    ]);
  });

  it('sans copie de travail validée : rien n’est lu', async () => {
    const { call } = setup({ getRoot: () => null });
    const outcome = await call('dev_read_file', { path: 'CLAUDE.md' });
    expect(outcome.status).toBe('error');
    expect(outcome.content).toMatch(/Aucune copie de travail validée/);
  });
});

describe('lecture limitée à la copie de travail', () => {
  it('lit un fichier par son chemin relatif', async () => {
    const outcome = await setup().call('dev_read_file', { path: 'CLAUDE.md' });
    expect(outcome.status).toBe('ok');
    expect(outcome.content).toContain('Lis ce fichier avant de modifier le code.');
  });

  it.each([
    '../secret.txt',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '.env',
    '.git/config',
    'node_modules/x/index.js',
    'settings.json',
    'apps/../../x',
  ])('%s → refusé', async (path) => {
    const outcome = await setup().call('dev_read_file', { path });
    expect(outcome.status).toBe('error');
    expect(outcome.content).toMatch(/Chemin refusé/);
  });

  it.skipIf(process.platform === 'win32')(
    'un lien symbolique ne permet ni de sortir ni de lire un secret',
    async () => {
      const { call } = setup();
      expect((await call('dev_read_file', { path: 'dehors/hostname' })).content).toMatch(
        /sort de la copie de travail/,
      );
      expect((await call('dev_read_file', { path: 'innocent.txt' })).content).toMatch(
        /fichier protégé/,
      );
    },
  );

  it('recherche dans le code : bon fichier et bonne ligne, jamais les fichiers secrets', async () => {
    const outcome = await setup().call('dev_search_code', { pattern: 'createToolManager' });
    expect(outcome.status).toBe('ok');
    expect(outcome.content).toContain('apps/desktop/src/main/tools/index.ts:3:');
    expect(outcome.content).not.toContain('.env');
    expect(outcome.content).not.toContain('sk-live');
    const counted = await setup().call('dev_search_code', { mode: 'count' });
    expect(
      (counted.data as { counts: Record<string, number> }).counts[
        'apps/desktop/src/main/tools/index.ts'
      ],
    ).toBe(5);
  });

  it('recherche de fichiers par motif, sans les fichiers secrets', async () => {
    const outcome = await setup().call('dev_search_files', { glob: '**/*.json' });
    const files = (outcome.data as { files: string[] }).files;
    expect(files).toEqual(['apps/desktop/package.json', 'package.json']);
  });

  it('git status et git diff après une modification', async () => {
    write('CLAUDE.md', '# Jarvis\nLis ce fichier avant de modifier le code.\nNouvelle ligne.\n');
    const { call } = setup();
    const status = await call('dev_git_status');
    expect(status.content).toMatch(/Branche main/);
    expect(status.content).toContain('M CLAUDE.md');
    const diff = await call('dev_git_diff', { path: 'CLAUDE.md' });
    expect(diff.content).toContain('+Nouvelle ligne.');
    expect((await call('dev_git_diff', { path: '../x' })).content).toMatch(/Chemin refusé/);
  });

  it('journaux : liste, lecture de la fin, secrets masqués', async () => {
    const { call } = setup();
    expect((await call('dev_inspect_logs')).content).toContain('voice-capture.log');
    const read = await call('dev_inspect_logs', { name: 'voice-capture.log' });
    expect(read.content).toContain('[démarrage] ok');
    expect(read.content).not.toContain('tvly-dev-0123456789abcdef');
    expect((await call('dev_inspect_logs', { name: '../settings.json' })).status).toBe('error');
  });
});

describe('préparation : carte de confirmation, commande exacte', () => {
  it('cloner : carte incompressible même avec la politique « jamais » ; refus = rien n’est créé', async () => {
    const target = join(base, 'clone-refuse');
    const { call, asked } = setup({ approve: false });
    const outcome = await call('dev_clone_repository', { targetPath: target });
    expect(outcome.status).toBe('denied');
    expect(asked[0]).toMatchObject({
      toolName: 'dev_clone_repository',
      forced: true,
      command: `git clone ${bare} "${target}"`,
    });
    expect(existsSync(target)).toBe(false);
  });

  it('cloner : accepté, le dépôt est cloné ; dossier non vide ou chemin relatif refusés', async () => {
    const target = join(base, 'clone-ok', 'Jarvis');
    const { call } = setup({ approve: true });
    const outcome = await call('dev_clone_repository', { targetPath: target });
    expect(outcome.status).toBe('ok');
    expect(existsSync(join(target, 'apps', 'desktop', 'package.json'))).toBe(true);
    expect((await call('dev_clone_repository', { targetPath: target })).content).toMatch(
      /n’est pas vide/,
    );
    expect((await call('dev_clone_repository', { targetPath: 'dev/Jarvis' })).content).toMatch(
      /Chemin complet attendu/,
    );
  });

  it('npm ci : node + npm-cli.js sans shell, ONNXRUNTIME_NODE_INSTALL=skip, commande affichée exacte', async () => {
    const specs: RunSpec[] = [];
    const fakeRun = async (spec: RunSpec) => {
      specs.push(spec);
      return {
        display: spec.display ?? '',
        code: 0,
        stdout: 'added 612 packages',
        stderr: '',
        timedOut: false,
        cancelled: false,
        truncated: false,
        error: null,
      };
    };
    const { call, asked } = setup({ approve: true, run: fakeRun });
    const outcome = await call('dev_install_dependencies');
    expect(outcome.status).toBe('ok');
    expect(asked[0]).toMatchObject({
      forced: true,
      command: `npm ci --no-audit --no-fund\n(dans ${repo}, avec ONNXRUNTIME_NODE_INSTALL=skip)`,
    });
    expect(specs[0]).toMatchObject({
      program: process.execPath,
      args: [join(base, 'npm-cli.js'), 'ci', '--no-audit', '--no-fund'],
      cwd: repo,
      display: 'npm ci --no-audit --no-fund',
    });
    expect(specs[0]?.env?.ONNXRUNTIME_NODE_INSTALL).toBe('skip');
  });

  it('npm ci refusé : rien n’est lancé', async () => {
    let ran = false;
    const { call } = setup({
      approve: false,
      run: async () => ((ran = true), Promise.reject(new Error('ne doit pas tourner'))),
    });
    expect((await call('dev_install_dependencies')).status).toBe('denied');
    expect(ran).toBe(false);
  });
});
