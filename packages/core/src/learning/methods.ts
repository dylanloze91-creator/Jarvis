/**
 * Méthode extraite d’une mission, pas la ligne du correctif.
 * Le fichier suivant est modifié à partir de ses propres tests.
 */
import path from 'node:path';
import { applyExperienceToSource, type ExperienceTrace, type LearningRecord } from './continuous.js';

export const METHOD_KINDS = [
  'align-return',
  'guard-empty',
  'join-separator',
  'catch-parse',
  'coerce-call',
  'documented-export',
  'last-index',
  'keep-green',
] as const;
export type MethodKind = (typeof METHOD_KINDS)[number];

export interface MethodEvidence {
  label: string;
  result: string;
}

export interface MethodFailure {
  context: string;
  cause: string;
  uncertain: boolean;
}

export interface LearningMethod {
  kind: MethodKind;
  limits: string;
  evidence: MethodEvidence[];
  helped: string[];
  failures: MethodFailure[];
  language: string;
  problemType: string;
  steps: string[];
}

export interface MethodObservation {
  id: string;
  now: number;
  ok: boolean;
  language: string;
  request: string;
  beforeSource: string;
  afterSource: string;
  tests: string;
  runtimeVersion?: string;
  originLabel?: string;
}

export interface MethodOutcome {
  ok: boolean;
  context: string;
  cause?: string;
  uncertain?: boolean;
  now: number;
}

export interface ApplyMethodOptions {
  language?: string;
  version?: string;
}

export interface ApplyMethodResult {
  source: string;
  applied: boolean;
  uncertain?: string;
  kind?: MethodKind;
  recordId?: string;
  held?: boolean;
}

export interface MethodQuery {
  query: string;
  errors?: string;
  language?: string;
  version?: string;
  source?: string;
  tests?: string;
  limit?: number;
}

export interface MethodRetrieval {
  applicable: LearningRecord[];
  stale: LearningRecord[];
  uncertain: string | null;
}

const PATH_EXPORTS = ['basename', 'dirname', 'extname', 'parse', 'join', 'normalize', 'relative', 'isAbsolute'] as const;
const STRING_METHODS = new Set([
  'trim',
  'concat',
  'toUpperCase',
  'toLowerCase',
  'slice',
  'startsWith',
  'endsWith',
  'includes',
  'charAt',
  'repeat',
  'padStart',
  'padEnd',
]);

const STEPS: Record<MethodKind, string[]> = {
  'align-return': [
    'Lire le comportement attendu dans les tests de ce projet.',
    'Comparer le return avec ces exemples, sans recopier une ancienne ligne.',
    'Garder le seul opérateur qui satisfait tous les exemples.',
    'Vérifier une valeur normale et un cas limite.',
    'Si aucun ou plusieurs opérateurs conviennent, ne rien écrire.',
    'Relancer les tests de ce projet et annuler en cas de régression.',
  ],
  'guard-empty': [
    'Lire la valeur attendue pour la collection vide dans les tests de ce projet.',
    'Ne pas réutiliser la valeur de repli d’un autre projet.',
    'Protéger la division par la longueur seulement si une seule valeur est écrite.',
    'Laisser le calcul inchangé quand la collection n’est pas vide.',
    'Si la valeur est absente ou contradictoire, ne rien écrire.',
  ],
  'join-separator': [
    'Lire les chaînes attendues dans les tests de ce projet.',
    'Déduire le séparateur qui les produit toutes.',
    'Ne pas recopier le séparateur d’un autre projet.',
    'Si les exemples ne s’accordent pas, ne rien écrire.',
  ],
  'catch-parse': [
    'Lire la valeur attendue quand le texte n’est pas du JSON, dans les tests de ce projet.',
    'Entourer l’analyse d’un essai et renvoyer cette valeur seulement si l’analyse échoue.',
    'Ne pas recopier la valeur de repli d’un autre projet.',
    'Si deux textes illisibles attendent des valeurs différentes, ne rien écrire.',
  ],
  'coerce-call': [
    'Lire les exemples de ce projet.',
    'Si une méthode de texte est appelée sur un nombre, convertir ce reçu avec String dans ce fichier.',
    'Ne pas recopier le nom de méthode d’un autre projet.',
    'Si la conversion ne satisfait pas tous les exemples, ne rien écrire.',
  ],
  'documented-export': [
    'Lire le résultat attendu dans les tests de ce projet.',
    'Essayer les fonctions documentées de node:path, sans en inventer et sans exécuter une page web.',
    'Écrire seulement celle qui satisfait tous les exemples.',
    'Si plusieurs conviennent, ne rien écrire.',
  ],
  'last-index': [
    'Lire l’élément attendu dans les tests de ce projet.',
    'Si c’est le dernier élément du tableau de l’exemple, reculer d’un cran dans ce fichier.',
    'Ne pas recopier le nom de variable d’un autre projet.',
    'Si un exemple attend autre chose que le dernier élément, ne rien écrire.',
  ],
  'keep-green': [
    'Ne pas modifier un fichier dont les tests passent déjà.',
    'Un renommage incomplet ne s’applique pas.',
    'Si un changement casserait un test déjà vert, l’annuler.',
  ],
};

const LIMITS: Record<MethodKind, string> = {
  'align-return':
    'Même langage. Ne s’applique pas si aucun ou plusieurs opérateurs satisfont les exemples. Une version différente n’est pas appliquée.',
  'guard-empty':
    'La valeur de repli vient des tests de ce projet. Une autre valeur, ou deux valeurs, n’est pas écrite. Une version différente n’est pas appliquée.',
  'join-separator':
    'Le séparateur vient des tests de ce projet. Le séparateur d’un autre projet n’est pas recopié. Une version différente n’est pas appliquée.',
  'catch-parse':
    'La valeur de repli vient des tests de ce projet. null n’est pas recopié s’ils attendent autre chose. Une version différente n’est pas appliquée.',
  'coerce-call':
    'Convertit le reçu de ce fichier. Ne recolle pas la méthode d’un autre projet. Une version différente n’est pas appliquée.',
  'documented-export':
    'Fonctions documentées seulement : basename, dirname, extname, parse, join, normalize, relative, isAbsolute. Aucune fonction inventée. Aucun code de page web. Une version différente n’est pas appliquée.',
  'last-index':
    'Recule d’un cran seulement si les exemples attendent le dernier élément. Une version différente n’est pas appliquée.',
  'keep-green':
    'Ne change pas le fichier. Un échec ailleurs ne retire pas cette limite. Une version différente n’est pas appliquée.',
};

