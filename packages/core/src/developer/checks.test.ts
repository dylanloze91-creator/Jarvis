import { describe, expect, it } from 'vitest';
import {
  MIN_FREE_BYTES,
  checkEnvironment,
  formatBytes,
  parseToolVersion,
  type EnvironmentFacts,
} from './environmentCheck.js';
import { normalizeRepoRelative, protectedRepoPath } from './repoPaths.js';
import {
  SUGGESTED_REPO_PATH,
  candidateRepoPaths,
  compareVersions,
  isJarvisRemote,
  isOneDrivePath,
  validateRepo,
  type RepoFacts,
} from './repoCheck.js';

const GOOD: RepoFacts = {
  path: 'C:\\dev\\Jarvis',
  exists: true,
  isDirectory: true,
  hasGit: true,
  rootPackageName: 'jarvis',
  desktopPackageName: '@jarvis/desktop',
  desktopVersion: '0.4.23',
  originUrl: 'https://github.com/dylanloze91-creator/Jarvis.git',
  branch: 'main',
  head: '0123456789abcdef',
  dirtyFiles: 0,
  hasNodeModules: true,
};
const status = (report: ReturnType<typeof validateRepo>, id: string) =>
  report.checks.find((check) => check.id === id)?.status;

describe('copie de travail', () => {
  it('C:\\dev\\Jarvis est proposé en premier sous Windows', () => {
    expect(SUGGESTED_REPO_PATH).toBe('C:\\dev\\Jarvis');
    expect(candidateRepoPaths({ platform: 'win32', home: 'C:\\Users\\dex' })[0]).toBe(
      'C:\\dev\\Jarvis',
    );
    expect(candidateRepoPaths({ platform: 'win32', home: 'C:\\Users\\dex' })).toContain(
      'C:\\Users\\dex\\Documents\\Jarvis',
    );
  });

  it('une bonne copie passe toutes les vérifications', () => {
    const report = validateRepo(GOOD, '0.4.23');
    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status === 'ok')).toBe(true);
  });

  it('le piège 0.3.0 : une copie plus ancienne que le Jarvis installé est refusée', () => {
    const report = validateRepo({ ...GOOD, desktopVersion: '0.3.0' }, '0.4.23');
    expect(report.ok).toBe(false);
    expect(status(report, 'version')).toBe('fail');
    expect(report.checks.find((check) => check.id === 'version')?.detail).toMatch(
      /plus ancienne que le Jarvis installé \(0\.4\.23\)/,
    );
  });

  it('dossier absent, pas un dépôt git, autre projet', () => {
    expect(validateRepo({ ...GOOD, exists: false }, '0.4.23').checks[0]?.detail).toMatch(/cloner/);
    expect(status(validateRepo({ ...GOOD, hasGit: false }, '0.4.23'), 'git')).toBe('fail');
    expect(status(validateRepo({ ...GOOD, rootPackageName: 'autre' }, '0.4.23'), 'package')).toBe(
      'fail',
    );
  });

  it('avertissements : OneDrive, autre dépôt d’origine, dépendances absentes', () => {
    const report = validateRepo(
      {
        ...GOOD,
        path: 'C:\\Users\\dex\\OneDrive\\Documents\\Jarvis',
        originUrl: 'https://github.com/autre/x',
        hasNodeModules: false,
      },
      '0.4.23',
    );
    expect(report.ok).toBe(true);
    expect(status(report, 'onedrive')).toBe('warn');
    expect(status(report, 'remote')).toBe('warn');
    expect(status(report, 'dependencies')).toBe('warn');
  });

  it('versions, adresses et OneDrive', () => {
    expect(compareVersions('0.4.23', '0.4.22')).toBe(1);
    expect(compareVersions('0.3.0', '0.4.21')).toBe(-1);
    expect(compareVersions('v0.4.22', '0.4.22')).toBe(0);
    expect(compareVersions('0.4.22-local.1', '0.4.22')).toBe(0);
    expect(isJarvisRemote('git@github.com:dylanloze91-creator/Jarvis.git')).toBe(true);
    expect(isJarvisRemote('https://github.com/dylanloze91-creator/jarvis')).toBe(true);
    expect(isJarvisRemote('https://evil.example/dylanloze91-creator/Jarvis')).toBe(false);
    expect(isOneDrivePath('C:\\Users\\dex\\OneDrive - Perso\\Jarvis')).toBe(true);
    expect(isOneDrivePath('D:\\Sync\\Jarvis', ['D:\\Sync'])).toBe(true);
    expect(isOneDrivePath('C:\\dev\\Jarvis')).toBe(false);
  });
});

