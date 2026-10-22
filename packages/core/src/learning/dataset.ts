/**
 * Jeu d’entraînement régénéré depuis les sources déjà validées.
 * Aucun entraînement, aucun poids, aucun second magasin.
 * Une ligne synthétique reste étiquetée et hors du jeu réel.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchResult } from '../developer/benchmarkTypes.js';
import type { MissionState } from '../developer/engine/mission.js';
import { redactSecrets } from '../security/redact.js';
import { assessTrainResources, sanitizeWebExtract, type LearningRecord, type TrainRow } from './continuous.js';
import { examplesToJsonl, MIN_EXAMPLES_FOR_TRAIN } from './export.js';
import {
  canQloraTrainOnOllamaModel,
  DEFAULT_LOCAL_TRAIN_BASE,
  huggingFaceIdForOllamaTrainBase,
  planLocalLearningTrain,
} from './plan.js';
import type { LocalLearningExample } from './types.js';

export const DATASET_CATEGORIES = [
  'programming-debugging',
  'tool-use',
  'analysis',
  'documentation',
  'explicit-constraints',
] as const;
export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];

export type DatasetSourceKind =
  | 'finished-mission'
  | 'failed-mission'
  | 'validated-correction'
  | 'candidate-skill'
  | 'validated-skill'
  | 'rejected-try'
  | 'benchmark'
  | 'execution-log'
  | 'chat-example'
  | 'document';

export interface DatasetSource {
  id: string;
  kind: DatasetSourceKind;
  origin: string;
  group: string;
  category: DatasetCategory;
  fields: string[];
  synthetic?: boolean;
  declaredSuccess?: boolean;
  verified?: boolean;
  testsRun?: string[];
  testsPassed?: boolean;
  /** Nombre de projets où le résultat a été revérifié. */
  projectsVerified?: number;
  context?: string;
  task?: string;
  method?: string;
  constraints?: string;
  answer?: string;
  limits?: string;
  testResult?: string;
  oneFile?: boolean;
  sensitive?: boolean;
  /** Motif d’audit quand la source ne doit pas devenir une réponse. */
  auditNote?: string;
}

export interface DatasetAuditEntry {
  id: string;
  kind: DatasetSourceKind;
  origin: string;
  category: DatasetCategory;
  fields: string[];
  synthetic: boolean;
  sensitive: boolean;
  quality: 'kept' | 'rejected' | 'analysis';
  reason: string;
}

export interface DatasetRow {
  id: string;
  category: DatasetCategory;
  origin: string;
  group: string;
  synthetic: boolean;
  limits: string;
  tests: string;
  testResult: string;
  user: string;
  assistant: string;
  /** Texte utilisé pour regrouper les quasi-doublons, pas la consigne complète. */
  clusterText: string;
  /** Réponse seule, sans l’identifiant, pour les doublons et les contradictions. */
  answerKey: string;
  projectsVerified: number;
}

export interface DatasetSplits {
  train: DatasetRow[];
  validation: DatasetRow[];
  test: DatasetRow[];
}

export interface DatasetManifestRow {
  id: string;
  split: 'train' | 'validation' | 'test' | 'synthetic';
  origin: string;
  category: DatasetCategory;
  group: string;
  synthetic: boolean;
  verified: true;
}

export interface DatasetManifest {
  version: '5.0.50';
  readyForFinetune: boolean;
  reason: string;
  collected: number;
  kept: number;
  rejected: number;
  analysis: number;
  duplicates: number;
  contradictions: string[];
  byCategory: Record<DatasetCategory, { collected: number; kept: number; rejected: number }>;
  splits: { train: number; validation: number; test: number; synthetic: number };
  underrepresented: DatasetCategory[];
  rows: DatasetManifestRow[];
}

export interface DatasetBuild {
  audit: DatasetAuditEntry[];
  kept: DatasetRow[];
  synthetic: DatasetRow[];
  analysis: DatasetAuditEntry[];
  duplicates: number;
  contradictions: string[];
  splits: DatasetSplits;
  manifest: DatasetManifest;
}

export interface DatasetFiles {
  'train.jsonl': string;
  'validation.jsonl': string;
  'test.jsonl': string;
  'synthetic-pipeline.jsonl': string;
  'manifest.json': string;
  'audit.json': string;
  'analysis.json': string;
}

const ANALYSIS_KINDS = new Set<DatasetSourceKind>(['failed-mission', 'candidate-skill', 'rejected-try']);

function blankCategory(): { collected: number; kept: number; rejected: number } {
  return { collected: 0, kept: 0, rejected: 0 };
}

