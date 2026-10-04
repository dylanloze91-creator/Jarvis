import { AUTO_SCRIPTS } from '../../commandRulesNode.js';
import { normalizeRepoRelative } from '../../repoPaths.js';
import type { CheckReport, DevCheck, RepoFacts } from '../../repoCheck.js';
import { MAX_FIX_ATTEMPTS, TEST_SUITES, type TestSuiteId } from '../../taskPlan.js';
import { sandboxBranch } from '../../taskPolicy.js';
import { WHOLE_FILE_HINT, type ProjectProfile, type ProjectTestSuite } from '../projectProfile.js';

/** Tests d'un projet Node : seulement les scripts npm automatiques présents dans son package.json. */
export const NODE_SUITES = ['typecheck', 'test', 'lint'] as const satisfies readonly TestSuiteId[];

const PROTECTED: ReadonlyArray<{ test: (path: string) => boolean; reason: string }> = [
  {
    test: (p) => /(^|\/)package(-lock)?\.json$/.test(p) || /(^|\/)\.npmrc$/.test(p),
    reason: 'dépendances et scripts npm',
  },
  {
    test: (p) =>
      /(^|\/)tsconfig[^/]*\.json$/.test(p) ||
      /(^|\/)(vitest|vite|eslint)\.config\.[cm]?[jt]s$/.test(p) ||
      p === 'eslint.config.js' ||
      p === '.gitignore' ||
      p.startsWith('.github/'),
    reason: 'configuration des vérifications et de la construction',
  },
];

/** Fichiers d'un projet Node qui redemandent toujours confirmation avec leur diff. */
export function nodeProtectedReason(path: string): string | null {
  const rel = normalizeRepoRelative(path);
  if (rel === null || rel === '') return 'chemin invalide';
  const lower = rel.toLowerCase().replace(/[.\s]+$/, '');
  for (const rule of PROTECTED) if (rule.test(lower)) return rule.reason;
  return null;
}

export function nodeSuites(scripts: Readonly<Record<string, string>>): TestSuiteId[] {
  return NODE_SUITES.filter((id) => typeof scripts[id] === 'string' && scripts[id]!.trim() !== '');
}

/** Copie d'un projet Node : un dépôt git avec un commit et un package.json. */
export function validateNodeFacts(facts: RepoFacts): CheckReport {
  const checks: DevCheck[] = [];
  const add = (id: string, label: string, status: DevCheck['status'], detail: string) =>
    checks.push({ id, label, status, detail });
  if (!facts.exists || !facts.isDirectory) {
    add('folder', 'Dossier', 'fail', `« ${facts.path} » n’existe pas.`);
    return { ok: false, checks };
  }
  add('folder', 'Dossier', 'ok', facts.path);
  add(
    'git',
    'Dépôt Git',
    facts.hasGit && facts.head ? 'ok' : 'fail',
    facts.hasGit
      ? facts.head
        ? `Branche ${facts.branch ?? '?'}, commit ${facts.head.slice(0, 7)}`
        : 'Aucun commit : enregistre un premier commit.'
      : 'Ce dossier n’est pas un dépôt Git.',
  );
  add(
    'package',
    'package.json',
    facts.rootPackageName !== undefined && facts.rootPackageName !== null ? 'ok' : 'fail',
    facts.rootPackageName ? `« ${facts.rootPackageName} »` : 'package.json introuvable.',
  );
  return { ok: checks.every((c) => c.status !== 'fail'), checks };
}

export interface NodeProjectInfo {
  id: string;
  name: string;
  description?: string;
  scripts: Readonly<Record<string, string>>;
  /** Fichiers de structure du gabarit (5.0.1), toujours confirmés. */
  structure?: readonly string[];
}

/** Profil d'un projet Node / TypeScript créé ou importé : ses scripts décident des tests. */
export function createNodeProfile(info: NodeProjectInfo): ProjectProfile {
  const suites = nodeSuites(info.scripts);
  const testSuites: Record<string, ProjectTestSuite> = Object.fromEntries(
    suites.map((id) => [id, TEST_SUITES[id]]),
  );
  const description = info.description?.trim() ? `\n${info.description.trim().slice(0, 300)}` : '';
  return {
    id: info.id,
    label: info.name,
    toolchain: 'node',
    repoUrl: null,
    suggestedPath: null,
    candidatePaths: () => [],
    validate: (facts) => validateNodeFacts(facts),
    testSuites,
    defaultTestSuites: suites.filter((id) => id !== 'lint'),
    maxFixAttempts: MAX_FIX_ATTEMPTS,
    protectedFileReason: (path) => {
      const rel = normalizeRepoRelative(path)?.toLowerCase();
      if (rel && info.structure?.some((s) => s.toLowerCase() === rel))
        return 'structure du gabarit (prête, à ne pas modifier)';
      return nodeProtectedReason(path);
    },
    knownWorkspaces: new Set(),
    autoScripts: AUTO_SCRIPTS,
    promptContext: `Dépôt : ${info.name}, projet Node.js / TypeScript (npm), indépendant de Jarvis.${description}
Scripts npm : ${Object.keys(info.scripts).slice(0, 12).join(', ') || 'aucun'}. Tests : ${suites.map((id) => `npm ${TEST_SUITES[id].npmArgs.join(' ')}`).join(', ') || 'aucun'}.
Code et messages en français.`,
    codeSystemPrompt: `Tu es le modèle de code de Jarvis Développeur, sur le projet « ${info.name} » (Node.js, TypeScript). Réponds en français. N’invente aucun fichier ni aucune fonction : appuie-toi seulement sur ce qu’on te montre.`,
    sandboxBranchPrefix: 'jarvis-dev/',
    sandboxBranch,

    editHints: WHOLE_FILE_HINT,
  };
}
