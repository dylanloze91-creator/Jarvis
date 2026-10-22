/**
 * Cycle d’une compétence déjà stockée dans la fiche d’apprentissage.
 * La candidate vient d’une mission prouvée. Elle n’est validée que si
 * les cas indépendants mesurent un gain, sans abîmer les contrôles.
 * Elle n’exécute ni commande, ni code.
 */
import { sanitizeWebExtract, type LearningRecord } from './continuous.js';
import type { MethodKind } from './methods.js';
import {
  applySkill,
  applySkillTrial,
  rejectSkill,
  reviseSkill,
  selectSkill,
  settleSkill,
  skillFromObservation,
  type SkillQuery,
  type SkillRun,
} from './skills.js';

export type SkillScope = 'one-file' | 'category' | 'diagnosis' | 'tool-version';

export interface MissionSkillProof {
  id: string;
  now: number;
  ok: boolean;
  uncertain?: boolean;
  /** Vrai si l’après n’a pas été mesuré : la proposition du modèle ne suffit pas. */
  modelOnly?: boolean;
  language: string;
  request: string;
  constraints: string;
  attempts: readonly string[];
  errors: string;
  beforeSource: string;
  afterSource: string;
  testsRun: readonly string[];
  finalResult: string;
  originLabel: string;
  runtimeVersion?: string;
  tests?: string;
}

export interface SkillProposal {
  record: LearningRecord | null;
  scope: SkillScope | null;
  action: 'candidate' | 'refused' | 'one-file' | 'duplicate';
  reason: string;
}

export type SkillCaseRole = 'target' | 'control' | 'held-out' | 'tuning' | 'origin';

export interface SkillCase {
  id: string;
  category: string;
  role: SkillCaseRole;
  source: string;
  tests: string;
  language?: string;
  version?: string;
}

export interface SkillCaseRun {
  ok: boolean;
  log: string;
}

export interface SkillJudgeInput {
  cases: readonly SkillCase[];
  /** Lance les tests de CE cas. Le moteur ne connaît pas les valeurs attendues. */
  run: (input: { id: string; source: string; tests: string }) => SkillCaseRun | Promise<SkillCaseRun>;
  /** Nombre maximum de cas exécutés, dans l’ordre. Défaut 8, plafond 8. */
  cap?: number;
  now: number;
}

export interface SkillCategoryScore {
  withSkill: number;
  withoutSkill: number;
  total: number;
  regressions: number;
}

export interface SkillJudgeLog {
  id: string;
  role: SkillCaseRole;
  category: string;
  without: boolean;
  with: boolean;
  changed: boolean;
  attempts: number;
  skipped?: string;
}

export interface SkillJudgeReport {
  decision: 'validated' | 'candidate' | 'rejected';
  limitedEvidence: boolean;
  record: LearningRecord;
  byCategory: Record<string, SkillCategoryScore>;
  targets: { withPass: number; withoutPass: number; total: number };
  controls: { withPass: number; withoutPass: number; regressions: number; total: number };
  heldOut: { noted: number; usedToEdit: false };
  tuningIgnored: number;
  meanAttempts: number;
  logs: SkillJudgeLog[];
  reason: string;
}

export interface SkillLedgerCategory {
  stored: number;
  validated: number;
  rejected: number;
  used: number;
  successAfterUse: number;
  failureAfterUse: number;
}

export interface SkillLedger {
  created: number;
  validated: number;
  rejected: number;
  used: number;
  successAfterUse: number;
  failureAfterUse: number;
  byCategory: Record<string, SkillLedgerCategory>;
}

const PASSED = /pass|réussi|réussie|vert|contrôles passés/i;
const MIN_INDEPENDENT = 5;
const MAX_CAP = 8;

function scrub(text: string, before: string, after: string): string {
  let out = text;
  const left = before.trim();
  const right = after.trim();
  if (left.length > 8) out = out.split(left).join('[édition]');
  if (right.length > 8) out = out.split(right).join('[édition]');
  return out;
}