export function emptyCategoryCounts(): DatasetManifest['byCategory'] {
  return {
    'programming-debugging': blankCategory(),
    'tool-use': blankCategory(),
    analysis: blankCategory(),
    documentation: blankCategory(),
    'explicit-constraints': blankCategory(),
  };
}

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return norm(text)
    .split(' ')
    .filter((token) => token.length > 2);
}

function near(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length > 16 && right.length > 16 && (left.includes(right) || right.includes(left))) return true;
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (a.size < 3 || b.size < 3) return false;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter) >= 0.8;
}

function anonymize(text: string): { text: string; sensitive: boolean } {
  const secrets = redactSecrets(text);
  const mail = secrets.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]');
  const password = mail.replace(
    /\b(mot de passe|password|passwd)\b(\s*[:=]\s*)(\S+)/gi,
    '$1$2[REDACTED]',
  );
  return { text: password, sensitive: password !== text };
}

function useful(text: string | undefined): string {
  return (text ?? '').trim();
}

function documentedScore(row: DatasetRow): number {
  return row.user.length + row.assistant.length + row.tests.length + row.limits.length + row.projectsVerified * 100;
}

function toExample(row: DatasetRow): LocalLearningExample {
  return {
    id: row.id,
    at: 0,
    user: row.user,
    assistant: row.assistant,
    toolsOk: [],
    conversationId: row.group,
  };
}

function jsonl(rows: readonly DatasetRow[]): string {
  return examplesToJsonl(rows.map(toExample));
}

/** Refuse une ligne qui n’a pas de contrôle, même si un statut dit succès. */
export function unverifiedExport(source: Pick<DatasetSource, 'verified' | 'testsPassed' | 'testsRun' | 'declaredSuccess'>): string | null {
  if (source.declaredSuccess && source.verified !== true) return 'succès déclaré sans contrôle';
  if (source.verified !== true) return 'pas de contrôle vérifiable';
  if (!source.testsRun?.some((item) => item.trim())) return 'tests absents';
  if (source.testsPassed !== true) return 'tests non réussis';
  return null;
}

function auditOf(
  source: DatasetSource,
  quality: DatasetAuditEntry['quality'],
  reason: string,
  sensitive: boolean,
): DatasetAuditEntry {
  return {
    id: source.id,
    kind: source.kind,
    origin: source.origin,
    category: source.category,
    fields: source.fields,
    synthetic: source.synthetic === true,
    sensitive,
    quality,
    reason,
  };
}

interface Prepared {
  source: DatasetSource;
  row: DatasetRow;
  sensitive: boolean;
}

