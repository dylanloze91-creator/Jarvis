import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { defineTool, protectedRepoPath, toolSuccess, type RegisteredTool } from '@jarvis/core';
import { GIT_SAFE, fail, guarded as guardedRoot, type ReadToolDeps } from './common.js';
import { resolveInRepo } from './jail.js';

const guarded = (deps: ReadToolDeps, action: Parameters<typeof guardedRoot>[1]) =>
  guardedRoot(deps.getRoot, action);

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '\uE000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\uE000/g, '(.*/)?');
  return new RegExp(`^${escaped}$`, 'i');
}

export function createGitReadTools(deps: ReadToolDeps): RegisteredTool[] {
  const git = (root: string, args: string[], display: string) =>
    deps.run({
      program: 'git',
      args: [...GIT_SAFE, ...args],
      cwd: root,
      timeoutMs: 20_000,
      display,
      maxBytes: 2_000_000,
    });
  return [
    defineTool({
      name: 'dev_search_files',
      description:
        'Liste les fichiers suivis par git, filtrés par un morceau de nom ou un motif (« **/*.test.ts »).',
      risk: 'safe',
      schema: z.object({
        query: z.string().max(200).default(''),
        glob: z.string().max(200).optional(),
        maxResults: z.number().int().min(1).max(10_000).default(300),
      }),
      execute: ({ query, glob, maxResults }) =>
        guarded(deps, async (root) => {
          const outcome = await git(root, ['ls-files', '-z'], 'git ls-files');
          if (outcome.code !== 0)
            return fail(
              'recoverable',
              `git ls-files a échoué : ${outcome.error ?? outcome.stderr.trim()}`,
            );
          const pattern = glob ? globToRegExp(glob) : null;
          const needle = query.toLowerCase();
          const all = outcome.stdout.split('\0').filter((file) => file && !protectedRepoPath(file));
          const files = all.filter(
            (file) =>
              (!pattern || pattern.test(file)) && (!needle || file.toLowerCase().includes(needle)),
          );
          const shown = files.slice(0, maxResults);
          return toolSuccess(
            `${files.length} fichier(s)${files.length > shown.length ? ` (${shown.length} affichés)` : ''} :\n${shown.join('\n')}`,
            { files: shown, total: files.length },
          );
        }),
    }),
    defineTool({
      name: 'dev_git_status',
      description: 'Branche courante et fichiers modifiés de la copie de travail (git status).',
      risk: 'safe',
      schema: z.object({}),
      execute: () =>
        guarded(deps, async (root) => {
          const outcome = await git(root, ['status', '--porcelain=v1', '-b'], 'git status');
          if (outcome.code !== 0)
            return fail(
              'recoverable',
              `git status a échoué : ${outcome.error ?? outcome.stderr.trim()}`,
            );
          const [head = '', ...rows] = outcome.stdout.split('\n').filter((line) => line.trim());
          const branch = head.replace(/^## /, '').split('...')[0] ?? null;
          const files = rows.map((row) => ({ status: row.slice(0, 2).trim(), path: row.slice(3) }));
          const head2 = await git(root, ['log', '-1', '--format=%H%x09%s'], 'git log');
          const [commit = null, subject = null] =
            head2.code === 0 ? head2.stdout.trim().split('\t') : [];
          return toolSuccess(
            `Branche ${branch}${commit ? `, dernier commit ${commit.slice(0, 7)} « ${subject} »` : ''}. ${files.length ? `${files.length} fichier(s) modifié(s) :\n${files.map((f) => `${f.status} ${f.path}`).join('\n')}` : 'Aucune modification.'}`,
            {
              branch,
              commit,
              subject,
              files,
            },
          );
        }),
    }),
    defineTool({
      name: 'dev_git_diff',
      description:
        'Différences non enregistrées de la copie de travail (git diff), ou seulement leur résumé.',
      risk: 'safe',
      schema: z.object({
        path: z.string().max(400).optional(),
        staged: z.boolean().default(false),
        stat: z.boolean().default(false),
        maxChars: z.number().int().min(500).max(100_000).default(20_000),
      }),
      execute: ({ path, staged, stat, maxChars }) =>
        guarded(deps, async (root) => {
          const pathspec = path ? ['--', (await resolveInRepo(root, path)).relative || '.'] : [];
          const args = [
            'diff',
            '--no-ext-diff',
            '--no-textconv',
            '--no-color',
            ...(staged ? ['--cached'] : []),
            ...(stat ? ['--stat'] : []),
            ...pathspec,
          ];
          const outcome = await git(root, args, 'git diff');
          if (outcome.code !== 0)
            return fail(
              'recoverable',
              `git diff a échoué : ${outcome.error ?? outcome.stderr.trim()}`,
            );
          const text =
            outcome.stdout.length > maxChars
              ? `${outcome.stdout.slice(0, maxChars)}\n… (tronqué)`
              : outcome.stdout;
          return toolSuccess(text.trim() || 'Aucune différence.', { diff: text });
        }),
    }),
    defineTool({
      name: 'dev_inspect_logs',
      description:
        'Liste les journaux de Jarvis (dossier logs) ou lit la fin de l’un d’eux. Les secrets sont masqués.',
      risk: 'safe',
      schema: z.object({
        name: z.string().max(120).optional(),
        maxChars: z.number().int().min(500).max(50_000).default(12_000),
      }),
      execute: async ({ name, maxChars }) => {
        let files: string[] = [];
        try {
          files = (await readdir(deps.logsDir()))
            .filter((file) => /\.(log|txt)$/i.test(file))
            .sort();
        } catch {
          return toolSuccess('Aucun journal pour le moment.', { files: [] });
        }
        if (!name)
          return toolSuccess(
            files.length ? `Journaux : ${files.join(', ')}` : 'Aucun journal pour le moment.',
            { files },
          );
        if (!files.includes(name))
          return fail(
            'definitive',
            `Journal inconnu « ${name} ». Journaux disponibles : ${files.join(', ') || 'aucun'}.`,
          );
        const text = await readFile(join(deps.logsDir(), name), 'utf8');
        return toolSuccess(`Fin de ${name} :\n${text.slice(-maxChars)}`, { files, name });
      },
    }),
  ];
}
