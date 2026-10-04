import { join } from 'node:path';
import { z } from 'zod';
import {
  JARVIS_PROJECT_PROFILE,
  ToolManager,
  TEST_SUITE_IDS,
  defineTool,
  suiteCommandFor,
  toolSuccess,
  type ProjectProfile,
  type RegisteredTool,
  type TestSuiteId,
} from '@jarvis/core';
import type { Runner } from '../runner.js';
import {
  SANDBOX_BRANCH_PATTERN,
  createSandbox,
  discardCommands,
  discardWorktree,
  samePath,
  type Sandbox,
  type SandboxSummary,
} from '../task/sandbox.js';
import {
  SANDBOX_NPM_CI_ARGS,
  dotnetSuite,
  installDotnetSandbox,
  installSandbox,
  runDotnetSuite,
  runSuite,
  type NodeTools,
} from '../task/suites.js';
import { fail } from './common.js';
import { createFileTools } from './fileTools.js';
import { createReadTools } from './readTools.js';

export interface TaskToolDeps {
  run: Runner;
  logsDir: () => string;
  sandbox: () => Sandbox | null;
  setSandbox: (sandbox: Sandbox | null) => void;
  repoRoot: () => string | null;
  worktreeRoot: () => string | null;
  node: () => Promise<NodeTools | null>;
  freeBytes: (path: string) => Promise<number | null>;
  listSandboxes: () => Promise<SandboxSummary[]>;
  /** Profil du projet de la tâche (0.5.4 : npm ou dotnet) ; absent = Jarvis. */
  profile?: () => ProjectProfile;
}

/** Outils montrés au modèle pendant une tâche : lecture et écriture dans la copie isolée. */
export const TASK_MODEL_TOOLS = [
  'dev_read_file',
  'dev_search_code',
  'dev_search_files',
  'dev_create_file',
  'dev_edit_file',
  'dev_delete_file',
] as const;

/** Projets autres que Jarvis (5.0.1) : en plus, réécrire un fichier en entier. */
export const PROJECT_MODEL_TOOLS = [...TASK_MODEL_TOOLS, 'dev_write_file'] as const;

const suiteSchema = z.enum(TEST_SUITE_IDS as [TestSuiteId, ...TestSuiteId[]]);

