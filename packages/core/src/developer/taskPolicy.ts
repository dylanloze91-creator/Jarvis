import { coreFileReason } from './coreFiles.js';
import { normalizeRepoRelative, protectedRepoPath } from './repoPaths.js';
import {
  MAX_FIX_ATTEMPTS,
  maxTestSeriesFor,
  type PlanAction,
  type TaskPlan,
  type TestSuiteId,
} from './taskPlan.js';

export interface ReviewedPlanFile {
  path: string;
  action: PlanAction;
  reason: string;
  /** Fichier du cœur : redemandera toujours, même après la validation du plan. */
  core: string | null;
  exists: boolean;
  problem: string | null;
}

export interface ReviewedPlan extends Omit<TaskPlan, 'files'> {
  files: ReviewedPlanFile[];
}

/** Contrôle du plan par Jarvis : chemins, cœur, existence. Le modèle ne décide pas de ce qui est « cœur ». */
export function reviewPlan(
  plan: TaskPlan,
  exists: (path: string) => boolean,
  protectedReason: (path: string) => string | null = coreFileReason,
): ReviewedPlan {
  const seen = new Set<string>();
  const files: ReviewedPlanFile[] = [];
  for (const file of plan.files) {
    const rel = normalizeRepoRelative(file.path);
    const path = rel ?? file.path;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const blocked = rel ? protectedRepoPath(rel) : null;
    const present = rel ? exists(rel) : false;
    let problem: string | null = null;
    if (rel === null || rel === '') problem = 'chemin invalide (absolu ou avec « .. »)';
    else if (blocked) problem = blocked;
    else if (file.action === 'create' && present) problem = null;
    else if (file.action !== 'create' && !present) problem = 'fichier introuvable';
    files.push({
      path,
      action: file.action === 'create' && present ? 'edit' : file.action,
      reason: file.reason,
      core: rel ? protectedReason(rel) : 'chemin invalide',
      exists: present,
      problem,
    });
  }
  return { ...plan, files };
}

const SLUG_FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ';
const SLUG_TO = 'aaaaaaceeeeiiiinooooouuuuyyoa';

export function slugify(text: string, max = 40): string {
  const ascii = [...text.toLowerCase()]
    .map((c) => {
      const index = SLUG_FROM.indexOf(c);
      return index >= 0 ? SLUG_TO[index] : c;
    })
    .join('');
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return slug || 'tache';
}

/** `jarvis-dev/<date>-<sujet>` : la seule forme de branche sur laquelle Jarvis écrit. */
export function sandboxBranch(date: Date, subject: string): string {
  const day = date.toISOString().slice(0, 10);
  return `jarvis-dev/${day}-${slugify(subject)}`;
}

export interface PlanApproval {
  branch: string;
  /** Fichiers hors cœur, sans problème, validés pour création ou modification. */
  files: Set<string>;
  tests: TestSuiteId[];
  maxTestSeries: number;
}

export function approvalFromPlan(
  plan: ReviewedPlan,
  branch: string,
  maxFixAttempts: number = MAX_FIX_ATTEMPTS,
): PlanApproval {
  return {
    branch,
    files: new Set(
      plan.files
        .filter((file) => file.action !== 'delete' && !file.core && !file.problem)
        .map((file) => file.path.toLowerCase()),
    ),
    tests: plan.tests,
    maxTestSeries: maxTestSeriesFor(maxFixAttempts),
  };
}

export type CoverageRequest =
  | { kind: 'write'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'tests'; suite: string; series: number }
  | { kind: 'branch'; branch: string }
  | { kind: 'rollback' }
  | { kind: 'discard' }
  | { kind: 'install' }
  | { kind: 'other'; toolName: string };

export interface Coverage {
  covered: boolean;
  reason: string;
}

/**
 * Décision 9 : une validation du plan couvre les fichiers hors cœur listés
 * dans le plan et les tests de la liste fixe ; tout le reste redemande.
 */
export function planCoverage(
  approval: PlanApproval | null,
  request: CoverageRequest,
  protectedReason: (path: string) => string | null = coreFileReason,
): Coverage {
  if (!approval) return { covered: false, reason: 'aucun plan validé' };
  switch (request.kind) {
    case 'write': {
      const rel = normalizeRepoRelative(request.path);
      if (!rel) return { covered: false, reason: 'chemin invalide' };
      const core = protectedReason(rel);
      if (core) return { covered: false, reason: `fichier du cœur (${core}) : toujours confirmé` };
      return approval.files.has(rel.toLowerCase())
        ? { covered: true, reason: 'validé par le plan' }
        : { covered: false, reason: 'fichier hors du plan validé' };
    }
    case 'tests':
      if (!(approval.tests as string[]).includes(request.suite))
        return { covered: false, reason: `tests « ${request.suite} » absents du plan` };
      return request.series <= approval.maxTestSeries
        ? { covered: true, reason: 'validé par le plan (liste fixe)' }
        : { covered: false, reason: `plus de ${approval.maxTestSeries} séries de tests` };
    case 'branch':
      return request.branch === approval.branch
        ? { covered: true, reason: 'validé par le plan (branche de la tâche)' }
        : { covered: false, reason: 'branche différente de celle du plan' };
    case 'delete':
      return { covered: false, reason: 'suppression : toujours confirmée' };
    case 'rollback':
      return { covered: false, reason: 'retour arrière : toujours confirmé' };
    case 'discard':
      return { covered: false, reason: 'jeter la tâche : toujours confirmé' };
    case 'install':
      return {
        covered: false,
        reason: 'téléchargement des dépendances (réseau) : toujours confirmé',
      };
    default:
      return { covered: false, reason: `${request.toolName} : toujours confirmé` };
  }
}