const SYMPTOM_OF: Record<MethodKind, string> = {
  'align-return': 'wrong-operator',
  'guard-empty': 'empty-division',
  'join-separator': 'join-separator',
  'catch-parse': 'parse-failure',
  'coerce-call': 'text-on-number',
  'documented-export': 'missing-export',
  'last-index': 'last-element',
  'keep-green': 'keep-green',
};

const PHRASE: Record<string, RegExp> = {
  'wrong-operator': /mauvais opérateur/i,
  'empty-division': /liste vide|collection vide/i,
  'join-separator': /séparateur de jointure/i,
  'parse-failure': /pas du json|texte inutilisable|syntaxerror/i,
  'text-on-number': /méthode de texte|trim is not a function|concat is not a function/i,
  'missing-export': /does not provide an export|symbole absent/i,
  'last-element': /dernier élément|après le dernier/i,
  'keep-green': /ne pas casser les tests|refactor sans changer le comportement/i,
};

const PHRASE_TEXT: Record<string, string> = {
  'wrong-operator': 'mauvais opérateur',
  'empty-division': 'liste vide',
  'join-separator': 'séparateur de jointure',
  'parse-failure': 'pas du json',
  'text-on-number': 'méthode de texte',
  'missing-export': 'does not provide an export',
  'last-element': 'dernier élément',
  'keep-green': 'ne pas casser les tests',
};

interface FoundFn {
  name: string;
  params: string[];
  body: string;
  open: number;
}

interface Ret {
  expr: string;
  absStart: number;
  absEnd: number;
  lineStart: number;
  indent: string;
}

interface Sample {
  fn: string;
  args: unknown[];
  expected: unknown;
}

type Edit =
  | { kind: 'skip' }
  | { kind: 'same' }
  | { kind: 'held' }
  | { kind: 'uncertain'; message: string }
  | { kind: 'edit'; source: string };

function wordTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2);
}

function isMethodKind(value: string): value is MethodKind {
  return (METHOD_KINDS as readonly string[]).includes(value);
}

