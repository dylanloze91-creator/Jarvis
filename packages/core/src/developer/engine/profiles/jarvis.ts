import { AUTO_SCRIPTS, KNOWN_WORKSPACES } from '../../commandRulesNode.js';
import { coreFileReason } from '../../coreFiles.js';
import {
  JARVIS_REPO_URL,
  SUGGESTED_REPO_PATH,
  candidateRepoPaths,
  validateRepo,
} from '../../repoCheck.js';
import { DEFAULT_TEST_SUITES, MAX_FIX_ATTEMPTS, TEST_SUITES } from '../../taskPlan.js';
import { sandboxBranch } from '../../taskPolicy.js';
import type { ProjectProfile } from '../projectProfile.js';

export const JARVIS_PROMPT_CONTEXT = `Dépôt : Jarvis, monorepo TypeScript (npm workspaces).
- packages/core : logique sans Electron (agent, outils, fournisseurs, réglages Zod, développeur).
- apps/desktop : application Electron (main, preload, renderer React).
Tests : Vitest à côté des fichiers (*.test.ts). Code et messages en français.`;

export const JARVIS_CODE_SYSTEM_PROMPT = [
  'Tu es le modèle de code de Jarvis Développeur, un assistant qui travaille sur le code de l’application Jarvis (TypeScript, Electron, React).',
  'Réponds en français. N’invente aucun fichier ni aucune fonction : appuie-toi seulement sur ce qu’on te montre.',
].join(' ');

/**
 * Jarvis lui-même, premier projet du moteur. Valeurs figées sur 0.4.26 par
 * `jarvis.test.ts` : changer l'une d'elles change le comportement de Jarvis Développeur.
 */
export const JARVIS_PROJECT_PROFILE: ProjectProfile = {
  id: 'jarvis',
  label: 'Jarvis',
  toolchain: 'node',
  repoUrl: JARVIS_REPO_URL,
  suggestedPath: SUGGESTED_REPO_PATH,
  candidatePaths: candidateRepoPaths,
  validate: validateRepo,
  testSuites: TEST_SUITES,
  defaultTestSuites: DEFAULT_TEST_SUITES,
  maxFixAttempts: MAX_FIX_ATTEMPTS,
  protectedFileReason: coreFileReason,
  knownWorkspaces: KNOWN_WORKSPACES,
  autoScripts: AUTO_SCRIPTS,
  promptContext: JARVIS_PROMPT_CONTEXT,
  codeSystemPrompt: JARVIS_CODE_SYSTEM_PROMPT,
  sandboxBranchPrefix: 'jarvis-dev/',
  sandboxBranch,
};
