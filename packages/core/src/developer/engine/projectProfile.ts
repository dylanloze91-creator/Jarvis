import type { CheckReport, RepoFacts } from '../repoCheck.js';

/** Outils de construction d'un projet : ils décident quelles règles de commandes s'appliquent. */
export type ProjectToolchain = 'node';

export interface ProjectTestSuite {
  label: string;
  /** Arguments passés à npm, sans shell : la liste est fixe. */
  npmArgs: readonly string[];
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
}
