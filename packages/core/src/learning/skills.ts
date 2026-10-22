/**
 * Compétence exécutable, dans la fiche d’apprentissage déjà là.
 * Elle est choisie puis lancée sur les tests de CE fichier.
 * Son texte n’est pas ajouté au prompt.
 */
import {
  applyMethod,
  codeSymptomIds,
  methodFromObservation,
  noteMethodOutcome,
  type MethodKind,
  type MethodObservation,
  type MethodOutcome,
} from './methods.js';
import { applyIncoming, type LearningRecord, type LearningStatus } from './continuous.js';

export interface SkillExample {
  label: string;
  result: string;
}

export interface SkillResult {
  context: string;
  ok: boolean;
  detail: string;
  at: number;
  uncertain?: boolean;
}

export interface SkillSnapshot {
  revision: number;
  version: number;
  at: number;
  name: string;
  appliesWhen: string;
  preconditions: string[];
  steps: string[];
  tools: string[];
  checks: string[];
  examples: SkillExample[];
  limits: string[];
  content: string;
  status: LearningStatus;
}

export interface LearningSkill {
  skillId: string;
  version: number;
  revision: number;
  name: string;
  appliesWhen: string;
  preconditions: string[];
  steps: string[];
  tools: string[];
  checks: string[];
  examples: SkillExample[];
  limits: string[];
  sources: string[];
  results: SkillResult[];
  history: SkillSnapshot[];
  previousId?: string;
}

export interface SkillRun {
  source: string;
  changed: boolean;
  selectedId: string | null;
  selectedName: string | null;
  recordId?: string;
  used: boolean;
  uncertain?: string;
}

export interface SkillQuery {
  source?: string;
  tests?: string;
  language?: string;
  version?: string;
  query?: string;
  /** La campagne C ne compte que les compétences validées. */
  validatedOnly?: boolean;
}

export interface SkillTrainRow {
  problem: string;
  instruction: string;
  method: string;
  expected: string;
  solution: string;
  tests: string;
}

const PROFILE: Record<
  MethodKind,
  { name: string; appliesWhen: string; preconditions: string[]; tools: string[]; checks: string[] }
