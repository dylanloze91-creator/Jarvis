import { ToolManager } from '@jarvis/core';
import type { ReadToolDeps } from './common.js';
import { createModelTools, type ModelToolDeps } from './modelTools.js';
import { createReadTools } from './readTools.js';
import { createSetupTools, type SetupToolDeps } from './setupTools.js';

export type DeveloperToolDeps = ReadToolDeps & SetupToolDeps & { models?: ModelToolDeps };

/** Lecture seule (`safe`) dans la copie de travail. */
export const DEVELOPER_READ_TOOLS = [
  'dev_read_file',
  'dev_search_code',
  'dev_search_files',
  'dev_git_status',
  'dev_git_diff',
  'dev_inspect_logs',
] as const;
/** Préparation, toujours confirmée. */
export const DEVELOPER_SETUP_TOOLS = ['dev_clone_repository', 'dev_install_dependencies'] as const;
/** Modèle de code : téléchargement toujours confirmé, après validation. */
export const DEVELOPER_MODEL_TOOLS = ['dev_pull_model'] as const;

/**
 * Gestionnaire d'outils de Jarvis Développeur : une instance à part, jamais
 * passée au chat. Même classe que celle du chat (validation, confirmations,
 * rédaction des secrets, issues typées).
 */
export function createDeveloperToolManager(deps: DeveloperToolDeps): ToolManager {
  return new ToolManager().registerAll([
    ...createReadTools(deps),
    ...createSetupTools(deps),
    ...(deps.models ? createModelTools(deps.models) : []),
  ]);
}