describe('environnement (Git, Node, npm, disque)', () => {
  const FACTS: EnvironmentFacts = {
    platform: 'win32',
    gitVersion: 'git version 2.47.1.windows.1',
    nodeVersion: 'v22.14.0',
    npmVersion: '10.9.2',
    freeBytes: 120 * 1024 ** 3,
    diskPath: 'C:\\',
    longPaths: true,
  };

  it('tout est prêt', () => {
    const report = checkEnvironment(FACTS);
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.detail)).toEqual([
      'Git 2.47.1',
      'Node 22.14.0',
      'npm 10.9.2',
      '120 Go libres sur C:\\.',
    ]);
  });

  it('Git et Node absents : commande winget affichée, jamais lancée', () => {
    const report = checkEnvironment({
      ...FACTS,
      gitVersion: null,
      nodeVersion: null,
      npmVersion: null,
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'git')?.command).toBe(
      'winget install --id Git.Git -e',
    );
    expect(report.checks.find((check) => check.id === 'node')?.command).toBe(
      'winget install --id OpenJS.NodeJS.LTS -e',
    );
  });

  it('Node trop ancien refusé, Node 20 accepté avec un conseil', () => {
    expect(checkEnvironment({ ...FACTS, nodeVersion: 'v18.20.4' }).ok).toBe(false);
    const report = checkEnvironment({ ...FACTS, nodeVersion: 'v20.19.0' });
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'node')?.status).toBe('warn');
  });

  it('disque : moins de 5 Go refusé ; chemins longs signalés', () => {
    const report = checkEnvironment({ ...FACTS, freeBytes: MIN_FREE_BYTES - 1, longPaths: false });
    expect(report.checks.find((check) => check.id === 'disk')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'longpaths')?.command).toBe(
      'git config --global core.longpaths true',
    );
    expect(parseToolVersion('git version 2.43.0')).toBe('2.43.0');
    expect(formatBytes(512 * 1024 ** 2)).toBe('512 Mo');
  });
});

describe('chemins lus par les outils de code', () => {
  it.each([
    ['apps/desktop/src/main/tools/index.ts', 'apps/desktop/src/main/tools/index.ts'],
    ['.\\apps\\desktop\\package.json', 'apps/desktop/package.json'],
    ['./CLAUDE.md', 'CLAUDE.md'],
    ['.', ''],
  ])('%s → %s', (input, expected) => expect(normalizeRepoRelative(input)).toBe(expected));

  it.each([
    'C:\\Windows\\system32',
    '/etc/passwd',
    '../secret',
    'apps/../../x',
    '\\\\serveur\\partage',
    ':(top)x',
    '~/x',
    'a\u0000b',
  ])('%s → refusé', (input) => expect(normalizeRepoRelative(input)).toBeNull());

  it.each([
    '.git/config',
    'node_modules/x/index.js',
    '.env',
    'apps/desktop/.env.local',
    'settings.json',
    'x/id_rsa',
    'cle.pem',
    'internal/gh-token.txt',
  ])('%s → protégé', (path) => expect(protectedRepoPath(path)).not.toBeNull());

  it.each([
    'CLAUDE.md',
    'apps/desktop/src/main/tools/index.ts',
    '.env.example',
    'packages/core/src/settings.ts',
  ])('%s → lisible', (path) => expect(protectedRepoPath(path)).toBeNull());
});