> = {
  'align-return': {
    name: 'Aligner le retour',
    appliesWhen: 'Le retour utilise un opérateur que les tests de ce fichier contredisent.',
    preconditions: ['même langage', 'un seul opérateur satisfait tous les exemples'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier'],
    checks: ['valeur normale', 'zéro', 'valeur négative'],
  },
  'guard-empty': {
    name: 'Protéger une collection vide',
    appliesWhen: 'Une division par la longueur n’a pas de valeur pour la collection vide.',
    preconditions: ['même langage', 'une seule valeur de repli dans les tests de ce fichier'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier'],
    checks: ['collection vide', 'un élément', 'plusieurs éléments'],
  },
  'join-separator': {
    name: 'Déduire le séparateur',
    appliesWhen: 'Une jointure n’utilise pas le séparateur attendu par les tests de ce fichier.',
    preconditions: ['même langage', 'les exemples s’accordent sur un seul séparateur'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier'],
    checks: ['deux éléments', 'un élément', 'collection vide'],
  },
  'catch-parse': {
    name: 'Rattraper une analyse',
    appliesWhen: 'Un texte qui n’est pas du JSON fait échouer l’analyse.',
    preconditions: ['même langage', 'une seule valeur de repli pour le texte illisible'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier'],
    checks: ['JSON valide', 'texte illisible'],
  },
  'coerce-call': {
    name: 'Convertir avant une méthode de texte',
    appliesWhen: 'Une méthode de texte est appelée sur un nombre.',
    preconditions: ['même langage', 'String satisfait tous les exemples de ce fichier'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier'],
    checks: ['nombre positif', 'zéro'],
  },
  'documented-export': {
    name: 'Choisir la fonction documentée',
    appliesWhen: 'Le fichier importe node:path et les tests attendent une fonction documentée.',
    preconditions: ['même langage', 'une seule fonction documentée satisfait les exemples', 'aucun code de page web'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier', 'node:path'],
    checks: ['chemin composé', 'chemin simple'],
  },
  'last-index': {
    name: 'Prendre le dernier élément',
    appliesWhen: 'L’index utilisé est la longueur du tableau, pas le dernier élément.',
    preconditions: ['même langage', 'les exemples attendent le dernier élément'],
    tools: ['édition du fichier courant', 'lecture des tests du fichier'],
    checks: ['plusieurs éléments', 'un seul élément'],
  },
  'keep-green': {
    name: 'Laisser un fichier déjà vert',
    appliesWhen: 'Les tests passent déjà et la demande est de ne pas changer le comportement.',
    preconditions: ['même langage', 'aucune modification si les tests sont déjà verts'],
    tools: ['lecture des tests du fichier'],
    checks: ['les tests déjà verts restent verts'],
  },
};

function pythonSource(source: string): boolean {
  return /^\s*def\s+\w+\s*\(/m.test(source) && !/\bfunction\b/.test(source);
}

function snapshotOf(record: LearningRecord): SkillSnapshot {
  const skill = record.skill!;
  return {
    revision: skill.revision,
    version: skill.version,
    at: record.lastCheckedAt,
    name: skill.name,
    appliesWhen: skill.appliesWhen,
    preconditions: skill.preconditions,
    steps: skill.steps,
    tools: skill.tools,
    checks: skill.checks,
    examples: skill.examples,
    limits: skill.limits,
    content: record.content,
    status: record.status,
  };
}

/** Un succès de mission devient une compétence candidate. L’ancienne ligne n’est pas recopiée. */
export function skillFromObservation(input: MethodObservation): LearningRecord | null {
  const record = methodFromObservation(input);
  if (!record?.method) return null;
  const profile = PROFILE[record.method.kind];
  const origin = input.originLabel?.trim() || 'projet d’origine';
  const language = record.method.language || 'unknown';
  const skill: LearningSkill = {
    skillId: `competence:${record.method.kind}:${language}`,
    version: 1,
    revision: 1,
    name: profile.name,
    appliesWhen: profile.appliesWhen,
    preconditions: profile.preconditions,
    steps: record.method.steps,
    tools: profile.tools,
    checks: profile.checks,
    examples: [{ label: origin, result: 'les tests du projet d’origine ont passé' }],
    limits: [record.method.limits],
    sources: [origin],
    results: [],
    history: [],
  };
  return { ...record, skill };
}

function originOf(record: LearningRecord): string {
  return record.skill?.sources[0] ?? record.method?.evidence[0]?.label ?? '';
}

function pushHistory(record: LearningRecord): LearningRecord {
  if (!record.skill) return record;
  return {
    ...record,
    skill: {
      ...record.skill,
      history: [...record.skill.history, snapshotOf(record)].slice(-8),
      revision: record.skill.revision + 1,
    },
  };
}

/**
 * Un autre contexte peut valider la compétence.
 * Le contexte qui l’a créée ne la valide pas.
 * Un échec ajoute une limite. Une candidate jamais utile est rejetée.
 * Une compétence validée ne change pas ses étapes.
 */
export function settleSkill(record: LearningRecord, outcome: MethodOutcome): LearningRecord {
  if (record.type !== 'procedure' || record.status === 'rejected') return record;
  const origin = originOf(record);
  const context = outcome.context.trim();
  if (outcome.ok && origin && context === origin) return record;
  const next = noteMethodOutcome(record, outcome);
  if (!next.skill) return next;
  if (outcome.uncertain || (!outcome.ok && !outcome.cause?.trim())) {
    const noted = pushHistory(next);
    return {
      ...noted,
      skill: {
        ...noted.skill!,
        results: [
          ...noted.skill!.results,
          { context: context.slice(0, 180) || 'contexte', ok: false, detail: 'cause incertaine', at: outcome.now, uncertain: true },
        ].slice(-8),
      },
    };
  }
  if (!outcome.ok) {
    const cause = outcome.cause!.trim().slice(0, 300);
    const noted = pushHistory(next);
    const skill = noted.skill!;
    const rejected = noted.status === 'candidate' && (noted.method?.helped.length ?? 0) === 0;
    return {
      ...noted,
      ...(rejected
        ? {
            status: 'rejected' as const,
            confidenceReason: 'Compétence inefficace sur un problème indépendant : elle n’est plus sélectionnée.',
          }
        : {}),
      skill: {
        ...skill,
        limits: [...skill.limits, cause].slice(-8),
        results: [...skill.results, { context: context.slice(0, 180) || 'contexte', ok: false, detail: cause, at: outcome.now }].slice(-8),
      },
    };
  }
  const noted = pushHistory(next);
  return {
    ...noted,
    skill: {
      ...noted.skill!,
      results: [
        ...noted.skill!.results,
        { context: context.slice(0, 180) || 'contexte', ok: true, detail: 'les tests de ce contexte ont passé', at: outcome.now },
      ].slice(-8),
    },
  };
}

/** Rejet explicite. Les étapes restent lisibles, la compétence n’est plus choisie. */
export function rejectSkill(record: LearningRecord, cause: string, now: number): LearningRecord {
  if (record.type !== 'procedure' || !record.skill || record.status === 'rejected') return record;
  const noted = pushHistory({ ...record, lastCheckedAt: now });
  const reason = cause.trim().slice(0, 300) || 'compétence inefficace';
  return {
    ...noted,
    status: 'rejected',
    lastCheckedAt: now,
    confidenceReason: 'Compétence rejetée : elle ne sera plus sélectionnée.',
    skill: {
      ...noted.skill!,
      limits: [...noted.skill!.limits, reason].slice(-8),
      results: [...noted.skill!.results, { context: 'rejet', ok: false, detail: reason, at: now }].slice(-8),
    },
  };
}

/**
 * Une compétence validée n’est pas modifiée sur place.
 * La nouvelle version est une candidate, l’ancienne reste sélectionnable.
 */
export function reviseSkill(
  record: LearningRecord,
  content: string,
  now: number,
  id: string,
): { kept: LearningRecord; created: LearningRecord | null } {
  const text = content.trim().slice(0, 2_000);
  if (!text || record.type !== 'procedure' || !record.skill) return { kept: record, created: null };
  if (record.status !== 'validated') {
    const noted = pushHistory(record);
    return {
      kept: {
        ...noted,
        content: text,
        status: 'review',
        lastCheckedAt: now,
        confidenceReason: 'Texte corrigé. Les étapes exécutables ne sont pas réécrites.',
      },
      created: null,
    };
  }
  const created: LearningRecord = {
    ...record,
    id,
    content: text,
    status: 'candidate',
    createdAt: now,
    lastCheckedAt: now,
    confidence: 0.62,
    confidenceReason:
      'Nouvelle version candidate. La version validée reste en place jusqu’à un autre projet dont les tests passent.',
    links: [...new Set([...record.links, record.id])],
    skill: {
      ...record.skill,
      version: record.skill.version + 1,
      revision: 1,
      previousId: record.id,
      results: [],
      history: [snapshotOf(record)],
    },
  };
  return { kept: record, created };
}

/** Rétablit une révision enregistrée. Les étapes de la procédure validée restent celles de cette révision. */
export function restoreSkillVersion(record: LearningRecord, revision: number): LearningRecord {
  const skill = record.skill;
  if (!skill) return record;
  const snap = skill.history.find((item) => item.revision === revision);
  if (!snap) return record;
  const current = snapshotOf(record);
  return {
    ...record,
    content: snap.content,
    status: snap.status,
    lastCheckedAt: snap.at,
    skill: {
      ...skill,
      version: snap.version,
      revision: snap.revision,
      name: snap.name,
      appliesWhen: snap.appliesWhen,
      preconditions: snap.preconditions,
      steps: snap.steps,
      tools: snap.tools,
      checks: snap.checks,
      examples: snap.examples,
      limits: snap.limits,
      history: [...skill.history.filter((item) => item.revision !== revision), current].slice(-8),
    },
  };
}

/** Même identifiant et même version : pas une seconde fiche. */
export function admitSkill(
  existing: readonly LearningRecord[],
  incoming: LearningRecord | null,
): { records: LearningRecord[]; action: 'stored' | 'duplicate' | 'ignored'; id: string | null } {
  if (!incoming) return { records: [...existing], action: 'ignored', id: null };
  if (!incoming.skill) {
    const applied = applyIncoming(existing, incoming);
    return {
      records: applied.records,
      action: applied.action === 'duplicate' ? 'duplicate' : 'stored',
      id: incoming.id,
    };
  }
  const dup = existing.find(
    (item) =>
      item.status !== 'rejected' &&
      item.skill?.skillId === incoming.skill?.skillId &&
      item.skill?.version === incoming.skill?.version,
  );
  if (dup) return { records: [...existing], action: 'duplicate', id: dup.id };
  return { records: [incoming, ...existing], action: 'stored', id: incoming.id };
}

function symptomOf(record: LearningRecord): string {
  return record.trace?.symptomIds?.[0] ?? record.method?.problemType ?? '';
}

function languageOf(record: LearningRecord): string {
  const method = record.method;
  if (method?.language && method.language !== 'unknown') return method.language;
  return record.trace?.language ?? '';
}

function ranked(
  records: readonly LearningRecord[],
  input: SkillQuery,
  mode: 'trusted' | 'trial',
): LearningRecord[] {
  const symptoms = codeSymptomIds(input.source ?? '', input.tests ?? '');
  const scored: { item: LearningRecord; score: number }[] = [];
  for (const item of records) {
    if (item.type !== 'procedure' || !item.method) continue;
    if (mode === 'trusted') {
      if (input.validatedOnly) {
        if (item.status !== 'validated') continue;
      } else if (item.status !== 'validated' && item.status !== 'review') continue;
    } else if (item.status !== 'candidate') continue;
    const language = languageOf(item);
    if (input.language && language && language !== 'unknown' && language !== input.language) continue;
    if (pythonSource(input.source ?? '') && language !== 'python') continue;
    const version = item.trace?.runtimeVersion;
    if (input.version && version && version !== input.version) continue;
    const symptom = symptomOf(item);
    if (symptoms.length) {
      if (!symptoms.includes(symptom)) continue;
    } else if (symptom !== 'keep-green' || !/ne pas casser|refactor/i.test(input.query ?? '')) continue;
    const versionRank = item.skill?.version ?? 1;
    const wins = item.skill?.results.filter((result) => result.ok).length ?? item.method.helped.length;
    const trust = item.status === 'validated' ? 2 : item.status === 'review' ? 1 : 0;
    scored.push({ item, score: trust * 10 + versionRank + wins });
  }
  const best = new Map<string, { item: LearningRecord; score: number }>();
  for (const row of scored) {
    const key = row.item.skill?.skillId ?? `${row.item.method?.kind}:${languageOf(row.item)}`;
    const prev = best.get(key);
    if (!prev || row.score > prev.score) best.set(key, row);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => row.item);
}

/** Une seule compétence, ou aucune. Le reste de la bibliothèque n’est pas renvoyé. */
export function selectSkill(records: readonly LearningRecord[], input: SkillQuery): LearningRecord | null {
  return ranked(records, input, 'trusted')[0] ?? null;
}

function runOne(
  source: string,
  tests: string,
  records: readonly LearningRecord[],
  input: SkillQuery,
  mode: 'trusted' | 'trial',
): SkillRun {
  const found = ranked(records, { ...input, source, tests }, mode);
  const options = {
    ...(input.language ? { language: input.language } : {}),
    ...(input.version ? { version: input.version } : {}),
  };
  let first: LearningRecord | null = null;
  let uncertain: { record: LearningRecord; message: string } | null = null;
  for (const record of found) {
    if (!first) first = record;
    const edit = applyMethod(source, tests, [record], options);
    if (edit.uncertain) {
      if (!uncertain) uncertain = { record, message: edit.uncertain };
      continue;
    }
    if (edit.applied) {
      return {
        source: edit.source,
        changed: edit.source !== source,
        selectedId: record.skill?.skillId ?? record.id,
        selectedName: record.skill?.name ?? record.method?.kind ?? null,
        recordId: record.id,
        used: true,
      };
    }
  }
  if (uncertain) {
    return {
      source,
      changed: false,
      selectedId: uncertain.record.skill?.skillId ?? uncertain.record.id,
      selectedName: uncertain.record.skill?.name ?? uncertain.record.method?.kind ?? null,
      recordId: uncertain.record.id,
      used: false,
      uncertain: uncertain.message,
    };
  }
  if (!first) {
    return { source, changed: false, selectedId: null, selectedName: null, used: false };
  }
  return {
    source,
    changed: false,
    selectedId: first.skill?.skillId ?? first.id,
    selectedName: first.skill?.name ?? first.method?.kind ?? null,
    recordId: first.id,
    used: false,
  };
}

/** Lance une compétence validée, ou une compétence en revue. Sinon le fichier ne change pas. */
export function applySkill(
  source: string,
  tests: string,
  records: readonly LearningRecord[],
  input: SkillQuery,
): SkillRun {
  return runOne(source, tests, records, input, 'trusted');
}

/** Essai d’une candidate seulement. Un résultat incertain n’écrit rien. */
export function applySkillTrial(
  source: string,
  tests: string,
  records: readonly LearningRecord[],
  input: SkillQuery,
): SkillRun {
  return runOne(source, tests, records, input, 'trial');
}

/**
 * Lignes d’entraînement à part du magasin. Aucun appel de modèle.
 * Les essais ratés, les contradictions et les exemples trop minces sont écartés.
 */
export function skillTrainRows(records: readonly LearningRecord[]): SkillTrainRow[] {
  const rows: SkillTrainRow[] = [];
  for (const record of records) {
    const skill = record.skill;
    if (!skill || record.status !== 'validated' || record.type !== 'procedure') continue;
    if (skill.steps.length < 2 || skill.examples.length < 1) continue;
    if (skill.results.some((result) => result.uncertain)) continue;
    const contexts = new Map<string, Set<boolean>>();
    for (const result of skill.results) {
      const set = contexts.get(result.context) ?? new Set<boolean>();
      set.add(result.ok);
      contexts.set(result.context, set);
    }
    if ([...contexts.values()].some((set) => set.size > 1)) continue;
    const success = [...skill.results].reverse().find((result) => result.ok);
    if (!success) continue;
    rows.push({
      problem: skill.appliesWhen,
      instruction: skill.steps.join(' '),
      method: `${skill.name} (${record.method?.kind ?? 'procedure'})`,
      expected: success.detail,
      solution: 'Réécrire le fichier courant à partir de ses tests, sans recopier une ancienne ligne.',
      tests: skill.checks.join(', '),
    });
  }
  return rows;
}
