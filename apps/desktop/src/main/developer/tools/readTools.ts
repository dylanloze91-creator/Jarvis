import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { defineTool, protectedRepoPath, toolSuccess, type RegisteredTool } from '@jarvis/core';
import { GIT_SAFE, fail, guarded, type ReadToolDeps } from './common.js';
import { createGitReadTools } from './gitTools.js';
import { resolveInRepo } from './jail.js';

function git(deps: ReadToolDeps, root: string, args: string[], display: string) {
  return deps.run({
    program: 'git',
    args: [...GIT_SAFE, ...args],
    cwd: root,
    timeoutMs: 20_000,
    display,
    maxBytes: 400_000,
  });
}

function clip(text: string, max: number): { text: string; clipped: boolean } {
  return text.length > max ? { text: text.slice(0, max), clipped: true } : { text, clipped: false };
}

export function createReadTools(deps: ReadToolDeps): RegisteredTool[] {
  return [
    defineTool({
      name: 'dev_read_file',
      description:
        'Lit un fichier de la copie de travail de Jarvis (chemin relatif). Jamais .git/, node_modules ni fichiers secrets.',
      risk: 'safe',
      schema: z.object({
        path: z.string().min(1).max(400),
        maxChars: z.number().int().min(200).max(100_000).default(20_000),
      }),
      execute: ({ path, maxChars }) =>
        guarded(deps.getRoot, async (root) => {
          const file = await resolveInRepo(root, path);
          const info = await stat(file.absolute);
          if (info.isDirectory()) return fail('definitive', `« ${file.relative} » est un dossier.`);
          if (info.size > 2_000_000)
            return fail('definitive', `« ${file.relative} » est trop gros (${info.size} octets).`);
          const raw = await readFile(file.absolute);
          if (raw.includes(0))
            return fail('definitive', `« ${file.relative} » est un fichier binaire.`);
          const text = raw.toString('utf8');
          const { text: shown, clipped } = clip(text, maxChars);
          const lines = text.split('\n').length;
          return toolSuccess(
            `Fichier ${file.relative} (${lines} lignes)${clipped ? `, tronqué à ${maxChars} caractères` : ''} :\n${shown}`,
            {
              path: file.relative,
              text: shown,
              lines,
              clipped,
            },
          );
        }),
    }),
    defineTool({
      name: 'dev_search_code',
      description:
        'Cherche un texte dans le code suivi par git (git grep). mode « count » : nombre de lignes par fichier.',
      risk: 'safe',
      schema: z.object({
        pattern: z.string().max(300).default(''),
        path: z.string().max(400).optional(),
        regex: z.boolean().default(false),
        ignoreCase: z.boolean().default(false),
        maxResults: z.number().int().min(1).max(2_000).default(200),
        mode: z.enum(['matches', 'count']).default('matches'),
      }),
      execute: ({ pattern, path, regex, ignoreCase, maxResults, mode }) =>
        guarded(deps.getRoot, async (root) => {
          const pathspec = path ? [(await resolveInRepo(root, path)).relative || '.'] : [];
          const args = [
            'grep',
            '-I',
            '--no-color',
            '--full-name',
            mode === 'count' ? '-c' : '-n',
            regex || mode === 'count' ? '-E' : '-F',
          ];
          if (ignoreCase) args.push('-i');
          args.push('-e', mode === 'count' && !pattern ? '' : pattern, '--', ...pathspec);
          if (mode === 'matches' && !pattern)
            return fail('definitive', 'Donne un texte à chercher.');
          const outcome = await git(deps, root, args, 'git grep');
          if (outcome.code !== 0 && outcome.code !== 1)
            return fail(
              'recoverable',
              `git grep a échoué : ${outcome.error ?? outcome.stderr.trim()}`,
            );
          const rows = outcome.stdout.split('\n').filter((line) => line.trim());
          if (mode === 'count') {
            const counts: Record<string, number> = {};
            for (const row of rows) {
              const index = row.lastIndexOf(':');
              const file = row.slice(0, index);
              if (!protectedRepoPath(file)) counts[file] = Number(row.slice(index + 1)) || 0;
            }
            return toolSuccess(`${Object.keys(counts).length} fichiers comptés.`, { counts });
          }
          const matches = rows
            .map((row) => {
              const match = /^(.*?):(\d+):(.*)$/.exec(row);
              return match
                ? { file: match[1]!, line: Number(match[2]), text: match[3]!.slice(0, 300) }
                : null;
            })
            .filter(
              (item): item is { file: string; line: number; text: string } =>
                item !== null && !protectedRepoPath(item.file),
            )
            .slice(0, maxResults);
          const content = matches.length
            ? matches.map((m) => `${m.file}:${m.line}: ${m.text.trim()}`).join('\n')
            : `Aucun résultat pour « ${pattern} ».`;
          return toolSuccess(content, { matches, total: rows.length });
        }),
    }),
    ...createGitReadTools(deps),
  ];
}