function gapsOf(proof: MissionSkillProof): string[] {
  const gaps: string[] = [];
  if (!proof.ok) gaps.push('mission non vérifiée');
  if (proof.uncertain) gaps.push('succès incertain');
  if (proof.modelOnly) gaps.push('solution seulement proposée par le modèle');
  if (!proof.request.trim()) gaps.push('problème initial absent');
  if (!proof.constraints.trim()) gaps.push('contraintes du projet absentes');
  if (!proof.attempts.some((item) => item.trim())) gaps.push('essais absents');
  if (!proof.errors.trim()) gaps.push('erreurs détectées absentes');
  if (!proof.beforeSource.trim() || !proof.afterSource.trim()) gaps.push('édition absente');
  if (!proof.testsRun.some((item) => item.trim())) gaps.push('tests trop minces');
  if (!proof.finalResult.trim() || !PASSED.test(proof.finalResult)) gaps.push('résultat final non vérifié');
  if (!proof.originLabel.trim()) gaps.push('origine absente');
  const web = sanitizeWebExtract(
    [proof.request, proof.constraints, proof.errors, proof.finalResult].join('\n'),
  );
  if (web.ignoredInstructions) gaps.push('consigne web non fiable écartée');
  return gaps;
}

function scopeOf(kind: MethodKind): Exclude<SkillScope, 'one-file'> {
  if (kind === 'keep-green') return 'diagnosis';
  if (kind === 'documented-export') return 'tool-version';
  return 'category';
}

function scopeLimit(scope: Exclude<SkillScope, 'one-file'>): string {
  if (scope === 'diagnosis') {
    return 'Portée : méthode de diagnostic. Elle ne réécrit pas un fichier déjà vert et ne devient pas une règle universelle.';
  }
  if (scope === 'tool-version') {
    return 'Portée : procédure d’outil ou de version. Une autre version n’est pas appliquée. Aucune page web n’est exécutée.';
  }
  return 'Portée : solution de catégorie. Un correctif d’un seul fichier ne devient pas une règle universelle.';
}

function refused(reason: string, scope: SkillScope | null = null): SkillProposal {
  return { record: null, scope, action: 'refused', reason };
}

/**
 * Une mission prouvée peut devenir une candidate.
 * Un échec, des tests minces, un succès incertain, ou une simple proposition du modèle : rien.
 * Un correctif qui ne forme pas une méthode connue reste une expérience d’un seul fichier.
 */
export function proposeSkillFromMission(
  proof: MissionSkillProof,
  existing: readonly LearningRecord[] = [],
): SkillProposal {
  const gaps = gapsOf(proof);
  if (gaps.length) return refused(gaps.join(' ; '));
  const before = proof.beforeSource.trim();
  const after = proof.afterSource.trim();
  const request = scrub(proof.request, before, after);
  const record = skillFromObservation({
    id: proof.id,
    now: proof.now,
    ok: true,
    language: proof.language,
    request,
    beforeSource: before,
    afterSource: after,
    tests: proof.tests ?? '',
    originLabel: proof.originLabel.trim(),
    ...(proof.runtimeVersion ? { runtimeVersion: proof.runtimeVersion } : {}),
  });
  if (!record?.skill || !record.method) {
    if (before !== after) {
      return {
        record: null,
        scope: 'one-file',
        action: 'one-file',
        reason: 'Correctif d’un seul fichier. Il reste une expérience, pas une compétence.',
      };
    }
    return refused('Aucun changement réutilisable.');
  }
  const scope = scopeOf(record.method.kind);
  const tools = record.skill.tools.filter((tool) => !/shell|exec|spawn|commande/i.test(tool));
  const evidence = [
    `problème: ${request}`,
    `contraintes: ${scrub(proof.constraints, before, after)}`,
    `essais: ${proof.attempts.length}`,
    `erreurs: ${scrub(proof.errors, before, after)}`,
    `tests: ${proof.testsRun.map((item) => item.trim()).filter(Boolean).join(', ')}`,
    `résultat: ${scrub(proof.finalResult, before, after)}`,
    `origine: ${proof.originLabel.trim()}`,
  ].map((line) => line.slice(0, 400));
  const skill = {
    ...record.skill,
    scope,
    tools,
    evidence,
    limits: [...record.skill.limits, scopeLimit(scope), 'N’exécute aucune commande et ne saute aucune confirmation.'].slice(0, 8),
  };
  const proposed: LearningRecord = {
    ...record,
    skill,
    trace: record.trace
      ? {
          ...record.trace,
          problem: request.slice(0, 400),
          context: proof.originLabel.trim().slice(0, 400),
          firstTry: scrub(proof.attempts.find((item) => item.trim()) ?? '', before, after).slice(0, 400),
          observedErrors: scrub(proof.errors, before, after).slice(0, 400),
          appliedFix: record.method.steps[0] ?? 'méthode',
          testsRun: proof.testsRun.map((item) => item.trim()).filter(Boolean).slice(0, 8),
          finalResult: scrub(proof.finalResult, before, after).slice(0, 400),
          limits: [...record.skill.limits, scopeLimit(scope)].join(' ').slice(0, 400),
          outcome: 'passed',
        }
      : record.trace,
  };
  const duplicate = existing.find(
    (item) =>
      item.status !== 'rejected' &&
      item.skill?.skillId === proposed.skill?.skillId &&
      item.skill?.version === proposed.skill?.version,
  );
  if (duplicate) {
    return {
      record: duplicate,
      scope,
      action: 'duplicate',
      reason: 'Même compétence et même version : pas une seconde fiche.',
    };
  }
  return {
    record: proposed,
    scope,
    action: 'candidate',
    reason: 'Candidate issue d’une mission vérifiée. Elle n’est pas encore validée.',
  };
}

