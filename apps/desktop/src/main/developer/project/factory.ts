import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeRepoRelative, type TemplateFile } from '@jarvis/core';
import { GIT_SAFE } from '../tools/common.js';
import type { RunOutcome, Runner } from '../runner.js';
import { JARVIS_GIT_IDENTITY, isInside } from '../task/sandbox.js';
import type { NodeTools } from '../task/suites.js';

export const FACTORY_NPM_ARGS = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
export const FIRST_COMMIT_MESSAGE = 'Projet créé par Jarvis Développeur';

export class FactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactoryError';
  }
}

/** Commandes exactes montrées sur la carte de création, dans l'ordre. */
export function factoryCommands(dir: string, files: number): string[] {
  return [
    `écrire ${files} fichier(s) du gabarit dans "${dir}"`,
    `npm ${FACTORY_NPM_ARGS.join(' ')}`,
    'git init -b main',
    'git add -A',
    `git commit --no-verify --no-gpg-sign -m "${FIRST_COMMIT_MESSAGE}"`,
  ];
}

/** Écrit le gabarit dans un dossier neuf (ou vide) ; jamais par-dessus des fichiers existants. */
export async function writeProjectFiles(dir: string, files: TemplateFile[]): Promise<void> {
  if (existsSync(dir) && (await readdir(dir)).length > 0)
    throw new FactoryError(`« ${dir} » existe déjà et n’est pas vide : rien n’a été écrit.`);
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const rel = normalizeRepoRelative(file.path);
    const target = rel ? join(dir, rel) : '';
    if (!rel || !isInside(dir, target)) throw new FactoryError(`Chemin refusé : ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

function failed(outcome: RunOutcome, what: string): FactoryError {
  const detail = (outcome.error ?? outcome.stderr.trim()) || outcome.stdout.trim();
  return new FactoryError(`${what} a échoué : ${detail.split('\n').slice(-4).join(' ')}`);
}

/** `npm install` sans script d'installation : crée package-lock.json (réseau, confirmé avant). */
export async function installProject(
  run: Runner,
  dir: string,
  node: NodeTools,
  options: { signal?: AbortSignal; onLine?: (line: string) => void } = {},
): Promise<void> {
  const outcome = await run({
    program: node.nodePath,
    args: [node.npmCli, ...FACTORY_NPM_ARGS],
    cwd: dir,
    display: `npm ${FACTORY_NPM_ARGS.join(' ')}`,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    timeoutMs: 15 * 60_000,
    maxBytes: 400_000,
    signal: options.signal,
    onLine: options.onLine,
  });
  if (outcome.cancelled) throw new FactoryError('Installation annulée.');
  if (outcome.code !== 0) throw failed(outcome, 'npm install');
  if (!existsSync(join(dir, 'package-lock.json')))
    throw new FactoryError('npm install n’a pas créé package-lock.json.');
}

/** Dépôt local sur `main`, premier commit signé « Jarvis Développeur ». Aucun dépôt distant. */
export async function initProjectRepo(
  run: Runner,
  dir: string,
  signal?: AbortSignal,
): Promise<string> {
  const git = (args: string[], display: string) =>
    run({
      program: 'git',
      args: [...GIT_SAFE, ...args],
      cwd: dir,
      display,
      env: { ...process.env, ...JARVIS_GIT_IDENTITY },
      timeoutMs: 120_000,
      signal,
    });
  const steps: Array<[string[], string]> = [
    [['init', '-b', 'main'], 'git init -b main'],
    [['add', '-A'], 'git add -A'],
    [
      ['commit', '--no-verify', '--no-gpg-sign', '-m', FIRST_COMMIT_MESSAGE],
      `git commit --no-verify --no-gpg-sign -m "${FIRST_COMMIT_MESSAGE}"`,
    ],
  ];
  for (const [args, display] of steps) {
    const outcome = await git(args, display);
    if (outcome.code !== 0) throw failed(outcome, display);
  }
  const head = await git(['rev-parse', 'HEAD'], 'git rev-parse HEAD');
  if (head.code !== 0) throw failed(head, 'git rev-parse');
  return head.stdout.trim();
}
