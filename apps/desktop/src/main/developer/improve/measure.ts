import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CODE_FILE_PATTERN,
  normalizeRepoRelative,
  protectedRepoPath,
  type CodeFileFact,
} from '@jarvis/core';
import { GIT_SAFE } from '../tools/common.js';
import type { Runner } from '../runner.js';

const MAX_FILES = 800;
const MAX_BYTES = 400_000;

/** Fichiers de code suivis par git dans la copie (lecture seule) : base des mesures de « Améliorer ». */
export async function gatherCodeFiles(run: Runner, root: string): Promise<CodeFileFact[]> {
  const listed = await run({
    program: 'git',
    args: [...GIT_SAFE, 'ls-files'],
    cwd: root,
    display: 'git ls-files',
    timeoutMs: 30_000,
    maxBytes: 4_000_000,
  });
  if (listed.code !== 0) return [];
  const paths = listed.stdout
    .split('\n')
    .map((p) => normalizeRepoRelative(p.trim()))
    .filter((p): p is string => Boolean(p) && CODE_FILE_PATTERN.test(p!) && !protectedRepoPath(p!))
    .sort()
    .slice(0, MAX_FILES);
  const out: CodeFileFact[] = [];
  for (const path of paths) {
    const full = join(root, path);
    try {
      if ((await stat(full)).size > MAX_BYTES) continue;
      out.push({ path, content: await readFile(full, 'utf8') });
    } catch {
      // fichier disparu depuis le dernier commit : ignoré
    }
  }
  return out;
}