function blankCategory(): SkillCategoryScore {
  return { withSkill: 0, withoutSkill: 0, total: 0, regressions: 0 };
}

function applyOne(record: LearningRecord, source: string, tests: string, item: SkillCase): SkillRun {
  const input: SkillQuery = {
    source,
    tests,
    validatedOnly: true,
    ...(item.language ? { language: item.language } : {}),
    ...(item.version ? { version: item.version } : {}),
  };
  const library = [record];
  if (record.status === 'candidate') return applySkillTrial(source, tests, library, input);
  return applySkill(source, tests, library, input);
}

/**
 * Compare les mêmes cas sans la compétence, puis avec elle.
 * Le jeu d’origine, les essais de réglage et le jeu tenu à l’écart ne modifient pas les étapes.
 * Moins de cinq cas indépendants : la candidate reste candidate.
 */
export async function judgeSkill(record: LearningRecord, input: SkillJudgeInput): Promise<SkillJudgeReport> {
  const steps = record.skill?.steps.slice() ?? [];
  const origin = record.skill?.sources[0] ?? '';
  const cap = Math.max(1, Math.min(input.cap ?? MAX_CAP, MAX_CAP));
  const seen = new Set<string>();
  const chosen: SkillCase[] = [];
  let heldNoted = 0;
  let tuningIgnored = 0;
  for (const item of input.cases) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.role === 'tuning') {
      tuningIgnored += 1;
      continue;
    }
    if (item.role === 'held-out') {
      heldNoted += 1;
      continue;
    }
    if (item.role === 'origin' || (origin && item.id === origin)) continue;
    if (chosen.length >= cap) continue;
    chosen.push(item);
  }
  const logs: SkillJudgeLog[] = [];
  const byCategory: Record<string, SkillCategoryScore> = {};
  let attemptSum = 0;
  let attemptCases = 0;
  for (const item of chosen) {
    const category = byCategory[item.category] ?? blankCategory();
    byCategory[item.category] = category;
    if (!item.tests.trim()) {
      logs.push({
        id: item.id,
        role: item.role,
        category: item.category,
        without: false,
        with: false,
        changed: false,
        attempts: 0,
        skipped: 'tests absents',
      });
      continue;
    }
    const withoutRun = await input.run({ id: item.id, source: item.source, tests: item.tests });
    if (item.role === 'target' && withoutRun.ok) {
      logs.push({
        id: item.id,
        role: item.role,
        category: item.category,
        without: true,
        with: true,
        changed: false,
        attempts: 1,
        skipped: 'cas déjà vert, écarté du jugement',
      });
      continue;
    }
    const applied = applyOne(record, item.source, item.tests, item);
    const nextSource = applied.used ? applied.source : item.source;
    const withRun = await input.run({ id: item.id, source: nextSource, tests: item.tests });
    const changed = nextSource !== item.source;
    logs.push({
      id: item.id,
      role: item.role,
      category: item.category,
      without: withoutRun.ok,
      with: withRun.ok,
      changed,
      attempts: 2,
    });
    if (item.role === 'held-out') continue;
    if (item.role !== 'target' && item.role !== 'control') continue;
    category.total += 1;
    if (withoutRun.ok) category.withoutSkill += 1;
    if (withRun.ok) category.withSkill += 1;
    if (item.role === 'control' && withoutRun.ok && !withRun.ok) category.regressions += 1;
    attemptSum += 2;
    attemptCases += 1;
  }
  const counted = logs.filter((row) => (row.role === 'target' || row.role === 'control') && !row.skipped);
  const targets = counted.filter((row) => row.role === 'target');
  const controls = counted.filter((row) => row.role === 'control');
  const targetWith = targets.filter((row) => row.with).length;
  const targetWithout = targets.filter((row) => row.without).length;
  const controlWith = controls.filter((row) => row.with).length;
  const controlWithout = controls.filter((row) => row.without).length;
  const regressions = controls.filter((row) => row.without && !row.with).length;
  const brokenEdit = targets.some((row) => row.changed && !row.with);
  const gain = targetWith > targetWithout;
  const limitedEvidence = targets.length + controls.length < MIN_INDEPENDENT;
  let decision: SkillJudgeReport['decision'] = 'candidate';
  let reason = 'Preuves insuffisantes : la candidate n’est pas validée.';
  if (!limitedEvidence && regressions > 0) {
    decision = 'rejected';
    reason = 'Un contrôle qui passait échoue avec la compétence.';
  } else if (!limitedEvidence && brokenEdit) {
    decision = 'candidate';
    reason = 'Une édition n’a pas passé les tests du cas. Pas de validation.';
  } else if (!limitedEvidence && !gain) {
    decision = 'rejected';
    reason = 'Aucun gain mesuré sur les cas concernés.';
  } else if (!limitedEvidence && gain && regressions === 0) {
    decision = 'validated';
    reason = 'Gain mesuré, tests des cas concernés verts, contrôles sans régression.';
  }
  let next = record;
  if (decision === 'validated') {
    for (const row of targets) {
      if (!row.with || row.without) continue;
      next = settleSkill(next, { ok: true, context: row.id, now: input.now, phase: 'validation' });
    }
    if (next.status !== 'validated') {
      decision = 'candidate';
      reason = 'Le gain n’a pas pu être rattaché à un autre contexte que l’origine.';
      next = record;
    }
  } else if (decision === 'rejected' && record.status === 'candidate') {
    next = rejectSkill(record, reason, input.now);
  }
  if (next.skill && steps.length && next.skill.steps.join('\n') !== steps.join('\n')) {
    return {
      decision: 'candidate',
      limitedEvidence: true,
      record,
      byCategory,
      targets: { withPass: targetWith, withoutPass: targetWithout, total: targets.length },
      controls: { withPass: controlWith, withoutPass: controlWithout, regressions, total: controls.length },
      heldOut: { noted: heldNoted, usedToEdit: false },
      tuningIgnored,
      meanAttempts: attemptCases ? attemptSum / attemptCases : 0,
      logs,
      reason: 'Les étapes ont bougé pendant le jugement : validation annulée.',
    };
  }
  return {
    decision,
    limitedEvidence,
    record: next,
    byCategory,
    targets: { withPass: targetWith, withoutPass: targetWithout, total: targets.length },
    controls: { withPass: controlWith, withoutPass: controlWithout, regressions, total: controls.length },
    heldOut: { noted: heldNoted, usedToEdit: false },
    tuningIgnored,
    meanAttempts: attemptCases ? attemptSum / attemptCases : 0,
    logs,
    reason,
  };
}

