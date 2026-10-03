import type { CheckReport, RepoFacts } from '../repoCheck.js';

/** Outils de construction d'un projet : ils décident quelles règles de commandes s'appliquent. */
export type ProjectToolchain = 'node' | 'dotnet';

export interface ProjectTestSuite {
  label: string;
  /** Arguments passés à npm, sans shell : la liste est fixe. */
  npmArgs: readonly string[];
  /** Autre programme que npm (0.5.4) : `dotnet` et ses arguments fixes ; `npmArgs` est alors ignoré. */
  program?: 'dotnet';
  args?: readonly string[];
}

/**
 * Ce que Jarvis Développeur sait d'un type de projet : comment reconnaître
 * une copie valide, quels tests lancer, quels fichiers redemandent toujours
 * confirmation, et le contexte donné au modèle de code.
 */
export interface ProjectProfile {
  id: string;
  label: string;
  toolchain: ProjectToolchain;
  repoUrl: string | null;
  suggestedPath: string | null;
  candidatePaths(env: { platform: string; home: string }): string[];
  validate(facts: RepoFacts, installedVersion: string, oneDriveRoots?: string[]): CheckReport;
  testSuites: Readonly<Record<string, ProjectTestSuite>>;
  defaultTestSuites: readonly string[];
  /** Corrections après un échec de tests quand le réglage est absent. */
  maxFixAttempts: number;
  /** Raison si le fichier redemande toujours confirmation avec son diff, sinon null. */
  protectedFileReason(path: string): string | null;
  /** Espaces de travail npm acceptés dans une commande de test automatique. */
  knownWorkspaces: ReadonlySet<string>;
  /** Scripts npm automatiques dans la copie isolée seulement. */
  autoScripts: ReadonlySet<string>;
  /** Description du dépôt dans les consignes de plan, de modification et de correction. */
  promptContext: string;
  /** Consigne système du fournisseur de code. */
  codeSystemPrompt: string;
  /** Seules branches sur lesquelles Jarvis écrit. */
  sandboxBranchPrefix: string;
  sandboxBranch(date: Date, subject: string): string;
  /** Dépendances de la copie isolée (0.5.4) ; absent : `npm ci --ignore-scripts`. */
  install?: { program: 'dotnet'; args: readonly string[] };
}

/** Commande affichée et classée d'un test du profil. */
export function profileSuiteCommand(suite: ProjectTestSuite): string {
  return suite.program === 'dotnet'
    ? `dotnet ${(suite.args ?? []).join(' ')}`
    : `npm ${suite.npmArgs.join(' ')}`;
}