export function codeSymptomIds(source: string, tests: string): string[] {
  const ids: string[] = [];
  if (/return\s+(?:[A-Za-z_][A-Za-z0-9_]*|\d+)\s*[+\-*/]\s*(?:[A-Za-z_][A-Za-z0-9_]*|\d+)/.test(source)) {
    ids.push('wrong-operator');
  }
  if (/\/\s*[A-Za-z_][A-Za-z0-9_]*\.length/.test(source) && /\[\s*\]/.test(tests)) ids.push('empty-division');
  if (/\.join\s*\(/.test(source)) ids.push('join-separator');
  if (/JSON\.parse\s*\(/.test(source)) ids.push('parse-failure');
  if (/\.(?:concat|trim|toUpperCase|toLowerCase|slice|startsWith|endsWith|includes|charAt|repeat|padStart|padEnd)\s*\(/.test(source)) {
    ids.push('text-on-number');
  }
  if (/from\s+['"](?:node:)?path['"]/.test(source) || /does not provide an export/.test(`${source}\n${tests}`)) {
    ids.push('missing-export');
  }
  if (/\[[A-Za-z_][A-Za-z0-9_]*\.length\]/.test(source) && !/\.length\s*-\s*1/.test(source)) ids.push('last-element');
  return ids;
}

export function codeSymptomQuery(source: string, tests: string): string {
  return codeSymptomIds(source, tests)
    .map((id) => PHRASE_TEXT[id] ?? '')
    .filter((line) => line.length > 0)
    .join('\n');
}

export function methodSymptomIds(text: string): string[] {
  return Object.entries(PHRASE)
    .filter(([, re]) => re.test(text))
    .map(([id]) => id);
}

function kindFromChange(before: string, after: string, request: string): MethodKind | null {
  const left = before.trim();
  const right = after.trim();
  if (left === right && /refactor|renomm|ne pas casser/i.test(request)) return 'keep-green';
  if (!left || !right || left === right) return null;
  const fromOp = binaryOf(left);
  const toOp = binaryOf(right);
  if (fromOp && toOp && fromOp.left === toOp.left && fromOp.right === toOp.right && fromOp.op !== toOp.op) {
    return 'align-return';
  }
  if (
    /\/\s*[A-Za-z_][A-Za-z0-9_]*\.length/.test(left) &&
    /length\s*===\s*0/.test(right) &&
    /\/\s*[A-Za-z_][A-Za-z0-9_]*\.length/.test(right)
  ) {
    return 'guard-empty';
  }
  if (/\.join\(\s*\)/.test(left) && /\.join\(\s*['"]/.test(right)) return 'join-separator';
  if (/JSON\.parse\s*\(/.test(left) && !/\bcatch\b/.test(left) && /\bcatch\b/.test(right) && /JSON\.parse\s*\(/.test(right)) {
    return 'catch-parse';
  }
  if (!/String\s*\(/.test(left) && /String\s*\(/.test(right) && /\.\s*(?:trim|concat|toUpperCase|toLowerCase|slice)\s*\(/.test(left)) {
    return 'coerce-call';
  }
  if (/\[[A-Za-z_][A-Za-z0-9_]*\.length\]/.test(left) && /\.length\s*-\s*1/.test(right)) return 'last-index';
  const gained = PATH_EXPORTS.some((name) => new RegExp(`\\b${name}\\b`).test(right) && !new RegExp(`\\b${name}\\b`).test(left));
  if (gained) return 'documented-export';
  return null;
}

function binaryOf(text: string): { left: string; op: string; right: string } | null {
  const match = /return\s+([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*([+\-*/])\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*;?/.exec(
    text,
  );
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { left: match[1], op: match[2], right: match[3] };
}

/** Un succès devient une méthode candidate. L’ancienne ligne n’est pas recopiée dedans. */
export function methodFromObservation(input: MethodObservation): LearningRecord | null {
  if (!input.ok) return null;
  const kind = kindFromChange(input.beforeSource, input.afterSource, input.request);
  if (!kind) return null;
  const origin = input.originLabel?.trim() || 'projet d’origine';
  const steps = STEPS[kind];
  const limits = LIMITS[kind];
  const method: LearningMethod = {
    kind,
    limits,
    evidence: [{ label: origin, result: 'les tests du projet d’origine ont passé' }],
    helped: [],
    failures: [],
    language: input.language || 'unknown',
    problemType: kind,
    steps,
  };
  const symptom = SYMPTOM_OF[kind];
  const trace: ExperienceTrace = {
    problem: input.request.slice(0, 400),
    context: origin.slice(0, 400),
    firstTry: 'le comportement ne suivait pas les tests de ce projet',
    observedErrors: '',
    appliedFix: steps[0] ?? 'méthode',
    testsRun: [],
    finalResult: 'les tests du projet d’origine ont passé',
    limits,
    language: method.language,
    problemType: kind,
    symptomIds: [symptom],
    outcome: 'passed',
    ...(input.runtimeVersion ? { runtimeVersion: input.runtimeVersion } : {}),
  };
  return {
    id: input.id,
    type: 'procedure',
    content: `Méthode ${kind}. Origine : ${origin}. ${steps.join(' ')} Limites : ${limits}`.slice(0, 2_000),
    origin: 'mission',
    createdAt: input.now,
    lastCheckedAt: input.now,
    confidence: 0.62,
    confidenceReason: 'Un succès est devenu une méthode candidate. Elle n’est validée qu’après un autre contexte dont les tests passent.',
    status: 'candidate',
    sources: [{ label: origin, fetchedAt: input.now }],
    links: [],
    method,
    trace,
  };
}

/**
 * Un succès dans un autre contexte peut valider la méthode.
 * Une cause incertaine ajoute l’incertitude et ne change ni les étapes, ni le statut.
 * Un échec dans un contexte laisse la méthode si elle a déjà marché ailleurs.
 */
export function noteMethodOutcome(record: LearningRecord, outcome: MethodOutcome): LearningRecord {
  const method = record.method;
  if (record.type !== 'procedure' || !method || record.status === 'rejected') return record;
  const context = outcome.context.trim().slice(0, 180) || 'contexte';
  if (outcome.uncertain || (!outcome.ok && !outcome.cause?.trim())) {
    return {
      ...record,
      lastCheckedAt: outcome.now,
      method: {
        ...method,
        failures: [
          ...method.failures,
          { context, cause: (outcome.cause?.trim() || 'cause incertaine').slice(0, 300), uncertain: true },
        ].slice(-8),
      },
    };
  }
  if (!outcome.ok) {
    return {
      ...record,
      lastCheckedAt: outcome.now,
      method: {
        ...method,
        failures: [
          ...method.failures,
          { context, cause: outcome.cause!.trim().slice(0, 300), uncertain: false },
        ].slice(-8),
      },
    };
  }
  const helped = method.helped.includes(context) ? method.helped : [...method.helped, context].slice(-8);
  const evidence = [
    ...method.evidence,
    { label: context, result: 'les tests de ce contexte ont passé' },
  ].slice(-8);
  const status = record.status === 'candidate' ? 'validated' : record.status;
  return {
    ...record,
    status,
    lastCheckedAt: outcome.now,
    confidence: status === 'validated' ? 0.9 : record.confidence,
    confidenceReason:
      status === 'validated'
        ? 'La méthode a servi dans un autre contexte et les tests de ce contexte ont passé.'
        : record.confidenceReason,
    method: { ...method, helped, evidence },
  };
}

/** L’utilisateur corrige le texte. Le statut passe en revue, les étapes exécutables ne sont pas devinées. */
export function correctMethod(record: LearningRecord, content: string, now: number): LearningRecord {
  if (record.type !== 'procedure' || !record.method) return record;
  const text = content.trim().slice(0, 2_000);
  if (!text) return record;
  return {
    ...record,
    content: text,
    status: 'review',
    lastCheckedAt: now,
    confidenceReason: 'Texte corrigé par l’utilisateur. Pas une validation automatique.',
  };
}

function pythonSource(source: string): boolean {
  return /^\s*def\s+\w+\s*\(/m.test(source) && !/\bfunction\b/.test(source);
}

function usableMethod(record: LearningRecord, options: ApplyMethodOptions, source: string): boolean {
  const method = record.method;
  if (record.type !== 'procedure' || !method) return false;
  if (!isMethodKind(method.kind)) return false;
  if (record.status !== 'candidate' && record.status !== 'validated' && record.status !== 'review') return false;
  const language = method.language && method.language !== 'unknown' ? method.language : record.trace?.language;
  if (options.language && language && language !== 'unknown' && language !== options.language) return false;
  if (pythonSource(source) && language !== 'python') return false;
  const version = record.trace?.runtimeVersion;
  if (options.version && version && version !== options.version) return false;
  return true;
}

export function retrieveMethods(records: readonly LearningRecord[], input: MethodQuery): MethodRetrieval {
  const limit = input.limit ?? 4;
  const askText = `${input.query}\n${input.errors ?? ''}`;
  const asked = new Set(methodSymptomIds(askText));
  const fromCode = input.source ? codeSymptomIds(input.source, input.tests ?? '') : [];
  for (const id of fromCode) asked.add(id);
  const qTokens = wordTokens(askText);
  const ranked: { item: LearningRecord; score: number }[] = [];
  const stale: LearningRecord[] = [];
  for (const item of records) {
    const method = item.method;
    if (item.type !== 'procedure' || !method || !isMethodKind(method.kind)) continue;
    if (item.status !== 'candidate' && item.status !== 'validated' && item.status !== 'review') continue;
    const language = method.language && method.language !== 'unknown' ? method.language : item.trace?.language;
    if (input.language && language && language !== 'unknown' && language !== input.language) continue;
    const version = item.trace?.runtimeVersion;
    if (input.version && version && version !== input.version) {
      stale.push(item);
      continue;
    }
    if (fromCode.length && !fromCode.includes(SYMPTOM_OF[method.kind])) continue;
    const stored = new Set(item.trace?.symptomIds ?? []);
    stored.add(SYMPTOM_OF[method.kind]);
    const symptomHit = [...asked].some((id) => stored.has(id));
    const hay = wordTokens([item.content, method.kind, method.problemType, method.steps.join(' ')].join(' '));
    const overlap = qTokens.length ? qTokens.filter((token) => hay.includes(token)).length / qTokens.length : 0;
    if (!symptomHit && overlap < 0.2) continue;
    const rank = item.status === 'validated' ? 2 : item.status === 'review' ? 1 : 0;
    ranked.push({ item, score: (symptomHit ? 1 : 0) + overlap + rank + method.helped.length * 0.05 });
  }
  ranked.sort((a, b) => b.score - a.score || b.item.confidence - a.item.confidence);
  return {
    applicable: ranked.slice(0, limit).map((row) => ({ ...row.item, reused: (row.item.reused ?? 0) + 1 })),
    stale,
    uncertain: null,
  };
}

function parseLiteral(input: string): { value: unknown; end: number } | null {
  let i = 0;
  while (input[i] === ' ' || input[i] === '\n' || input[i] === '\r' || input[i] === '\t') i += 1;
  const rest = input.slice(i);
  if (!rest) return null;
  if (rest.startsWith('null')) return { value: null, end: i + 4 };
  if (rest.startsWith('true')) return { value: true, end: i + 4 };
  if (rest.startsWith('false')) return { value: false, end: i + 5 };
  const num = /^-?\d+(?:\.\d+)?/.exec(rest);
  if (num?.[0]) return { value: Number(num[0]), end: i + num[0].length };
  if (rest[0] === "'" || rest[0] === '"') {
    const quote = rest[0];
    let out = '';
    let j = 1;
    while (j < rest.length) {
      if (rest[j] === '\\') {
        const esc = rest[j + 1] ?? '';
        out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
        j += 2;
        continue;
      }
      if (rest[j] === quote) return { value: out, end: i + j + 1 };
      out += rest[j] ?? '';
      j += 1;
    }
    return null;
  }
  if (rest[0] === '[') {
    const items: unknown[] = [];
    let j = 1;
    while (j < rest.length) {
      while (rest[j] === ' ' || rest[j] === '\n' || rest[j] === ',' || rest[j] === '\r' || rest[j] === '\t') j += 1;
      if (rest[j] === ']') return { value: items, end: i + j + 1 };
      const part = parseLiteral(rest.slice(j));
      if (!part) return null;
      items.push(part.value);
      j += part.end;
    }
    return null;
  }
  if (rest[0] === '{') {
    const obj: Record<string, unknown> = {};
    let j = 1;
    while (j < rest.length) {
      while (rest[j] === ' ' || rest[j] === '\n' || rest[j] === ',' || rest[j] === '\r' || rest[j] === '\t') j += 1;
      if (rest[j] === '}') return { value: obj, end: i + j + 1 };
      const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(rest.slice(j));
      if (!key?.[1]) return null;
      j += key[0].length;
      const part = parseLiteral(rest.slice(j));
      if (!part) return null;
      obj[key[1]] = part.value;
      j += part.end;
    }
    return null;
  }
  return null;
}

function readCall(text: string, at: number): { name: string; args: unknown[]; end: number } | null {
  const slice = text.slice(at);
  const name = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(slice);
  if (!name?.[1]) return null;
  let j = name[0].length;
  const args: unknown[] = [];
  while (j < slice.length) {
    while (slice[j] === ' ' || slice[j] === '\n' || slice[j] === ',' || slice[j] === '\r' || slice[j] === '\t') j += 1;
    if (slice[j] === ')') return { name: name[1], args, end: at + j + 1 };
    const lit = parseLiteral(slice.slice(j));
    if (!lit) return null;
    args.push(lit.value);
    j += lit.end;
  }
  return null;
}

function collectSamples(tests: string): Sample[] {
  const out: Sample[] = [];
  const re = /assert\.(?:strictEqual|deepStrictEqual|deepEqual|equal)\s*\(/g;
  for (const match of tests.matchAll(re)) {
    const start = match.index + match[0].length;
    const call = readCall(tests, start);
    if (!call) continue;
    let i = call.end;
    while (tests[i] === ' ' || tests[i] === '\n' || tests[i] === '\t') i += 1;
    if (tests[i] !== ',') continue;
    const expected = parseLiteral(tests.slice(i + 1));
    if (!expected) continue;
    out.push({ fn: call.name, args: call.args, expected: expected.value });
  }
  return out;
}

function findFunctions(source: string): FoundFn[] {
  const out: FoundFn[] = [];
  const re = /export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)[^{]*\{/g;
  for (const match of source.matchAll(re)) {
    if (match.index === undefined || !match[1]) continue;
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    const params = (match[2] ?? '')
      .split(',')
      .map((part) => part.trim().split(/[:=]/)[0]?.trim() ?? '')
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
    out.push({ name: match[1], params, body: source.slice(open + 1, end), open });
  }
  return out;
}

function returnsOf(source: string, fn: FoundFn): Ret[] {
  const body = fn.body;
  const base = fn.open + 1;
  const out: Ret[] = [];
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "'" || ch === '"') {
      i += 1;
      while (i < body.length && body[i] !== ch) i += body[i] === '\\' ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      i += 1;
      continue;
    }
    const prev = i === 0 ? '' : (body[i - 1] ?? '');
    if (depth === 0 && body.startsWith('return', i) && !/[A-Za-z0-9_]/.test(prev)) {
      let exprStart = i + 'return'.length;
      while (exprStart < body.length && /\s/.test(body[exprStart] ?? '')) exprStart += 1;
      let j = exprStart;
      let nest = 0;
      while (j < body.length) {
        const c = body[j];
        if (c === "'" || c === '"') {
          j += 1;
          while (j < body.length && body[j] !== c) j += body[j] === '\\' ? 2 : 1;
          j += 1;
          continue;
        }
        if (c === '(' || c === '[' || c === '{') nest += 1;
        else if (c === ')' || c === ']' || c === '}') nest -= 1;
        else if (c === ';' && nest === 0) break;
        j += 1;
      }
      const expr = body.slice(exprStart, j).trim();
      const absStart = base + i;
      const absEnd = base + (body[j] === ';' ? j + 1 : j);
      const lineStart = source.lastIndexOf('\n', absStart - 1) + 1;
      const indent = /^\s*/.exec(source.slice(lineStart, absStart))?.[0] ?? '';
      out.push({ expr, absStart, absEnd, lineStart, indent });
      i = absEnd - base;
      continue;
    }
    i += 1;
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left = Object.keys(a as object).sort();
    const right = Object.keys(b as object).sort();
    if (left.length !== right.length || left.some((key, index) => key !== right[index])) return false;
    return left.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

function emitLiteral(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const lit = emitLiteral(item);
      if (lit === null) return null;
      parts.push(lit);
    }
    return `[${parts.join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const parts: string[] = [];
    for (const key of Object.keys(value as object)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
      const lit = emitLiteral((value as Record<string, unknown>)[key]);
      if (lit === null) return null;
      parts.push(`${key}: ${lit}`);
    }
    return `{ ${parts.join(', ')} }`;
  }
  return null;
}

function replaceSpan(source: string, start: number, end: number, text: string): string {
  return `${source.slice(0, start)}${text}${source.slice(end)}`;
}

function samplesFor(tests: string, name: string): Sample[] {
  return collectSamples(tests).filter((sample) => sample.fn === name);
}

function editAlign(source: string, tests: string): Edit {
  let seen = false;
  let next = source;
  for (const fn of findFunctions(next)) {
    const returns = returnsOf(next, fn);
    if (returns.length !== 1) continue;
    const ret = returns[0];
    if (!ret) continue;
    const bin = /^([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)\s*([+\-*/])\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?)$/.exec(ret.expr);
    if (!bin?.[1] || !bin[2] || !bin[3]) continue;
    seen = true;
    const mine = samplesFor(tests, fn.name);
    if (!mine.length) return { kind: 'uncertain', message: 'Aucun exemple numérique pour choisir l’opérateur.' };
    const ops = ['+', '-', '*', '/'];
    const winners = ops.filter((op) =>
      mine.every((sample) => {
        if (sample.args.length !== fn.params.length || typeof sample.expected !== 'number') return false;
        const left = operand(bin[1]!, fn.params, sample.args);
        const right = operand(bin[3]!, fn.params, sample.args);
        if (left === null || right === null) return false;
        const value = applyOp(op, left, right);
        return value !== null && sameValue(value, sample.expected);
      }),
    );
    if (winners.length !== 1) {
      return { kind: 'uncertain', message: 'Aucun ou plusieurs opérateurs satisfont les exemples : rien n’est écrit.' };
    }
    const winner = winners[0];
    if (!winner || winner === bin[2]) continue;
    const expr = `${bin[1]} ${winner} ${bin[3]}`;
    return { kind: 'edit', source: replaceSpan(next, ret.lineStart, ret.absEnd, `${ret.indent}return ${expr};`) };
  }
  if (!seen) return { kind: 'skip' };
  if (next === source) return { kind: 'same' };
  return { kind: 'edit', source: next };
}

function operand(token: string, params: string[], args: unknown[]): number | null {
  if (/^-?\d/.test(token)) return Number(token);
  const index = params.indexOf(token);
  if (index < 0) return null;
  const value = args[index];
  return typeof value === 'number' ? value : null;
}

function applyOp(op: string, left: number, right: number): number | null {
  if (op === '+') return left + right;
  if (op === '-') return left - right;
  if (op === '*') return left * right;
  if (op === '/' && right !== 0) return left / right;
  return null;
}

function editGuard(source: string, tests: string): Edit {
  let seen = false;
  let next = source;
  for (const fn of findFunctions(next)) {
    const returns = returnsOf(next, fn);
    if (returns.length !== 1) continue;
    const ret = returns[0];
    if (!ret) continue;
    const div = /^(.*)\s\/\s([A-Za-z_][A-Za-z0-9_]*)\.length$/.exec(ret.expr);
    if (!div?.[1] || !div[2]) continue;
    if (div[1].includes('?')) continue;
    const param = div[2];
    const index = fn.params.indexOf(param);
    if (index < 0) continue;
    seen = true;
    const empties = samplesFor(tests, fn.name).filter((sample) => {
      const arg = sample.args[index];
      return Array.isArray(arg) && arg.length === 0;
    });
    const numbers = empties.filter((sample) => typeof sample.expected === 'number');
    const unique = [...new Set(numbers.map((sample) => sample.expected as number))];
    if (numbers.length !== empties.length || unique.length !== 1) {
      return { kind: 'uncertain', message: 'La valeur pour la collection vide est absente ou contradictoire.' };
    }
    const fallback = unique[0];
    const expr = `${param}.length === 0 ? ${fallback} : ${div[1]} / ${param}.length`;
    return { kind: 'edit', source: replaceSpan(next, ret.lineStart, ret.absEnd, `${ret.indent}return ${expr};`) };
  }
  if (!seen) return { kind: 'skip' };
  if (next === source) return { kind: 'same' };
  return { kind: 'edit', source: next };
}

function separatorOf(parts: unknown[], expected: unknown): string | null {
  if (!parts.every((part) => typeof part === 'string') || typeof expected !== 'string') return null;
  const bits = parts as string[];
  if (bits.length < 2) return null;
  if (!expected.startsWith(bits[0] ?? '') || !expected.endsWith(bits[bits.length - 1] ?? '')) return null;
  let cursor = (bits[0] ?? '').length;
  let sep: string | null = null;
  for (let i = 1; i < bits.length; i += 1) {
    const bit = bits[i] ?? '';
    const at = expected.indexOf(bit, cursor);
    if (at < cursor) return null;
    const found = expected.slice(cursor, at);
    if (sep === null) sep = found;
    else if (sep !== found) return null;
    cursor = at + bit.length;
  }
  if (cursor !== expected.length) return null;
  return sep;
}

function editJoin(source: string, tests: string): Edit {
  let seen = false;
  let next = source;
  for (const fn of findFunctions(next)) {
    const returns = returnsOf(next, fn);
    if (returns.length !== 1) continue;
    const ret = returns[0];
    if (!ret) continue;
    const join = /^([A-Za-z_][A-Za-z0-9_]*)\.join\(([\s\S]*)\)$/.exec(ret.expr);
    if (!join?.[1]) continue;
    const index = fn.params.indexOf(join[1]);
    if (index < 0) continue;
    seen = true;
    const current = currentSeparator(join[2] ?? '');
    if (current === undefined) return { kind: 'uncertain', message: 'Le séparateur actuel n’est pas un texte simple.' };
    const mine = samplesFor(tests, fn.name);
    const rich = mine.filter((sample) => Array.isArray(sample.args[index]) && (sample.args[index] as unknown[]).length >= 2);
    const seps = rich.map((sample) => separatorOf(sample.args[index] as unknown[], sample.expected));
    if (!rich.length || seps.some((sep) => sep === null)) {
      return { kind: 'uncertain', message: 'Les exemples ne donnent pas un seul séparateur.' };
    }
    const chosen = seps[0];
    if (seps.some((sep) => sep !== chosen) || chosen === null || chosen === undefined) {
      return { kind: 'uncertain', message: 'Les exemples ne s’accordent pas sur le séparateur.' };
    }
    const short = mine.filter((sample) => Array.isArray(sample.args[index]) && (sample.args[index] as unknown[]).length < 2);
    if (short.some((sample) => !sameValue((sample.args[index] as string[]).join(chosen), sample.expected))) {
      return { kind: 'uncertain', message: 'Le séparateur ne convient pas aux cas courts.' };
    }
    if (chosen === current) continue;
    const expr = `${join[1]}.join(${JSON.stringify(chosen)})`;
    return { kind: 'edit', source: replaceSpan(next, ret.lineStart, ret.absEnd, `${ret.indent}return ${expr};`) };
  }
  if (!seen) return { kind: 'skip' };
  if (next === source) return { kind: 'same' };
  return { kind: 'edit', source: next };
}

function currentSeparator(inner: string): string | undefined {
  const text = inner.trim();
  if (!text) return ',';
  const lit = parseLiteral(text);
  if (!lit || typeof lit.value !== 'string' || lit.end < text.trimEnd().length) return undefined;
  const rest = text.slice(lit.end).trim();
  if (rest.length > 0) return undefined;
  return lit.value;
}

function editParse(source: string, tests: string): Edit {
  let seen = false;
  let next = source;
  for (const fn of findFunctions(next)) {
    const returns = returnsOf(next, fn);
    const direct = returns.filter((ret) => /^JSON\.parse\(([A-Za-z_][A-Za-z0-9_]*)\)$/.test(ret.expr));
    if (!direct.length && !/\bcatch\b/.test(fn.body)) continue;
    if (direct.length !== 1 && !/\bcatch\b/.test(fn.body)) continue;
    const ident = direct[0] ? /^JSON\.parse\(([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(direct[0].expr)?.[1] : paramOfParse(fn);
    if (!ident) continue;
    seen = true;
    const mine = samplesFor(tests, fn.name);
    const fallbacks: unknown[] = [];
    for (const sample of mine) {
      if (sample.args.length !== 1 || typeof sample.args[0] !== 'string') {
        return { kind: 'uncertain', message: 'Un exemple d’analyse n’est pas un texte.' };
      }
      try {
        const parsed = JSON.parse(sample.args[0]);
        if (!sameValue(parsed, sample.expected)) {
          return { kind: 'uncertain', message: 'Un JSON valide ne correspond pas au résultat attendu.' };
        }
      } catch {
        fallbacks.push(sample.expected);
      }
    }
    if (!fallbacks.length) return { kind: 'uncertain', message: 'Aucun exemple de texte illisible.' };
    if (!fallbacks.every((value) => sameValue(value, fallbacks[0]))) {
      return { kind: 'uncertain', message: 'Deux textes illisibles attendent des valeurs différentes.' };
    }
    const literal = emitLiteral(fallbacks[0]);
    if (literal === null) return { kind: 'uncertain', message: 'La valeur de repli n’est pas un littéral simple.' };
    if (direct[0]) {
      const ret = direct[0];
      const block = `${ret.indent}try {\n${ret.indent}  return JSON.parse(${ident});\n${ret.indent}} catch {\n${ret.indent}  return ${literal};\n${ret.indent}}`;
      return { kind: 'edit', source: replaceSpan(next, ret.lineStart, ret.absEnd, block) };
    }
    if (new RegExp(`return\\s+${escapeReg(literal)}\\s*;`).test(fn.body)) continue;
    return { kind: 'uncertain', message: 'Le repli déjà écrit ne correspond pas aux tests, sans littéral unique à remplacer.' };
  }
  if (!seen) return { kind: 'skip' };
  if (next === source) return { kind: 'same' };
  return { kind: 'edit', source: next };
}

function paramOfParse(fn: FoundFn): string | null {
  const match = /JSON\.parse\(([A-Za-z_][A-Za-z0-9_]*)\)/.exec(fn.body);
  return match?.[1] ?? null;
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function editCoerce(source: string, tests: string): Edit {
  let seen = false;
  let next = source;
  for (const fn of findFunctions(next)) {
    const returns = returnsOf(next, fn);
    if (returns.length !== 1) continue;
    const ret = returns[0];
    if (!ret) continue;
    const wrapped = /^String\(([A-Za-z_][A-Za-z0-9_]*)\)\.([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(ret.expr);
    const plain = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(ret.expr);
    const recv = wrapped?.[1] ?? plain?.[1];
    const method = wrapped?.[2] ?? plain?.[2];
    const inner = wrapped?.[3] ?? plain?.[3] ?? '';
    if (!recv || !method || !STRING_METHODS.has(method)) continue;
    if (!wrapped && recv === 'String') continue;
    const index = fn.params.indexOf(recv);
    if (index < 0) continue;
    const methodArgs = splitLiterals(inner);
    if (!methodArgs) return { kind: 'uncertain', message: 'Les arguments de la méthode ne sont pas des littéraux.' };
    seen = true;
    const mine = samplesFor(tests, fn.name);
    if (!mine.length) return { kind: 'uncertain', message: 'Aucun exemple pour la conversion en texte.' };
    const ok = mine.every((sample) => {
      const value = sample.args[index];
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false;
      const called = callString(String(value), method, methodArgs);
      return called.ok && sameValue(called.value, sample.expected);
    });
    if (!ok) return { kind: 'uncertain', message: 'String ne satisfait pas tous les exemples.' };
    if (wrapped) continue;
    const expr = `String(${recv}).${method}(${inner.trim()})`;
    return { kind: 'edit', source: replaceSpan(next, ret.lineStart, ret.absEnd, `${ret.indent}return ${expr};`) };
  }
  if (!seen) return { kind: 'skip' };
  if (next === source) return { kind: 'same' };
  return { kind: 'edit', source: next };
}

function splitLiterals(inner: string): unknown[] | null {
  const text = inner.trim();
  if (!text) return [];
  const values: unknown[] = [];
  let rest = text;
  while (rest.length) {
    const lit = parseLiteral(rest);
    if (!lit) return null;
    values.push(lit.value);
    rest = rest.slice(lit.end).trim().replace(/^,/, '').trim();
  }
  return values;
}

function callString(text: string, method: string, args: unknown[]): { ok: boolean; value?: unknown } {
  try {
    if (method === 'concat' && args.every((arg) => typeof arg === 'string')) return { ok: true, value: text.concat(...(args as string[])) };
    if (method === 'trim' && args.length === 0) return { ok: true, value: text.trim() };
    if (method === 'toUpperCase' && args.length === 0) return { ok: true, value: text.toUpperCase() };
    if (method === 'toLowerCase' && args.length === 0) return { ok: true, value: text.toLowerCase() };
    if (method === 'slice' && typeof args[0] === 'number') {
      return { ok: true, value: typeof args[1] === 'number' ? text.slice(args[0], args[1]) : text.slice(args[0]) };
    }
    if ((method === 'startsWith' || method === 'endsWith' || method === 'includes') && typeof args[0] === 'string') {
      return { ok: true, value: text[method](args[0]) };
    }
    if (method === 'charAt' && typeof args[0] === 'number') return { ok: true, value: text.charAt(args[0]) };
    if (method === 'repeat' && typeof args[0] === 'number') return { ok: true, value: text.repeat(args[0]) };
    if ((method === 'padStart' || method === 'padEnd') && typeof args[0] === 'number') {
      return { ok: true, value: typeof args[1] === 'string' ? text[method](args[0], args[1]) : text[method](args[0]) };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

function callPath(name: string, args: unknown[]): unknown {
  if (!args.every((arg) => typeof arg === 'string')) return undefined;
  const bits = args as string[];
  const posix = path.posix;
  if (name === 'basename' && bits.length === 1) return posix.basename(bits[0]!);
  if (name === 'basename' && bits.length === 2) return posix.basename(bits[0]!, bits[1]!);
  if (name === 'dirname' && bits.length === 1) return posix.dirname(bits[0]!);
  if (name === 'extname' && bits.length === 1) return posix.extname(bits[0]!);
  if (name === 'parse' && bits.length === 1) return posix.parse(bits[0]!);
  if (name === 'join' && bits.length >= 1) return posix.join(...bits);
  if (name === 'normalize' && bits.length === 1) return posix.normalize(bits[0]!);
  if (name === 'relative' && bits.length === 2) return posix.relative(bits[0]!, bits[1]!);
  if (name === 'isAbsolute' && bits.length === 1) return posix.isAbsolute(bits[0]!);
  return undefined;
}

function editExport(source: string, tests: string): Edit {
  const imported = /import\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\s*from\s*(['"])(?:node:path|path)\2/.exec(source);
  if (!imported?.[1] || !imported[2]) return { kind: 'skip' };
  const local = imported[1];
  const quote = imported[2];
  let target: FoundFn | null = null;
  let ret: Ret | null = null;
  for (const fn of findFunctions(source)) {
    const returns = returnsOf(source, fn);
    if (returns.length !== 1) continue;
    const one = returns[0];
    if (!one) continue;
    if (new RegExp(`^${local}\\(([\\s\\S]*)\\)$`).test(one.expr)) {
      target = fn;
      ret = one;
      break;
    }
  }
  if (!target || !ret) return { kind: 'skip' };
  const fn = target;
  const inner = new RegExp(`^${local}\\(([\\s\\S]*)\\)$`).exec(ret.expr)?.[1] ?? '';
  const mine = samplesFor(tests, fn.name);
  if (!mine.length) return { kind: 'uncertain', message: 'Aucun exemple pour choisir la fonction documentée.' };
  const winners = PATH_EXPORTS.filter((name) =>
    mine.every((sample) => {
      const values = argsFromCall(inner, fn.params, sample.args);
      if (!values) return false;
      const produced = callPath(name, values);
      return produced !== undefined && sameValue(produced, sample.expected);
    }),
  );
  if (winners.length !== 1) {
    return {
      kind: 'uncertain',
      message: winners.length
        ? 'Plusieurs fonctions documentées conviennent : rien n’est écrit.'
        : 'Aucune fonction documentée ne convient : rien n’est écrit.',
    };
  }
  const winner = winners[0];
  if (!winner || winner === local) return { kind: 'same' };
  const importStart = imported.index ?? 0;
  const rewritten = replaceSpan(
    source,
    importStart,
    importStart + imported[0].length,
    `import { ${winner} } from ${quote}node:path${quote}`,
  );
  const shifted = findFunctions(rewritten).find((item) => item.name === fn.name);
  const back = shifted ? returnsOf(rewritten, shifted)[0] : undefined;
  if (!back) return { kind: 'uncertain', message: 'L’appel documenté n’a pas été retrouvé.' };
  const expr = `${winner}(${inner.trim()})`;
  return { kind: 'edit', source: replaceSpan(rewritten, back.lineStart, back.absEnd, `${back.indent}return ${expr};`) };
}

function argsFromCall(inner: string, params: readonly string[], sampleArgs: readonly unknown[]): unknown[] | null {
  const text = inner.trim();
  if (!text) return [];
  const parts = text.split(',').map((part) => part.trim());
  const values: unknown[] = [];
  for (const part of parts) {
    if (params.includes(part)) {
      const value = sampleArgs[params.indexOf(part)];
      if (value === undefined) return null;
      values.push(value);
      continue;
    }
    const lit = parseLiteral(part);
    if (!lit || part.slice(lit.end).trim()) return null;
    values.push(lit.value);
  }
  return values;
}

function editLast(source: string, tests: string): Edit {
  let seen = false;
  let next = source;
  for (const fn of findFunctions(next)) {
    const returns = returnsOf(next, fn);
    if (returns.length !== 1) continue;
    const ret = returns[0];
    if (!ret) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\[\s*([A-Za-z_][A-Za-z0-9_]*)\.length\s*\]$/.exec(ret.expr);
    if (!match?.[1] || match[1] !== match[2]) continue;
    const name = match[1];
    const index = fn.params.indexOf(name);
    if (index < 0) continue;
    seen = true;
    const mine = samplesFor(tests, fn.name).filter((sample) => Array.isArray(sample.args[index]));
    const arrays = mine.filter((sample) => (sample.args[index] as unknown[]).length > 0);
    if (!arrays.length) return { kind: 'uncertain', message: 'Aucun tableau d’exemple pour le dernier élément.' };
    if (arrays.some((sample) => !sameValue((sample.args[index] as unknown[]).at(-1), sample.expected))) {
      return { kind: 'uncertain', message: 'Un exemple n’attend pas le dernier élément.' };
    }
    const expr = `${name}[${name}.length - 1]`;
    return { kind: 'edit', source: replaceSpan(next, ret.lineStart, ret.absEnd, `${ret.indent}return ${expr};`) };
  }
  if (!seen) return { kind: 'skip' };
  if (next === source) return { kind: 'same' };
  return { kind: 'edit', source: next };
}

function editOf(kind: MethodKind, source: string, tests: string): Edit {
  if (kind === 'align-return') return editAlign(source, tests);
  if (kind === 'guard-empty') return editGuard(source, tests);
  if (kind === 'join-separator') return editJoin(source, tests);
  if (kind === 'catch-parse') return editParse(source, tests);
  if (kind === 'coerce-call') return editCoerce(source, tests);
  if (kind === 'documented-export') return editExport(source, tests);
  if (kind === 'last-index') return editLast(source, tests);
  if (kind === 'keep-green') return { kind: 'held' };
  return { kind: 'skip' };
}

/** Applique la méthode sur CE fichier et CES tests. Ne colle pas l’ancienne ligne. */
export function applyMethod(
  source: string,
  tests: string,
  records: readonly LearningRecord[],
  options: ApplyMethodOptions = {},
): ApplyMethodResult {
  const usable = records.filter((record) => usableMethod(record, options, source));
  const order: MethodKind[] = [
    'documented-export',
    'catch-parse',
    'guard-empty',
    'coerce-call',
    'join-separator',
    'last-index',
    'align-return',
    'keep-green',
  ];
  let next = source;
  let applied = false;
  let held = false;
  let used: LearningRecord | null = null;
  for (const kind of order) {
    const record = usable.find((item) => item.method?.kind === kind);
    if (!record?.method) continue;
    const edit = editOf(kind, next, tests);
    if (edit.kind === 'uncertain') {
      return { source, applied: false, uncertain: edit.message, kind, recordId: record.id };
    }
    if (edit.kind === 'held') {
      held = true;
      if (!used) used = record;
      continue;
    }
    if (edit.kind === 'edit') {
      next = edit.source;
      applied = true;
      used = record;
    }
  }
  return {
    source: next,
    applied,
    ...(held ? { held: true } : {}),
    ...(used?.method ? { kind: used.method.kind } : {}),
    ...(used ? { recordId: used.id } : {}),
  };
}

export interface AppliedMemory {
  source: string;
  changed: boolean;
  experienceApplied: boolean;
  methodApplied: boolean;
  methodId?: string;
  uncertain?: string;
}

/**
 * Carte exacte d’abord, puis méthode sur les tests de CE fichier.
 * Une cause incertaine ne garde pas un début de modification.
 */
export function applyMemoryToSource(
  source: string,
  tests: string,
  records: readonly LearningRecord[],
  options: { language?: string; version?: string; role?: 'source' | 'test' } = {},
): AppliedMemory {
  const experience = applyExperienceToSource(source, records, options);
  const method = applyMethod(experience.source, tests, records, {
    ...(options.language ? { language: options.language } : {}),
    ...(options.version ? { version: options.version } : {}),
  });
  if (method.uncertain) {
    return {
      source: experience.source,
      changed: experience.source !== source,
      experienceApplied: experience.applied,
      methodApplied: false,
      ...(method.recordId ? { methodId: method.recordId } : {}),
      uncertain: method.uncertain,
    };
  }
  const next = method.applied ? method.source : experience.source;
  return {
    source: next,
    changed: next !== source,
    experienceApplied: experience.applied,
    methodApplied: method.applied,
    ...(method.applied && method.recordId ? { methodId: method.recordId } : {}),
  };
}