function sandboxTools(deps: TaskToolDeps): RegisteredTool[] {
  const profile = (): ProjectProfile => deps.profile?.() ?? JARVIS_PROJECT_PROFILE;
  return [
    defineTool({
      name: 'dev_create_branch',
      description:
        'Crée la copie isolée de la tâche : un worktree git sur une branche jarvis-dev/*.',
      risk: 'confirm',
      schema: z.object({
        branch: z.string().regex(SANDBOX_BRANCH_PATTERN),
        folder: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
      }),
      summarize: ({ branch }) => `Créer la copie isolée sur la branche ${branch}.`,
      describeCommand: ({ branch, folder }) =>
        `git worktree add -b ${branch} "${join(deps.worktreeRoot() ?? '?', folder)}" HEAD`,
      execute: async ({ branch, folder }, context) => {
        const repoRoot = deps.repoRoot();
        const root = deps.worktreeRoot();
        if (!repoRoot || !root) return fail('recoverable', 'Copie de travail non vérifiée.');
        const sandbox = await createSandbox(
          { run: deps.run, repoRoot, root, freeBytes: deps.freeBytes, signal: context.signal },
          branch,
          folder,
        );
        deps.setSandbox(sandbox);
        return toolSuccess(`Copie isolée créée : ${sandbox.path} (${branch}).`, {
          path: sandbox.path,
          base: sandbox.baseCommit,
        });
      },
    }),
    defineTool({
      name: 'dev_install_sandbox',
      description: 'Installe les dépendances de la copie isolée (npm ci --ignore-scripts, réseau).',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({}),
      summarize: () =>
        profile().install
          ? 'Installer les dépendances de la copie isolée (paquets NuGet, réseau).'
          : 'Installer les dépendances de la copie isolée (registre npm, environ 1,1 Go).',
      describeCommand: () => {
        const install = profile().install;
        return install
          ? `dotnet ${install.args.join(' ')}\n(dans ${deps.sandbox()?.path ?? '?'} ; paquets NuGet, réseau)`
          : `npm ${SANDBOX_NPM_CI_ARGS.join(' ')}\n(dans ${deps.sandbox()?.path ?? '?'} ; aucun script d’installation)`;
      },
      execute: async (_input, context) => {
        const sandbox = deps.sandbox();
        const install = profile().install;
        if (sandbox && install) {
          const restored = await installDotnetSandbox(deps.run, sandbox, install.args, {
            signal: context.signal,
            onLine: (line) => context.onProgress?.(line),
          });
          if (restored.cancelled) return fail('recoverable', 'Installation annulée.');
          if (restored.error)
            return fail('missing_dependency', `dotnet introuvable : ${restored.error}`);
          if (restored.code !== 0)
            return fail(
              'recoverable',
              `dotnet restore a échoué : ${(restored.stdout + restored.stderr).slice(-600)}`,
            );
          return toolSuccess('Dépendances NuGet de la copie isolée restaurées.');
        }
        const node = await deps.node();
        if (!sandbox) return fail('recoverable', 'Pas de copie isolée.');
        if (!node) return fail('missing_dependency', 'Node.js et npm sont introuvables.');
        const outcome = await installSandbox(deps.run, sandbox, node, {
          signal: context.signal,
          onLine: (line) => context.onProgress?.(line),
        });
        if (outcome.cancelled) return fail('recoverable', 'Installation annulée.');
        if (outcome.code !== 0)
          return fail(
            'recoverable',
            `npm ci a échoué : ${(outcome.error ?? outcome.stderr).slice(-600)}`,
          );
        return toolSuccess('Dépendances de la copie isolée installées.');
      },
    }),
    defineTool({
      name: 'dev_run_tests',
      description: 'Lance un test de la liste fixe dans la copie isolée.',
      risk: 'confirm',
      schema: z.object({ suite: suiteSchema }),
      summarize: ({ suite }) => `Lancer ${suiteCommandFor(profile(), suite)} dans la copie isolée.`,
      describeCommand: ({ suite }) =>
        `${suiteCommandFor(profile(), suite)}\n(dans ${deps.sandbox()?.path ?? '?'})`,
      execute: async ({ suite }, context) => {
        const sandbox = deps.sandbox();
        const dotnet = dotnetSuite(profile(), suite);
        if (sandbox && dotnet) {
          const summary = await runDotnetSuite(deps.run, sandbox, suite, dotnet, {
            signal: context.signal,
            onLine: (line) => context.onProgress?.(line),
          });
          return toolSuccess(`${summary.command} : ${summary.summary}`, summary);
        }
        const node = await deps.node();
        if (!sandbox) return fail('recoverable', 'Pas de copie isolée.');
        if (!node) return fail('missing_dependency', 'Node.js et npm sont introuvables.');
        const summary = await runSuite(deps.run, sandbox, node, suite, {
          signal: context.signal,
          onLine: (line) => context.onProgress?.(line),
        });
        return toolSuccess(`${summary.command} : ${summary.summary}`, summary);
      },
    }),
    defineTool({
      name: 'dev_rollback',
      description:
        'Revient à un point de reprise de la tâche (branche jarvis-dev/*). Toujours confirmé.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({ checkpoint: z.string().regex(/^[0-9a-f]{7,40}$/i) }),
      summarize: ({ checkpoint }) => `Revenir au point de reprise ${checkpoint.slice(0, 7)}.`,
      describeCommand: ({ checkpoint }) => {
        const sandbox = deps.sandbox();
        return sandbox
          ? `${sandbox.rollbackCommands(checkpoint).join('\n')}\n(dans ${sandbox.path}, branche ${sandbox.branch})`
          : `git reset --hard ${checkpoint.slice(0, 12)}`;
      },
      execute: async ({ checkpoint }, context) => {
        const sandbox = deps.sandbox();
        if (!sandbox) return fail('recoverable', 'Pas de copie isolée.');
        await sandbox.rollback(checkpoint, context.signal);
        return toolSuccess(`Copie isolée revenue au point de reprise ${checkpoint.slice(0, 7)}.`);
      },
    }),
    defineTool({
      name: 'dev_discard_sandbox',
      description: 'Jette une copie isolée jarvis-dev/* (dossier et branche). Toujours confirmé.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({
        path: z.string().min(3).max(500),
        branch: z.string().regex(SANDBOX_BRANCH_PATTERN),
      }),
      summarize: ({ branch }) => `Jeter la copie isolée ${branch} (dossier et branche).`,
      describeCommand: ({ path, branch }) =>
        `${discardCommands(path, branch).join('\n')}\n(dans ${path})`,
      execute: async ({ path, branch }, context) => {
        const known = (await deps.listSandboxes()).find(
          (item) => samePath(item.path, path) && item.branch === branch && !item.missing,
        );
        if (!known) return fail('definitive', 'Copie isolée inconnue : rien n’a été supprimé.');
        await discardWorktree(deps.run, known.path, branch, context.signal);
        const current = deps.sandbox();
        if (current && samePath(current.path, path)) deps.setSandbox(null);
        return toolSuccess(`Copie isolée ${branch} jetée.`);
      },
    }),
  ];
}

/**
 * Gestionnaire d'outils d'une tâche : une instance de développeur, jamais
 * passée au chat. Lecture et écriture enfermées dans la copie isolée.
 */
export function createTaskToolManager(deps: TaskToolDeps): ToolManager {
  return new ToolManager().registerAll([
    ...createReadTools({
      getRoot: () => deps.sandbox()?.path ?? null,
      run: deps.run,
      logsDir: deps.logsDir,
    }).filter((tool) => (TASK_MODEL_TOOLS as readonly string[]).includes(tool.name)),
    ...createFileTools({ sandbox: deps.sandbox }),
    ...sandboxTools(deps),
  ]);
}

export const TASK_TOOLS = [
  ...PROJECT_MODEL_TOOLS,
  'dev_create_branch',
  'dev_install_sandbox',
  'dev_run_tests',
  'dev_rollback',
  'dev_discard_sandbox',
] as const;
