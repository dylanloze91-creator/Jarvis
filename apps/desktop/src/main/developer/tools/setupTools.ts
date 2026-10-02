import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  JARVIS_REPO_URL,
  MIN_FREE_BYTES,
  defineTool,
  formatBytes,
  toolSuccess,
  type RegisteredTool,
} from '@jarvis/core';
import type { Runner } from '../runner.js';
import { fail } from './common.js';

export interface SetupToolDeps {
  run: Runner;
  repoUrl?: string;
  /** Copie de travail choisie (pour npm ci). */
  getRoot: () => string | null;
  /** Node et npm-cli.js de l'utilisateur, trouvés par la vérification de l'environnement. */
  getNode: () => Promise<{ nodePath: string | null; npmCli: string | null }>;
  freeBytes: (path: string) => Promise<number | null>;
}

export const NPM_CI_ARGS = ['ci', '--no-audit', '--no-fund'];

function tail(text: string, lines = 12): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}

export function createSetupTools(deps: SetupToolDeps): RegisteredTool[] {
  const url = deps.repoUrl ?? JARVIS_REPO_URL;
  return [
    defineTool({
      name: 'dev_clone_repository',
      description: 'Clone le code de Jarvis depuis GitHub dans un dossier vide. Toujours confirmé.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({ targetPath: z.string().min(3).max(300) }),
      summarize: ({ targetPath }) =>
        `Télécharger le code de Jarvis depuis GitHub dans « ${targetPath} ».`,
      describeCommand: ({ targetPath }) => `git clone ${url} "${targetPath}"`,
      execute: async ({ targetPath }, context) => {
        if (!isAbsolute(targetPath))
          return fail(
            'definitive',
            `Chemin complet attendu (par exemple C:\\dev\\Jarvis), pas « ${targetPath} ».`,
          );
        if (existsSync(targetPath) && (await readdir(targetPath)).length > 0) {
          return fail(
            'definitive',
            `« ${targetPath} » existe déjà et n’est pas vide : rien n’a été écrasé.`,
          );
        }
        const free = await deps.freeBytes(targetPath);
        if (free !== null && free < MIN_FREE_BYTES) {
          return fail(
            'definitive',
            `Pas assez de place : ${formatBytes(free)} libres, il faut au moins ${formatBytes(MIN_FREE_BYTES)}.`,
          );
        }
        await mkdir(dirname(targetPath), { recursive: true });
        const outcome = await deps.run({
          program: 'git',
          args: ['-c', 'core.longpaths=true', 'clone', '--progress', url, targetPath],
          display: `git clone ${url} "${targetPath}"`,
          cwd: dirname(targetPath),
          timeoutMs: 20 * 60_000,
          signal: context.signal,
          onLine: (line) => context.onProgress?.(line),
        });
        if (outcome.cancelled) return fail('recoverable', 'Clonage annulé.');
        if (outcome.error)
          return fail('missing_dependency', `Git n’a pas pu démarrer : ${outcome.error}`);
        if (outcome.code !== 0)
          return fail('recoverable', `Le clonage a échoué :\n${tail(outcome.stderr)}`);
        return toolSuccess(`Code de Jarvis cloné dans « ${targetPath} ».`, { path: targetPath });
      },
    }),
    defineTool({
      name: 'dev_install_dependencies',
      description: 'Installe les dépendances de la copie de travail (npm ci). Toujours confirmé.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({}),
      summarize: () =>
        `Installer les dépendances de la copie de travail (npm ci, environ 1,1 Go, réseau).`,
      describeCommand: () =>
        `npm ${NPM_CI_ARGS.join(' ')}\n(dans ${deps.getRoot() ?? '?'}, avec ONNXRUNTIME_NODE_INSTALL=skip)`,
      execute: async (_input, context) => {
        const root = deps.getRoot();
        if (!root)
          return fail(
            'recoverable',
            'Aucune copie de travail validée : choisis-la dans Réglages → Développeur.',
          );
        const { nodePath, npmCli } = await deps.getNode();
        if (!nodePath || !npmCli)
          return fail(
            'missing_dependency',
            'Node.js et npm sont introuvables : installe Node.js LTS, puis relance la vérification.',
          );
        const outcome = await deps.run({
          program: nodePath,
          args: [npmCli, ...NPM_CI_ARGS],
          display: `npm ${NPM_CI_ARGS.join(' ')}`,
          cwd: root,
          env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: 'skip' },
          timeoutMs: 30 * 60_000,
          signal: context.signal,
          onLine: (line) => context.onProgress?.(line),
        });
        if (outcome.cancelled)
          return fail(
            'recoverable',
            'Installation annulée (le dossier node_modules peut être incomplet : relance-la).',
          );
        if (outcome.error)
          return fail('missing_dependency', `npm n’a pas pu démarrer : ${outcome.error}`);
        if (outcome.code !== 0)
          return fail(
            'recoverable',
            `npm ci a échoué :\n${tail(outcome.stderr || outcome.stdout)}`,
          );
        return toolSuccess(`Dépendances installées dans « ${root} ».\n${tail(outcome.stdout, 4)}`, {
          root,
        });
      },
    }),
  ];
}