/** Une compétence validée, ou aucune. Le reste de la bibliothèque n’est pas renvoyé. */
export function reuseSkill(
  records: readonly LearningRecord[],
  input: SkillQuery & { source: string; tests: string },
): { selected: LearningRecord | null; run: SkillRun } {
  const selected = selectSkill(records, { ...input, validatedOnly: true });
  if (!selected) {
    return {
      selected: null,
      run: { source: input.source, changed: false, selectedId: null, selectedName: null, used: false },
    };
  }
  return { selected, run: applySkill(input.source, input.tests, [selected], { ...input, validatedOnly: true }) };
}

/**
 * Effet réel après usage. Un échec déjà noté pour le même contexte n’est pas rejoué.
 * Une compétence validée n’est pas réécrite.
 */
export function noteSkillUse(
  record: LearningRecord,
  input: { ok: boolean; context: string; cause?: string; now: number },
): { record: LearningRecord; skippedBlind: boolean } {
  if (!record.skill || record.status !== 'validated') return { record, skippedBlind: false };
  const steps = record.skill.steps.slice();
  const context = input.context.trim().slice(0, 180) || 'contexte';
  const cause = (input.cause ?? 'échec après usage').trim().slice(0, 300);
  if (!input.ok) {
    const seen = record.skill.results.some(
      (result) => result.phase === 'use' && !result.ok && result.context === context && result.detail === cause,
    );
    if (seen) return { record, skippedBlind: true };
  }
  const next = settleSkill(record, {
    ok: input.ok,
    context,
    now: input.now,
    phase: 'use',
    ...(!input.ok ? { cause } : {}),
  });
  if (next.skill && next.skill.steps.join('\n') !== steps.join('\n')) return { record, skippedBlind: false };
  return { record: next, skippedBlind: false };
}

