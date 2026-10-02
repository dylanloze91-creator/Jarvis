import { toolFailure, type ToolResult } from '@jarvis/core';
import type { Runner } from '../runner.js';
import { RepoJailError } from './jail.js';

export interface ReadToolDeps {
  /** Copie de travail validée, ou null si aucune. */
  getRoot: () => string | null;
  run: Runner;
  logsDir: () => string;
}

/** Git sans pager, sans fsmonitor, sans échappement des noms : rien d'autre que git ne se lance. */
export const GIT_SAFE = ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '--no-pager'];

export function fail(
  outcome: 'recoverable' | 'definitive' | 'missing_dependency',
  message: string,
): ToolResult {
  return toolFailure(outcome, message, message);
}

export async function guarded(
  getRoot: () => string | null,
  action: (root: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  const root = getRoot();
  if (!root)
    return fail(
      'recoverable',
      'Aucune copie de travail validée : choisis-la dans Réglages → Développeur.',
    );
  try {
    return await action(root);
  } catch (error) {
    if (error instanceof RepoJailError) return fail('definitive', error.message);
    return fail(
      'recoverable',
      `Lecture impossible : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
