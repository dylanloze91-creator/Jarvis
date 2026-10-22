/**
 * Preuve de mission. Le statut vient des contrôles observés, pas de la dernière phrase du modèle.
 * Une candidate de jeu reste à l’écart de l’export tant qu’elle n’est pas validée.
 */
import { redactSecrets } from '../security/redact.js';
import { buildFinetuneDataset, type DatasetBuild, type DatasetCategory, type DatasetSource } from '../learning/dataset.js';
import { proposeSkillFromMission } from '../learning/skillProof.js';

export const EVIDENCE_STATUSES = [
  'success_verified',
  'success_partial',
  'failed',
  'blocked',
  'unverified',
  'cancelled',
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  success_verified: 'Succès vérifié',
  success_partial: 'Succès partiel',
  failed: 'Échec',
  blocked: 'Bloqué',
  unverified: 'Non vérifié',
  cancelled: 'Annulé',
};

export type EvidenceCheckKind = 'test' | 'typecheck' | 'lint' | 'build' | 'criterion' | 'command';

export interface EvidenceCheck {
  name: string;
  kind: EvidenceCheckKind;
  required: boolean;
  ran: boolean;
  passed: boolean | null;
  exitCode: number | null;
  testsRan: number | null;
  reason?: string;
  /** Empreinte du code au moment du contrôle. */
  codeVersion?: string;
}

export interface EvidenceCommand {
  command: string;
  /** null : aucun résultat réel. On ne dit pas que la commande a tourné. */
  exitCode: number | null;
  excerpt?: string;
}

export interface EvidenceDraft {
  id: string;
  at: number;
  goal: string;
  passCriteria: string[];
  kind: 'programming' | 'non-code';
  cancelled?: boolean;
  declaredSuccess?: boolean;
  initialState?: string;
  filesCreated?: string[];
  filesChanged?: string[];
  filesDeleted?: string[];
  diff?: string;
  deliveredPaths?: string[];
  commands?: EvidenceCommand[];
  checks?: EvidenceCheck[];
  errors?: string[];
  fixes?: string[];
  finalResult?: string;
  toolVersion?: string;
  model?: string;
  skillsUsed?: string[];
  limits?: string[];
  language?: string;
  beforeSource?: string;
  afterSource?: string;
  audit?: string[];
  seenFingerprints?: readonly string[];
}

export interface DatasetStaging {
  validationStatus: 'candidate' | 'accepted' | 'rejected';
  origin: string;
  evidenceId: string;
  category: DatasetCategory;
  fingerprint: string;
  limits: string;
  reason: string;
  source?: DatasetSource;
}

export interface MissionEvidence {
  id: string;
  at: number;
  goal: string;
  passCriteria: string[];
  kind: 'programming' | 'non-code';
  initialState: string;
  filesCreated: string[];
  filesChanged: string[];
  filesDeleted: string[];
  diff: string;
  commands: EvidenceCommand[];
  checks: EvidenceCheck[];
  errors: string[];
  fixes: string[];
  finalResult: string;
  toolVersion: string;
  model: string;
  skillsUsed: string[];
  limits: string[];
  checksNotRun: string[];
  audit: string[];
  beforeSource?: string;
  afterSource?: string;
  language?: string;
  declaredSuccess: boolean;
  status: EvidenceStatus;
  statusReason: string;
  fingerprint: string;
  staging: DatasetStaging;
  skill: { action: 'candidate' | 'refused' | 'one-file' | 'duplicate' | 'none'; reason: string };
}

const LIMIT_NOTE = 'Un test qui passe ne couvre que ce qu’il affirme.';

function clean(text: string | undefined, max = 1_500): string {
  return redactSecrets(text ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]')
    .replace(/\b(mot de passe|password|passwd)\b(\s*[:=]\s*)(\S+)/gi, '$1$2[REDACTED]')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, max);
}