/** Nouvelle version seulement après un échec d’usage. L’ancienne fiche validée reste telle quelle. */
export function proposeSkillRevision(
  record: LearningRecord,
  content: string,
  now: number,
  id: string,
): { kept: LearningRecord; created: LearningRecord | null; reason: string } {
  const failures = record.skill?.results.filter((result) => result.phase === 'use' && !result.ok && !result.uncertain) ?? [];
  if (record.status !== 'validated' || !record.skill) {
    return { kept: record, created: null, reason: 'Seule une compétence validée peut avoir une version suivante.' };
  }
  if (!failures.length) {
    return { kept: record, created: null, reason: 'Pas d’échec constaté : pas de nouvelle version.' };
  }
  const text = content.trim();
  if (text.length < 12) {
    return { kept: record, created: null, reason: 'La preuve ne justifie pas une nouvelle version.' };
  }
  const revised = reviseSkill(record, text, now, id);
  return {
    kept: revised.kept,
    created: revised.created,
    reason: revised.created
      ? 'Version candidate à part. La version validée reste en place.'
      : 'Pas de nouvelle version.',
  };
}

/**
 * La version précédente reste active si la nouvelle n’est pas validée,
 * si un contrôle régresse, ou si elle gagne moins de cas qu’avant.
 */
export function keepOrRollBack(
  previous: LearningRecord,
  revision: LearningRecord | null,
  judgment: SkillJudgeReport | null,
  previousTargetsPassed: number,
): { active: LearningRecord; rolledBack: boolean; reason: string } {
  if (!revision || !judgment) {
    return { active: previous, rolledBack: true, reason: 'Pas de nouvelle version à comparer.' };
  }
  const worse =
    judgment.decision !== 'validated' ||
    judgment.controls.regressions > 0 ||
    judgment.targets.withPass < previousTargetsPassed;
  if (worse) {
    return {
      active: previous,
      rolledBack: true,
      reason: 'La nouvelle version régresse ou n’est pas validée. La version précédente reste.',
    };
  }
  return {
    active: judgment.record,
    rolledBack: false,
    reason: 'La nouvelle version est validée, sans perte sur les cas déjà gagnés.',
  };
}

function blankLedger(): SkillLedgerCategory {
  return { stored: 0, validated: 0, rejected: 0, used: 0, successAfterUse: 0, failureAfterUse: 0 };
}

/** Compte les fiches. Le nombre stocké n’est pas un gain de qualité. */
export function skillLedger(records: readonly LearningRecord[]): SkillLedger {
  const ledger: SkillLedger = {
    created: 0,
    validated: 0,
    rejected: 0,
    used: 0,
    successAfterUse: 0,
    failureAfterUse: 0,
    byCategory: {},
  };
  for (const record of records) {
    if (!record.skill) continue;
    ledger.created += 1;
    const key = record.method?.kind ?? record.skill.scope ?? 'autre';
    const row = ledger.byCategory[key] ?? blankLedger();
    ledger.byCategory[key] = row;
    row.stored += 1;
    if (record.status === 'validated') {
      ledger.validated += 1;
      row.validated += 1;
    }
    if (record.status === 'rejected') {
      ledger.rejected += 1;
      row.rejected += 1;
    }
    for (const result of record.skill.results) {
      if (result.phase !== 'use') continue;
      ledger.used += 1;
      row.used += 1;
      if (result.ok) {
        ledger.successAfterUse += 1;
        row.successAfterUse += 1;
      } else {
        ledger.failureAfterUse += 1;
        row.failureAfterUse += 1;
      }
    }
  }
  return ledger;
}