function prepare(source: DatasetSource): { prepared?: Prepared; reject?: string; sensitive: boolean } {
  const block = unverifiedExport(source);
  if (source.oneFile) return { reject: 'correctif d’un seul fichier', sensitive: false };
  const web = sanitizeWebExtract([source.task, source.context, source.answer, source.constraints].filter(Boolean).join('\n'));
  if (web.ignoredInstructions) return { reject: 'consigne non fiable', sensitive: false };
  if (block) return { reject: block, sensitive: false };
  const parts = ['context', 'task', 'answer', 'limits', 'testResult'].map((key) => useful(source[key as keyof DatasetSource] as string | undefined));
  if (parts.some((part) => part.length < 8)) return { reject: 'contexte incomplet', sensitive: false };
  const userRaw = [
    `Contexte : ${useful(source.context)}`,
    `Tâche : ${useful(source.task)}`,
    source.method ? `Méthode : ${useful(source.method)}` : '',
    source.constraints ? `Contraintes : ${useful(source.constraints)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const assistantRaw = [
    useful(source.answer),
    `Tests lancés : ${(source.testsRun ?? []).join(', ')}`,
    `Résultat des tests : ${useful(source.testResult)}`,
    `Identifiant : ${source.id}`,
    `Origine : ${source.origin}`,
    `Limites : ${useful(source.limits)}`,
  ].join('\n');
  const user = anonymize(userRaw);
  const assistant = anonymize(assistantRaw);
  const sensitive = user.sensitive || assistant.sensitive || source.sensitive === true;
  if (!user.text.replace(/\[REDACTED\]/g, '').trim() || !assistant.text.replace(/\[REDACTED\]/g, '').trim()) {
    return { reject: 'secret ou donnée personnelle', sensitive: true };
  }
  const row: DatasetRow = {
    id: source.id,
    category: source.category,
    origin: source.origin,
    group: source.group.trim() || source.id,
    synthetic: source.synthetic === true,
    limits: anonymize(useful(source.limits)).text,
    tests: (source.testsRun ?? []).join(', '),
    testResult: anonymize(useful(source.testResult)).text,
    user: user.text,
    assistant: assistant.text,
    clusterText: norm(`${useful(source.task)}\n${useful(source.context)}`),
    answerKey: norm(useful(source.answer)),
    projectsVerified: source.projectsVerified ?? 1,
  };
  return { prepared: { source, row, sensitive }, sensitive };
}

function clusterGroups(rows: readonly DatasetRow[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id) ?? id;
    if (next === id) return id;
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const unite = (left: string, right: string) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
  };
  for (const row of rows) parent.set(row.group, row.group);
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const left = rows[i];
      const right = rows[j];
      if (!left || !right) continue;
      if (left.group === right.group || near(left.clusterText, right.clusterText)) unite(left.group, right.group);
    }
  }
  const out = new Map<string, string>();
  for (const row of rows) out.set(row.group, find(row.group));
  return out;
}

function assignSplits(groups: readonly string[]): Map<string, 'train' | 'validation' | 'test'> {
  const sorted = [...new Set(groups)].sort();
  const out = new Map<string, 'train' | 'validation' | 'test'>();
  if (sorted.length < 3) {
    for (const group of sorted) out.set(group, 'train');
    return out;
  }
  let testCount = Math.max(1, Math.floor(sorted.length * 0.2));
  let validationCount = Math.max(1, Math.floor(sorted.length * 0.2));
  if (testCount + validationCount >= sorted.length) {
    testCount = 1;
    validationCount = 1;
  }
  sorted.forEach((group, index) => {
    const fromEnd = sorted.length - 1 - index;
    if (fromEnd < testCount) out.set(group, 'test');
    else if (fromEnd < testCount + validationCount) out.set(group, 'validation');
    else out.set(group, 'train');
  });
  return out;
}

function readiness(real: DatasetSplits, categories: DatasetManifest['byCategory']): { ready: boolean; reason: string; underrepresented: DatasetCategory[] } {
  const kept = real.train.length + real.validation.length + real.test.length;
  const present = DATASET_CATEGORIES.filter((category) => categories[category].kept > 0);
  const underrepresented = DATASET_CATEGORIES.filter((category) => categories[category].kept === 0);
  if (kept === 0) {
    return {
      ready: false,
      reason: 'Aucune ligne réelle retenue. Il faut collecter des missions vérifiées avant un entraînement.',
      underrepresented,
    };
  }
  if (kept < MIN_EXAMPLES_FOR_TRAIN) {
    return {
      ready: false,
      reason: `Pas assez de lignes réelles (${kept}, seuil ${MIN_EXAMPLES_FOR_TRAIN}). Le fichier n’est pas complété avec des exemples inventés.`,
      underrepresented,
    };
  }
  if (real.validation.length === 0 || real.test.length === 0) {
    return {
      ready: false,
      reason: 'Pas assez de groupes indépendants pour séparer validation et test. Le jeu de test ne doit pas servir à ajuster l’export.',
      underrepresented,
    };
  }
  if (present.length < 2) {
    return {
      ready: false,
      reason: 'Le jeu réel ne couvre qu’une catégorie. Il est trop étroit pour un entraînement.',
      underrepresented,
    };
  }
  return { ready: true, reason: 'Lignes vérifiées, catégories séparées, trois jeux disjoints.', underrepresented };
}

/** Construit le jeu à partir des sources. Deux appels sur les mêmes sources donnent le même résultat. */
export function buildFinetuneDataset(sources: readonly DatasetSource[]): DatasetBuild {
  const audit: DatasetAuditEntry[] = [];
  const analysis: DatasetAuditEntry[] = [];
  const prepared: Prepared[] = [];
  const byCategory = emptyCategoryCounts();
  for (const source of sources) {
    byCategory[source.category].collected += 1;
    if (ANALYSIS_KINDS.has(source.kind) || (source.kind === 'execution-log' && source.verified !== true)) {
      const reason =
        source.auditNote ??
        (source.kind === 'failed-mission'
          ? 'échec conservé pour l’analyse, pas comme réponse'
          : source.kind === 'candidate-skill'
            ? 'candidate non validée'
            : source.kind === 'rejected-try'
              ? 'essai rejeté'
              : 'journal inutile');
      const entry = auditOf(source, 'analysis', reason, false);
      audit.push(entry);
      analysis.push(entry);
      byCategory[source.category].rejected += 1;
      continue;
    }
    const result = prepare(source);
    if (!result.prepared) {
      const entry = auditOf(source, 'rejected', result.reject ?? 'refusé', result.sensitive);
      audit.push(entry);
      byCategory[source.category].rejected += 1;
      continue;
    }
    prepared.push(result.prepared);
  }

  const groups = clusterGroups(prepared.map((item) => item.row));
  const best = new Map<string, Prepared>();
  let duplicates = 0;
  const contradictions: string[] = [];
  for (const item of prepared) {
    const group = groups.get(item.row.group) ?? item.row.group;
    item.row.group = group;
    const key = `${group}|${item.row.answerKey}`;
    const previous = best.get(key);
    if (!previous) {
      best.set(key, item);
      continue;
    }
    duplicates += 1;
    const winner = documentedScore(item.row) > documentedScore(previous.row) ? item : previous;
    const loser = winner === item ? previous : item;
    best.set(key, winner);
    audit.push(auditOf(loser.source, 'rejected', 'doublon exact', loser.sensitive));
    byCategory[loser.source.category].rejected += 1;
  }

  const byGroup = new Map<string, Prepared[]>();
  for (const item of best.values()) {
    const bucket = byGroup.get(item.row.group) ?? [];
    bucket.push(item);
    byGroup.set(item.row.group, bucket);
  }
  const accepted: Prepared[] = [];
  for (const bucket of byGroup.values()) {
    const answers = new Set(bucket.map((item) => item.row.answerKey));
    if (answers.size <= 1) {
      accepted.push(...bucket);
      continue;
    }
    const ranked = [...bucket].sort((a, b) => b.row.projectsVerified - a.row.projectsVerified);
    const top = ranked[0];
    const second = ranked[1];
    if (top && second && top.row.projectsVerified > second.row.projectsVerified && top.row.projectsVerified > 1) {
      accepted.push(top);
      contradictions.push(top.row.group);
      for (const item of ranked.slice(1)) {
        audit.push(auditOf(item.source, 'rejected', 'contradiction', item.sensitive));
        byCategory[item.source.category].rejected += 1;
      }
      continue;
    }
    contradictions.push(bucket[0]?.row.group ?? 'contradiction');
    for (const item of bucket) {
      audit.push(auditOf(item.source, 'rejected', 'contradiction', item.sensitive));
      byCategory[item.source.category].rejected += 1;
    }
  }

  const realRows = accepted.filter((item) => !item.row.synthetic);
  const syntheticRows = accepted.filter((item) => item.row.synthetic);
  for (const item of syntheticRows) {
    audit.push(auditOf(item.source, 'rejected', 'synthétique, hors du jeu réel', item.sensitive));
    byCategory[item.source.category].rejected += 1;
  }
  const splitOf = assignSplits(realRows.map((item) => item.row.group));
  const splits: DatasetSplits = { train: [], validation: [], test: [] };
  for (const item of realRows) {
    const split = splitOf.get(item.row.group) ?? 'train';
    splits[split].push(item.row);
    audit.push(auditOf(item.source, 'kept', 'contrôles vérifiés', item.sensitive));
    byCategory[item.source.category].kept += 1;
  }
  for (const name of ['train', 'validation', 'test'] as const) {
    splits[name].sort((a, b) => a.id.localeCompare(b.id));
  }
  syntheticRows.sort((a, b) => a.row.id.localeCompare(b.row.id));
  const ready = readiness(splits, byCategory);
  const manifest: DatasetManifest = {
    version: '5.0.50',
    readyForFinetune: ready.ready,
    reason: ready.reason,
    collected: sources.length,
    kept: realRows.length,
    rejected: audit.filter((item) => item.quality === 'rejected').length,
    analysis: analysis.length,
    duplicates,
    contradictions: [...new Set(contradictions)].sort(),
    byCategory,
    splits: {
      train: splits.train.length,
      validation: splits.validation.length,
      test: splits.test.length,
      synthetic: syntheticRows.length,
    },
    underrepresented: ready.underrepresented,
    rows: [
      ...(['train', 'validation', 'test'] as const).flatMap((split) =>
        splits[split].map((row) => ({
          id: row.id,
          split,
          origin: row.origin,
          category: row.category,
          group: row.group,
          synthetic: false as const,
          verified: true as const,
        })),
      ),
      ...syntheticRows.map((item) => ({
        id: item.row.id,
        split: 'synthetic' as const,
        origin: item.row.origin,
        category: item.row.category,
        group: item.row.group,
        synthetic: true as const,
        verified: true as const,
      })),
    ],
  };
  return {
    audit,
    kept: realRows.map((item) => item.row),
    synthetic: syntheticRows.map((item) => item.row),
    analysis,
    duplicates,
    contradictions: manifest.contradictions,
    splits,
    manifest,
  };
}

export function renderDataset(build: DatasetBuild): DatasetFiles {
  return {
    'train.jsonl': jsonl(build.splits.train),
    'validation.jsonl': jsonl(build.splits.validation),
    'test.jsonl': jsonl(build.splits.test),
    'synthetic-pipeline.jsonl': jsonl(build.synthetic),
    'manifest.json': `${JSON.stringify(build.manifest, null, 2)}\n`,
    'audit.json': `${JSON.stringify(build.audit, null, 2)}\n`,
    'analysis.json': `${JSON.stringify(build.analysis, null, 2)}\n`,
  };
}

const SECRET_LEAK = /\b(ghp_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/;

/** Second contrôle : une ligne non vérifiée, un secret ou un groupe coupé en deux refusent l’export. */
export function checkDatasetFiles(files: DatasetFiles): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let manifest: DatasetManifest;
  try {
    manifest = JSON.parse(files['manifest.json']) as DatasetManifest;
  } catch {
    return { ok: false, errors: ['manifest illisible'] };
  }
  if (manifest.version !== '5.0.50') errors.push('version de manifest inattendue');
  for (const name of ['train.jsonl', 'validation.jsonl', 'test.jsonl', 'synthetic-pipeline.jsonl'] as const) {
    const split = name === 'synthetic-pipeline.jsonl' ? 'synthetic' : name.replace('.jsonl', '');
    for (const line of files[name].split('\n')) {
      if (!line.trim()) continue;
      if (SECRET_LEAK.test(line)) errors.push(`secret dans ${name}`);
      let parsed: { messages?: { role?: string; content?: string }[] };
      try {
        parsed = JSON.parse(line) as { messages?: { role?: string; content?: string }[] };
      } catch {
        errors.push(`ligne illisible dans ${name}`);
        continue;
      }
      const messages = parsed.messages ?? [];
      if (messages.length !== 2 || messages[0]?.role !== 'user' || messages[1]?.role !== 'assistant') {
        errors.push(`forme conversationnelle refusée dans ${name}`);
      }
      const assistant = messages[1]?.content ?? '';
      if (!assistant.includes('Résultat des tests :') || !assistant.includes('Tests lancés :')) {
        errors.push(`ligne sans tests dans ${name}`);
      }
      const id = /Identifiant : ([^\n]+)/.exec(assistant)?.[1];
      const row = manifest.rows.find((item) => item.id === id);
      if (!row || row.verified !== true || row.split !== split) errors.push(`export non vérifié dans ${name}`);
    }
  }
  const groups = new Map<string, string>();
  for (const row of manifest.rows) {
    if (row.verified !== true) errors.push(`ligne non vérifiée ${row.id}`);
    if (row.synthetic && row.split !== 'synthetic') errors.push(`synthétique dans le jeu réel ${row.id}`);
    if (!row.synthetic && row.split === 'synthetic') errors.push(`ligne réelle marquée synthétique ${row.id}`);
    const previous = groups.get(row.group);
    if (previous && previous !== row.split) errors.push(`groupe ${row.group} coupé entre ${previous} et ${row.split}`);
    groups.set(row.group, row.split);
  }
  const real = manifest.rows.filter((row) => row.split !== 'synthetic');
  if (real.length !== manifest.kept) errors.push('compte de lignes incohérent');
  if (manifest.readyForFinetune) {
    if (manifest.splits.train === 0 || manifest.splits.validation === 0 || manifest.splits.test === 0) {
      errors.push('prêt annoncé avec un jeu vide');
    }
    if (manifest.kept < MIN_EXAMPLES_FOR_TRAIN) errors.push('prêt annoncé sous le seuil');
    const present = DATASET_CATEGORIES.filter((category) => manifest.byCategory[category].kept > 0);
    if (present.length < 2) errors.push('prêt annoncé sur une seule catégorie');
  }
  const analysis = JSON.parse(files['analysis.json']) as DatasetAuditEntry[];
  const realText = `${files['train.jsonl']}\n${files['validation.jsonl']}\n${files['test.jsonl']}`;
  for (const item of analysis) {
    if (realText.includes(`Identifiant : ${item.id}`)) errors.push(`analyse exportée comme réponse ${item.id}`);
  }
  return { ok: errors.length === 0, errors };
}

/** Écrit le jeu. Un dossier déjà rempli est copié avant remplacement, puis le contrôle doit passer. */
export async function writeDatasetDir(dir: string, build: DatasetBuild): Promise<{ ok: boolean; errors: string[] }> {
  const files = renderDataset(build);
  const checked = checkDatasetFiles(files);
  if (!checked.ok) return checked;
  const manifestPath = join(dir, 'manifest.json');
  let backup: string | null = null;
  try {
    await readFile(manifestPath, 'utf8');
    backup = join(dir, 'backup-previous');
    await rm(backup, { recursive: true, force: true });
    await mkdir(backup, { recursive: true });
    for (const name of Object.keys(files)) {
      try {
        const current = await readFile(join(dir, name));
        await writeFile(join(backup, name), current);
      } catch {
        /* fichier absent dans l’ancien jeu */
      }
    }
  } catch {
    backup = null;
  }
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents, 'utf8');
  }
  const written: DatasetFiles = { ...files };
  for (const name of Object.keys(files) as (keyof DatasetFiles)[]) {
    written[name] = await readFile(join(dir, name), 'utf8');
  }
  const again = checkDatasetFiles(written);
  if (!again.ok && backup) {
    for (const name of Object.keys(files)) {
      try {
        const previous = await readFile(join(backup, name));
        await writeFile(join(dir, name), previous);
      } catch {
        await rm(join(dir, name), { force: true });
      }
    }
  }
  return again;
}

export function datasetSourceFromRecord(record: LearningRecord): DatasetSource {
  const skill = record.skill;
  const fields = ['id', 'type', 'status', 'origin', 'content', skill ? 'skill' : '', record.trace ? 'trace' : '', record.hint ? 'hint' : ''].filter(Boolean);
  if (record.type === 'procedure' && skill) {
    const origin = skill.sources[0] ?? record.trace?.context ?? record.id;
    const independent = skill.results.filter((result) => result.ok && !result.uncertain && result.context !== origin);
    const contradictory = skill.results.some((result) => result.uncertain);
    const tests = record.trace?.testsRun?.filter((item) => item.trim()) ?? [];
    const checks = skill.checks.filter((item) => item.trim());
    const testsRun = tests.length ? tests : checks;
    const verified = record.status === 'validated' && independent.length > 0 && !contradictory && testsRun.length > 0;
    const category =
      skill.scope === 'tool-version' || record.method?.kind === 'documented-export'
        ? 'tool-use'
        : skill.scope === 'diagnosis' || record.method?.kind === 'keep-green'
          ? 'analysis'
          : 'programming-debugging';
    const success = [...independent].reverse()[0];
    return {
      id: record.id,
      kind: record.status === 'rejected' ? 'rejected-try' : record.status === 'validated' ? 'validated-skill' : 'candidate-skill',
      origin: `competence:${skill.skillId}`,
      group: skill.skillId,
      category,
      fields,
      declaredSuccess: record.status === 'validated',
      verified,
      testsRun,
      testsPassed: verified,
      projectsVerified: independent.length,
      context: skill.appliesWhen,
      task: record.trace?.problem || skill.appliesWhen,
      method: skill.name,
      constraints: [...skill.preconditions, ...skill.limits].join(' '),
      answer: [skill.name, ...skill.steps].join('\n'),
      limits: skill.limits.join(' '),
      testResult: success?.detail || record.trace?.finalResult || '',
      oneFile: false,
    };
  }
  if (record.type === 'experience') {
    const testsRun = record.testCommands ?? record.trace?.testsRun ?? [];
    const passed = record.status === 'validated' && record.trace?.outcome === 'passed' && testsRun.length > 0 && Boolean(record.afterResult?.trim());
    return {
      id: record.id,
      kind: record.trace?.outcome === 'failed' || record.status === 'rejected' ? 'rejected-try' : 'validated-correction',
      origin: `experience:${record.id}`,
      group: record.trace?.context || record.id,
      category: 'programming-debugging',
      fields,
      declaredSuccess: record.status === 'validated',
      verified: passed,
      testsRun: [...testsRun],
      testsPassed: passed,
      projectsVerified: 1,
      context: record.trace?.context || record.cause || '',
      task: record.trace?.problem || record.content,
      method: record.fix,
      constraints: record.trace?.limits,
      answer: record.fix,
      limits: record.trace?.limits || 'Correctif local. Pas une règle pour d’autres fichiers.',
      testResult: record.afterResult,
      oneFile: true,
    };
  }
  if (record.type === 'doc') {
    return {
      id: record.id,
      kind: 'document',
      origin: record.sources[0]?.label || 'document',
      group: record.id,
      category: 'documentation',
      fields,
      declaredSuccess: record.status === 'validated',
      verified: false,
      testsRun: [],
      testsPassed: false,
      context: record.content,
      task: record.content,
      answer: record.content,
      limits: 'Un document sans contrôle exécuté n’est pas une réponse.',
      testResult: '',
    };
  }
  return {
    id: record.id,
    kind: 'validated-correction',
    origin: record.origin,
    group: record.id,
    category: record.type === 'preference' || record.type === 'correction' ? 'explicit-constraints' : 'analysis',
    fields,
    declaredSuccess: record.status === 'validated',
    verified: false,
    testsRun: [],
    testsPassed: false,
    context: record.content,
    task: record.content,
    answer: record.content,
    limits: record.trace?.limits || 'Préférence sans contrôle exécuté.',
    testResult: '',
  };
}

export function datasetSourceFromMission(mission: MissionState): DatasetSource {
  const failed = mission.verdict === 'failed' || mission.verdict === 'stopped';
  return {
    id: mission.id,
    kind: failed ? 'failed-mission' : 'finished-mission',
    origin: `mission:${mission.projectId}`,
    group: mission.projectId || mission.id,
    category: 'programming-debugging',
    fields: ['id', 'projectId', 'request', 'verdict', 'summary', 'learning'],
    declaredSuccess: mission.verdict === 'success',
    verified: false,
    testsRun: [],
    testsPassed: false,
    context: mission.kind,
    task: mission.request,
    answer: mission.summary ?? '',
    limits: 'Le statut de la mission n’est pas un contrôle.',
    testResult: mission.learning?.saved ? 'fiche déclarée enregistrée' : '',
  };
}

export function datasetSourcesFromBench(result: BenchResult): DatasetSource[] {
  return result.tasks.map((task) => ({
    id: `${result.model}:${task.id}`,
    kind: 'benchmark' as const,
    origin: `benchmark:${result.model}`,
    group: `${result.model}:${task.kind}`,
    category: task.kind === 'tool-call' ? 'tool-use' : 'programming-debugging',
    fields: ['id', 'label', 'kind', 'ok', 'detail'],
    declaredSuccess: task.ok === true,
    verified: task.ok === true && task.detail.trim().length > 12,
    testsRun: task.ok === true ? [task.id] : [],
    testsPassed: task.ok === true,
    context: task.label,
    task: task.label,
    answer: task.detail,
    limits: 'Résultat de banc. La similarité avec une réponse d’entraînement ne compte pas.',
    testResult: task.ok === true ? 'contrôle du banc passé' : task.ok === false ? 'contrôle du banc échoué' : 'contrôle non vérifiable',
    projectsVerified: 1,
  }));
}

export function datasetSourceFromExample(example: LocalLearningExample): DatasetSource {
  return {
    id: example.id,
    kind: 'chat-example',
    origin: `conversation:${example.conversationId || example.id}`,
    group: example.conversationId || example.id,
    category: example.toolsOk.length ? 'tool-use' : 'analysis',
    fields: ['id', 'user', 'assistant', 'toolsOk', 'correction'],
    declaredSuccess: !example.correction?.trim(),
    verified: example.toolsOk.length > 0 && !example.correction?.trim(),
    testsRun: example.toolsOk,
    testsPassed: example.toolsOk.length > 0 && !example.correction?.trim(),
    context: example.toolsOk.length ? `Outils réussis : ${example.toolsOk.join(', ')}` : example.user,
    task: example.user,
    answer: example.assistant,
    limits: 'Tour de discussion. Une correction utilisateur n’est pas une bonne réponse.',
    testResult: example.toolsOk.length ? 'outils réussis' : '',
    projectsVerified: 1,
  };
}

export interface DatasetLoad {
  sources: DatasetSource[];
  notes: string[];
}

/** Relit les journaux, l’index et les bancs déjà sur le disque. N’invente aucune ligne. */
export async function loadDatasetTree(root: string): Promise<DatasetLoad> {
  const sources: DatasetSource[] = [];
  const notes: string[] = [];
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || files.length > 200) return;
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'release' || name.startsWith('backup-')) continue;
      const path = join(dir, name);
      let info: { isDirectory(): boolean; isFile(): boolean; size: number };
      try {
        info = await stat(path);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(path, depth + 1);
        continue;
      }
      if (!info.isFile() || !name.endsWith('.json') || info.size > 2_000_000) continue;
      files.push(path);
    }
  }
  await walk(root, 0);
  notes.push(`${files.length} fichier(s) json lu(s) sous ${root}`);
  for (const path of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
      notes.push(`illisible: ${path}`);
      continue;
    }
    if (path.endsWith('knowledge-index.json') && parsed && typeof parsed === 'object' && Array.isArray((parsed as { chunks?: unknown[] }).chunks)) {
      for (const chunk of (parsed as { chunks: { learning?: LearningRecord }[] }).chunks) {
        if (chunk.learning?.id && chunk.learning.type) sources.push(datasetSourceFromRecord(chunk.learning));
      }
      continue;
    }
    if (path.endsWith(`${join('learning', 'examples.json')}`) && Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === 'object' && typeof (item as LocalLearningExample).user === 'string') {
          sources.push(datasetSourceFromExample(item as LocalLearningExample));
        }
      }
      continue;
    }
    if (path.includes(`${join('missions', '')}`) && parsed && typeof parsed === 'object' && typeof (parsed as MissionState).request === 'string' && typeof (parsed as MissionState).id === 'string') {
      sources.push(datasetSourceFromMission(parsed as MissionState));
      continue;
    }
    if (path.includes(`${join('bench', '')}`) && parsed && typeof parsed === 'object' && Array.isArray((parsed as BenchResult).tasks)) {
      sources.push(...datasetSourcesFromBench(parsed as BenchResult));
    }
  }
  return { sources, notes };
}

export interface LocalTrainRecommendation {
  machine: string;
  base: string;
  huggingFace: string;
  quantization: string;
  vram: string;
  runNow: false;
  datasetReady: boolean;
  reasons: string[];
}

/** Recommandation seulement. N’installe rien et ne télécharge rien. */
export function recommendLocalQlora(input: { keptRows: number; readyForFinetune: boolean }): LocalTrainRecommendation {
  const onSmall = planLocalLearningTrain('qwen2.5:1.5b');
  const resources = assessTrainResources({
    examples: input.keptRows,
    ramBytes: 64 * 1024 ** 3,
    vramBytes: 6 * 1024 ** 3,
  });
  const reasons = [
    'PC visé : i7-9700KF, 64 Go de RAM, RTX 2060 6 Go. La VM de preuve est plus petite et sans GPU : l’entraînement n’y est pas lancé.',
    `Socle retenu : ${DEFAULT_LOCAL_TRAIN_BASE} (${huggingFaceIdForOllamaTrainBase(DEFAULT_LOCAL_TRAIN_BASE)}), QLoRA 4 bits, r=8, lot 1. qwen2.5:7b est refusé (${canQloraTrainOnOllamaModel('qwen2.5:7b') ? 'accepté' : 'refusé'} par la porte 6 Go).`,
    `qwen2.5:1.5b tient en VRAM, et le plan dirait « ${onSmall.trainNote} ». Le catalogue l’écarte pour l’appel d’outils, donc le socle reste le 3B.`,
    resources.ok ? resources.note : resources.reason,
    input.readyForFinetune
      ? 'Le manifest autoriserait un essai. Cette version ne le lance pas.'
      : 'Le manifest dit que le jeu n’est pas prêt : ne pas lancer.',
  ];
  return {
    machine: 'i7-9700KF, 64 Go RAM, RTX 2060 6 Go',
    base: DEFAULT_LOCAL_TRAIN_BASE,
    huggingFace: huggingFaceIdForOllamaTrainBase(DEFAULT_LOCAL_TRAIN_BASE),
    quantization: 'QLoRA 4-bit NF4, adaptateur r=8, pas un entraînement complet',
    vram: 'environ 2,5 à 2,9 Go pour Qwen2.5 3B Q4 ; le 7B déborde',
    runNow: false,
    datasetReady: input.readyForFinetune,
    reasons,
  };
}

export interface ComparisonArm {
  name: string;
  model: string;
  settings: string;
}

export interface ComparisonProtocol {
  runNow: false;
  score: string;
  arms: ComparisonArm[];
  suites: { name: string; pass: string }[];
}

/** Protocole futur. Il n’est pas exécuté ici. */
export function finetuneComparisonProtocol(referenceModel: string): ComparisonProtocol {
  const settings = 'température 0, même graine, même num_predict, même consigne, sans le jeu de test dans le prompt';
  return {
    runNow: false,
    score: 'Le score est le contrôle du cas (tests, outil, contrainte). La similarité avec la réponse d’entraînement ne compte pas.',
    arms: [
      { name: 'reference', model: referenceModel, settings },
      { name: 'trained', model: `${DEFAULT_LOCAL_TRAIN_BASE} + adaptateur`, settings },
    ],
    suites: [
      { name: 'tâches générales', pass: 'le contrôle propre à la tâche passe' },
      { name: 'catégories présentes dans le jeu', pass: 'même critère, compté à part par catégorie' },
      { name: 'problèmes nouveaux', pass: 'absents du manifeste, le contrôle du cas passe' },
      { name: 'régressions', pass: 'un cas déjà vert le reste' },
      { name: 'contraintes explicites', pass: 'le vérificateur de contrainte est vert' },
      { name: 'usage d’outil', pass: 'l’outil attendu est appelé avec les arguments du cas' },
    ],
  };
}

export function datasetTrainRows(build: DatasetBuild): TrainRow[] {
  return build.splits.train.map((row) => ({ id: row.id, user: row.user, assistant: row.assistant }));
}