function fingerprintOf(goal: string, category: DatasetCategory): string {
  return hashText(`${category}\n${goal.toLowerCase()}`);
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function testsCounted(summary: string): number | null {
  const ok = /(\d+) tests réussis/.exec(summary);
  if (ok?.[1]) return Number(ok[1]);
  const on = /sur (\d+)/.exec(summary);
  if (on?.[1]) return Number(on[1]);
  const total = /Total:\s+(\d+)/.exec(summary);
  if (total?.[1]) return Number(total[1]);
  const passed = /Passed:\s+(\d+)/i.exec(summary);
  if (passed?.[1]) return Number(passed[1]);
  return null;
}

export function testsLookWeakened(diff: string, paths: readonly string[]): boolean {
  const testPath = (path: string) => /\.(test|spec)\./.test(path) || path.includes('__tests__');
  const onlyTests = paths.length > 0 && paths.every(testPath);
  const addedSkip = /^\+(?!\+).*\b(?:it|test|describe)\.skip\b|^\+(?!\+).*\bxit\b|^\+(?!\+).*\bxdescribe\b/m.test(diff);
  const removedAssert = /^-(?!-).*\b(?:expect|assert)\b/m.test(diff);
  return addedSkip || (onlyTests && removedAssert);
}

function codeHash(diff: string, paths: readonly string[]): string {
  return hashText(`${paths.join('\n')}\n${diff}`);
}

function categoryOf(draft: EvidenceDraft): DatasetCategory {
  if (draft.kind === 'non-code') {
    return /document/i.test(draft.goal) ? 'documentation' : 'analysis';
  }
  return 'programming-debugging';
}

function judge(draft: EvidenceDraft, checks: EvidenceCheck[]): { status: EvidenceStatus; reason: string } {
  if (draft.cancelled) return { status: 'cancelled', reason: 'Mission annulée avant un résultat.' };
  const required = checks.filter((check) => check.required);
  const paths = [...(draft.filesCreated ?? []), ...(draft.filesChanged ?? []), ...(draft.filesDeleted ?? [])];
  const delivered = draft.deliveredPaths ?? paths;
  const diff = clean(draft.diff, 80_000);
  if (draft.kind === 'programming' && testsLookWeakened(draft.diff ?? '', paths)) {
    return { status: 'failed', reason: 'Des tests ont été désactivés ou vidés pour passer. Ce n’est pas un succès.' };
  }
  const missing = required.filter((check) => !check.ran);
  const red = required.filter((check) => check.ran && (check.passed === false || (check.exitCode !== null && check.exitCode !== 0)));
  if (red.length) {
    const first = red[0]!;
    return { status: 'failed', reason: first.reason || `${first.name} a échoué (code ${first.exitCode ?? 'inconnu'}).` };
  }
  if (missing.length) {
    const first = missing[0]!;
    if (draft.declaredSuccess && required.every((check) => !check.ran)) {
      return { status: 'unverified', reason: 'Succès déclaré, mais aucun contrôle requis n’a été lancé.' };
    }
    return { status: 'blocked', reason: first.reason || `${first.name} n’a pas pu être lancé.` };
  }
  const noCode = required.filter((check) => check.ran && check.kind !== 'criterion' && check.exitCode === null);
  if (noCode.length) {
    return {
      status: 'unverified',
      reason: `Pas de code de sortie pour ${noCode[0]!.name}. On ne dit pas que la commande a tourné.`,
    };
  }
  if (draft.declaredSuccess && required.length === 0 && (draft.commands ?? []).every((command) => command.exitCode === null)) {
    return { status: 'unverified', reason: 'Succès déclaré sans preuve d’exécution.' };
  }
  if (required.length === 0) {
    return { status: 'failed', reason: 'Aucun critère requis n’a été observé.' };
  }
  if (draft.kind === 'programming') {
    const tests = required.filter((check) => check.kind === 'test');
    const uncounted = tests.filter((check) => check.testsRan === null || check.testsRan < 1);
    if (uncounted.length) {
      return { status: 'blocked', reason: `${uncounted[0]!.name} : la sortie ne dit pas combien de tests ont tourné.` };
    }
    const version = codeHash(diff, delivered);
    const stale = tests.filter((check) => check.codeVersion && check.codeVersion !== version);
    if (stale.length) {
      return { status: 'unverified', reason: 'Les résultats ne correspondent pas à cette version du code.' };
    }
    const diffPaths = new Set(delivered);
    const listed = new Set(paths);
    const mismatch =
      delivered.some((path) => !diff.includes(path)) ||
      [...listed].some((path) => !diffPaths.has(path)) ||
      [...diffPaths].some((path) => !listed.has(path));
    if (mismatch) return { status: 'unverified', reason: 'Le diff ne correspond pas aux fichiers livrés.' };
  }
  const optionalRed = checks.filter((check) => !check.required && check.ran && check.passed === false);
  if (optionalRed.length) {
    return { status: 'success_partial', reason: `Contrôles requis au vert. ${optionalRed[0]!.name} a échoué et n’était pas exigé.` };
  }
  return { status: 'success_verified', reason: 'Les contrôles requis ont tourné et sont au vert.' };
}

function stagingFor(evidence: Omit<MissionEvidence, 'staging' | 'skill'>, seen: readonly string[]): DatasetStaging {
  const category: DatasetCategory =
    evidence.kind === 'non-code'
      ? /document/i.test(evidence.goal)
        ? 'documentation'
        : 'analysis'
      : 'programming-debugging';
  const base = {
    origin: `preuve:${evidence.id}`,
    evidenceId: evidence.id,
    category,
    fingerprint: evidence.fingerprint,
    limits: evidence.limits.join(' '),
  };
  if (seen.includes(evidence.fingerprint)) {
    return { ...base, validationStatus: 'rejected', reason: 'doublon : la même preuve est déjà en attente' };
  }
  if (evidence.status === 'failed' || evidence.status === 'blocked') {
    return { ...base, validationStatus: 'rejected', reason: 'échec conservé pour l’analyse, pas comme réponse' };
  }
  if (evidence.status !== 'success_verified') {
    return { ...base, validationStatus: 'rejected', reason: evidence.statusReason };
  }
  const tests = evidence.checks.filter((check) => check.required && check.ran && check.passed);
  const files = [...evidence.filesCreated, ...evidence.filesChanged, ...evidence.filesDeleted];
  if (evidence.kind === 'programming' && files.length < 2) {
    return { ...base, validationStatus: 'rejected', reason: 'un succès isolé sur un seul fichier ne devient pas une règle' };
  }
  const source: DatasetSource = {
    id: evidence.id,
    kind: 'finished-mission',
    origin: base.origin,
    group: evidence.fingerprint,
    category,
    fields: ['goal', 'checks', 'diff', 'commands', 'finalResult'],
    declaredSuccess: true,
    verified: true,
    testsRun: tests.map((check) => check.name),
    testsPassed: true,
    projectsVerified: 1,
    context: evidence.initialState || evidence.goal,
    task: evidence.goal,
    method: evidence.fixes.join(' ') || evidence.finalResult,
    constraints: evidence.passCriteria.join(' '),
    answer: evidence.finalResult,
    limits: base.limits,
    testResult: tests.map((check) => `${check.name}: ${check.testsRan ?? 'ok'}`).join(', ') || 'contrôles requis au vert',
    oneFile: files.length < 2,
  };
  return {
    ...base,
    validationStatus: 'candidate',
    reason: 'Candidate en attente. Elle n’entre pas dans le jeu tant qu’elle n’est pas validée.',
    source,
  };
}

function skillFor(draft: EvidenceDraft, status: EvidenceStatus): MissionEvidence['skill'] {
  if (status !== 'success_verified' || draft.kind !== 'programming') {
    return { action: 'none', reason: 'Preuve trop mince pour proposer une compétence.' };
  }
  if (!draft.beforeSource?.trim() || !draft.afterSource?.trim()) {
    return { action: 'none', reason: 'Preuve trop mince : le fichier d’avant et celui d’après manquent.' };
  }
  const proposal = proposeSkillFromMission({
    id: draft.id,
    now: draft.at,
    ok: true,
    language: draft.language || 'unknown',
    request: draft.goal,
    constraints: draft.passCriteria.join('\n'),
    attempts: draft.fixes ?? [],
    errors: (draft.errors ?? []).join('\n'),
    beforeSource: draft.beforeSource,
    afterSource: draft.afterSource,
    testsRun: (draft.checks ?? []).filter((check) => check.ran).map((check) => check.name),
    finalResult: draft.finalResult || 'contrôles passés',
    originLabel: draft.id,
  });
  if (proposal.action === 'candidate') {
    return { action: 'candidate', reason: 'Candidate seulement. Un seul succès ne valide pas la compétence.' };
  }
  return { action: proposal.action, reason: proposal.reason };
}

export function judgeMissionEvidence(draft: EvidenceDraft): MissionEvidence {
  const checks = (draft.checks ?? []).map((check) => ({ ...check, reason: clean(check.reason, 300) || undefined }));
  const decision = judge(draft, checks);
  const category = categoryOf(draft);
  const goal = clean(draft.goal, 400);
  const limits = [...(draft.limits ?? []).map((line) => clean(line, 240)).filter(Boolean), LIMIT_NOTE];
  const checksNotRun = checks.filter((check) => !check.ran).map((check) => check.reason || `${check.name} non lancé`);
  const partial: Omit<MissionEvidence, 'staging' | 'skill'> = {
    id: draft.id,
    at: draft.at,
    goal,
    passCriteria: (draft.passCriteria ?? []).map((line) => clean(line, 240)).filter(Boolean),
    kind: draft.kind,
    initialState: clean(draft.initialState, 800),
    filesCreated: draft.filesCreated ?? [],
    filesChanged: draft.filesChanged ?? [],
    filesDeleted: draft.filesDeleted ?? [],
    diff: clean(draft.diff, 80_000),
    commands: (draft.commands ?? []).map((command) => ({
      command: clean(command.command, 300),
      exitCode: command.exitCode,
      ...(command.excerpt ? { excerpt: clean(command.excerpt, 400) } : {}),
    })),
    checks,
    errors: (draft.errors ?? []).map((line) => clean(line, 400)).filter(Boolean),
    fixes: (draft.fixes ?? []).map((line) => clean(line, 400)).filter(Boolean),
    finalResult: clean(draft.finalResult, 800),
    toolVersion: clean(draft.toolVersion, 120),
    model: clean(draft.model, 120),
    skillsUsed: draft.skillsUsed ?? [],
    limits,
    checksNotRun,
    audit: (draft.audit ?? []).map((line) => clean(line, 300)).filter(Boolean).slice(0, 40),
    ...(draft.beforeSource ? { beforeSource: clean(draft.beforeSource, 1_200) } : {}),
    ...(draft.afterSource ? { afterSource: clean(draft.afterSource, 1_200) } : {}),
    ...(draft.language ? { language: clean(draft.language, 40) } : {}),
    declaredSuccess: draft.declaredSuccess === true,
    status: decision.status,
    statusReason: decision.reason,
    fingerprint: fingerprintOf(goal, category),
  };
  const version = codeHash(partial.diff, [
    ...partial.filesCreated,
    ...partial.filesChanged,
    ...partial.filesDeleted,
  ]);
  partial.checks = partial.checks.map((check) =>
    check.kind === 'test' && check.ran && !check.codeVersion ? { ...check, codeVersion: version } : check,
  );
  return {
    ...partial,
    staging: stagingFor(partial, draft.seenFingerprints ?? []),
    skill: skillFor(draft, decision.status),
  };
}

/** Seules les candidates acceptées entrent dans l’export 5.0.50. Une candidate non validée reste dehors. */
export function exportStagedEvidence(rows: readonly MissionEvidence[]): DatasetBuild {
  const sources = rows.flatMap((row) =>
    row.staging.validationStatus === 'accepted' && row.staging.source ? [row.staging.source] : [],
  );
  return buildFinetuneDataset(sources);
}

export function missionVerdictFromEvidence(status: EvidenceStatus): 'success' | 'failed' | 'stopped' | null {
  if (status === 'success_verified') return 'success';
  if (status === 'cancelled') return 'stopped';
  if (status === 'failed' || status === 'blocked') return 'failed';
  return null;
}

export interface TaskEvidenceInput {
  id: string;
  at: number;
  goal: string;
  criteria: string[];
  model?: string;
  runtimeVersion?: string;
  declaredVerdict: 'success' | 'failed' | 'stopped' | null;
  cancelled?: boolean;
  files: readonly { path: string; status: 'added' | 'deleted' | 'modified' | 'renamed' }[];
  diffText: string;
  runs: readonly {
    label: string;
    ok: boolean;
    results: readonly {
      suite: string;
      command: string;
      exitCode: number | null;
      summary: string;
      failures: string[];
      excerpt?: string;
    }[];
  }[];
  plannedChecks: readonly string[];
  errors?: string[];
  fixes?: string[];
  skillsUsed?: string[];
  initialState?: string;
  beforeSource?: string;
  afterSource?: string;
  language?: string;
  seenFingerprints?: readonly string[];
  audit?: string[];
  /** Faux : la dernière série ne satisfait pas ses critères, même si une commande a un code. */
  lastSeriesOk?: boolean;
}

function suiteKind(suite: string): EvidenceCheckKind {
  if (suite === 'typecheck') return 'typecheck';
  if (suite === 'lint') return 'lint';
  if (suite === 'build') return 'build';
  return 'test';
}

/** Relit la tâche de code déjà exécutée. N’invente aucun code de sortie. */
export function evidenceFromTask(input: TaskEvidenceInput): MissionEvidence {
  const last = input.runs.at(-1);
  const bySuite = new Map((last?.results ?? []).map((result) => [result.suite, result]));
  const planned = input.plannedChecks.length ? input.plannedChecks : [...bySuite.keys()];
  const checks: EvidenceCheck[] = planned.map((suite) => {
    const result = bySuite.get(suite);
    const kind = suiteKind(suite);
    if (!result) {
      return {
        name: suite,
        kind,
        required: true,
        ran: false,
        passed: null,
        exitCode: null,
        testsRan: null,
        reason: `${suite} n’a pas été lancé.`,
      };
    }
    const counted = kind === 'test' ? testsCounted(result.summary) ?? testsCounted(result.excerpt ?? '') : null;
    const passed = result.exitCode === 0 && result.failures.length === 0;
    return {
      name: suite,
      kind,
      required: true,
      ran: result.exitCode !== null,
      passed: result.exitCode === null ? null : passed,
      exitCode: result.exitCode,
      testsRan: counted,
      reason: passed ? result.summary : result.failures[0] || result.summary,
    };
  });
  if (input.lastSeriesOk === false) {
    checks.push({
      name: 'résultat de la série',
      kind: 'criterion',
      required: true,
      ran: true,
      passed: false,
      exitCode: null,
      testsRan: null,
      reason: input.errors?.at(-1) || 'La dernière série ne satisfait pas les critères.',
    });
  }
  if (!planned.includes('typecheck')) {
    checks.push({
      name: 'typecheck',
      kind: 'typecheck',
      required: false,
      ran: false,
      passed: null,
      exitCode: null,
      testsRan: null,
      reason: 'Vérification des types non demandée pour cette mission.',
    });
  }
  const commands: EvidenceCommand[] = input.runs.flatMap((run) =>
    run.results.map((result) => ({
      command: result.command,
      exitCode: result.exitCode,
      excerpt: result.summary,
    })),
  );
  return judgeMissionEvidence({
    id: input.id,
    at: input.at,
    goal: input.goal,
    passCriteria: input.criteria,
    kind: 'programming',
    cancelled: input.cancelled,
    declaredSuccess: input.declaredVerdict === 'success',
    initialState: input.initialState,
    filesCreated: input.files.filter((file) => file.status === 'added').map((file) => file.path),
    filesChanged: input.files.filter((file) => file.status === 'modified' || file.status === 'renamed').map((file) => file.path),
    filesDeleted: input.files.filter((file) => file.status === 'deleted').map((file) => file.path),
    diff: input.diffText,
    deliveredPaths: input.files.map((file) => file.path),
    commands,
    checks,
    errors: input.errors,
    fixes: input.fixes,
    finalResult: last?.ok ? 'La dernière série requise est au vert.' : input.errors?.[0] || '',
    toolVersion: input.runtimeVersion,
    model: input.model,
    skillsUsed: input.skillsUsed,
    limits: ['Même projet et même version du code. Un fichier isolé ne devient pas une règle.'],
    language: input.language,
    beforeSource: input.beforeSource,
    afterSource: input.afterSource,
    seenFingerprints: input.seenFingerprints,
    audit: [
      ...(input.audit ?? []),
      ...input.runs.map((run) => `série « ${run.label} » : indicateur ok=${run.ok}`),
    ],
  });
}

/** Relit un dossier déjà écrit. Le statut stocké ne gagne pas sur les contrôles. */
export function recheckStoredEvidence(evidence: MissionEvidence): MissionEvidence {
  return judgeMissionEvidence({
    id: evidence.id,
    at: evidence.at,
    goal: evidence.goal,
    passCriteria: evidence.passCriteria,
    kind: evidence.kind,
    declaredSuccess: evidence.declaredSuccess,
    initialState: evidence.initialState,
    filesCreated: evidence.filesCreated,
    filesChanged: evidence.filesChanged,
    filesDeleted: evidence.filesDeleted,
    diff: evidence.diff,
    commands: evidence.commands,
    checks: evidence.checks,
    errors: evidence.errors,
    fixes: evidence.fixes,
    finalResult: evidence.finalResult,
    toolVersion: evidence.toolVersion,
    model: evidence.model,
    skillsUsed: evidence.skillsUsed,
    limits: evidence.limits.filter((line) => line !== LIMIT_NOTE),
    language: evidence.language,
    beforeSource: evidence.beforeSource,
    afterSource: evidence.afterSource,
    audit: evidence.audit,
    seenFingerprints: evidence.staging.reason.startsWith('doublon') ? [evidence.fingerprint] : [],
  });
}
