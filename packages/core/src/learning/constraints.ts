/**
 * Une règle explicite devient une contrainte que le vérificateur peut tester.
 * Une méthode générale et un exemple d’un autre fichier restent à part.
 * Le correcteur ne contient aucune convention particulière : il lit la fiche.
 */
import { resolveMaxFixAttempts } from '../developer/taskPlan.js';
import { redactSecrets } from '../security/redact.js';
import type { LearningRecord } from './continuous.js';

export const CONSTRAINT_APPLIES = ['exported-function', 'function', 'reply'] as const;
export type ConstraintApplies = (typeof CONSTRAINT_APPLIES)[number];

export const CONSTRAINT_VERIFIES = [
  'name-prefix',
  'return-wrapper',
  'starts-with',
  'one-line',
  'reuse-symbol',
] as const;
export type ConstraintVerify = (typeof CONSTRAINT_VERIFIES)[number];

export interface ConstraintOrigin {
  recordId: string;
  origin: LearningRecord['origin'];
  type: LearningRecord['type'];
}

/** Règle, portée, préconditions, résultat attendu, vérification, limites, origine. */
export interface KnowledgeConstraint {
  id: string;
  rule: string;
  appliesTo: ConstraintApplies;
  preconditions: string[];
  expected: string;
  verify: ConstraintVerify;
  value: string;
  limits: string[];
  origin: ConstraintOrigin;
  /** Fichier nommé dans la règle. Absent : la règle n’est pas limitée à un seul fichier. */
  file?: string;
}

export interface ConstraintFailure {
  id: string;
  verify: ConstraintVerify;
  message: string;
}

export interface ConstraintAttempt {
  constraintId: string;
  verify: ConstraintVerify;
  broken: string;
  changed: boolean;
  reason: string;
}

export type KnowledgeStage = 'record' | 'retrieve' | 'prompt' | 'plan' | 'code' | 'apply' | 'verify';

export interface KnowledgePathLog {
  stage: KnowledgeStage;
  ok: boolean;
  detail: string;
}

export interface EnforceOptions {
  /** `developer.maxFixAttempts`. Absent ou hors bornes : la limite du produit. */
  limit?: number;
  /** Chemin du fichier en cours. Une règle qui nomme un autre fichier ne s’y applique pas. */
  path?: string;
  /**
   * La demande exige une fonction. Sans fonction, la contrainte reste échouée
   * et aucune fonction n’est inventée.
   */
  requireFunction?: boolean;
}

export interface EnforceResult {
  source: string;
  /** Vrai seulement si chaque contrainte de code applicable est tenue. */
  ok: boolean;
  changed: boolean;
  attempts: ConstraintAttempt[];
  held: KnowledgeConstraint[];
  failed: ConstraintFailure[];
  trace: KnowledgePathLog[];
}

const HEDGE =
  /\b(peut-être|peut-etre|parfois|optionnel(?:le)?|au choix|éventuellement|eventuellement)\b/i;
const PREFIX_WORD = new Set([
  'ou',
  'et',
  'de',
  'du',
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'sans',
  'avec',
  'pour',
  'dans',
  'sur',
  'que',
  'qui',
  'ce',
  'se',
  'ne',
  'pas',
  'est',
  'son',
  'sa',
  'ses',
  'au',
  'aux',
  'en',
  'par',
]);
const PREFIX = /pr[ée]fixe\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
const WRAPPER = /return\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
const FILE_RULE = /dans\s+(?:le\s+)?fichier\s+[`"']?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)[`"']?/i;
const STARTS =
  /commence(?:r)? par (?:le mot |le terme |l['’]étiquette )?["«]?([A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ_-]*)/iu;
const ONE_LINE = /une seule ligne|sur une seule ligne/iu;
const REUSE =
  /r[ée]utilise(?:r)?\s+(?:le |la |l['’])?(?:helper |fonction |symbole |utilitaire |m[ée]thode )?([A-Za-z_][A-Za-z0-9_]*)/iu;
const DONT_CREATE = /ne (?:cr[ée]e|d[ée]clare) pas|d[ée]j[àa] pr[ée]sent/iu;

const CODE_VERIFIES = new Set<ConstraintVerify>(['name-prefix', 'return-wrapper']);

interface ReturnSite {
  returnStart: number;
  expr: string | null;
  exprStart: number;
  exprEnd: number;
}

interface FoundFn {
  name: string;
  nameStart: number;
  nameEnd: number;
  declStart: number;
  exported: boolean;
  bodyEnd: number;
  returns: ReturnSite[];
}

function safe(text: string): string {
  return redactSecrets(text).replace(/\s+/g, ' ').slice(0, 240);
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function captures(pattern: RegExp, content: string): string[] {
  return [...content.matchAll(new RegExp(pattern.source, pattern.flags))]
    .map((match) => match[1] ?? '')
    .filter(Boolean);
}

function explicitRule(record: LearningRecord): boolean {
  return (
    record.status === 'validated' &&
    record.origin === 'user' &&
    (record.type === 'preference' || record.type === 'correction')
  );
}

function fileOf(content: string): string | undefined {
  return FILE_RULE.exec(content)?.[1];
}

function appliesToOf(content: string): ConstraintApplies {
  const text = fold(content);
  if (/fonction\s+export[ée]e|export[ée]e/i.test(text)) return 'exported-function';
  if (/fonction/i.test(text)) return 'function';
  return 'reply';
}

function sharedLimits(file: string | undefined): string[] {
  return [
    'Ne crée pas de fonction si le texte n’en contient pas.',
    'Ne réécrit pas une fonction qui satisfait déjà cette contrainte.',
    'Une méthode générale et un exemple d’un autre fichier ne sont pas cette règle.',
    'Les fonctions imbriquées ne sont pas réécrites.',
    file ? `Seulement le fichier ${file}.` : 'Pas limitée au correctif d’un seul fichier cité.',
  ];
}

function constraint(
  record: LearningRecord,
  verify: ConstraintVerify,
  value: string,
  appliesTo: ConstraintApplies,
  expected: string,
  file: string | undefined,
): KnowledgeConstraint {
  return {
    id: `${record.id}:${verify}`,
    rule: record.content.trim().slice(0, 500),
    appliesTo,
    preconditions: [
      file ? `fichier ${file}` : 'le texte contient déjà une fonction, ou la demande en exige une',
      appliesTo === 'reply' ? 'forme de la réponse' : appliesTo === 'exported-function' ? 'fonction exportée' : 'fonction',
    ],
    expected,
    verify,
    value,
    limits: sharedLimits(file),
    origin: { recordId: record.id, origin: record.origin, type: record.type },
    ...(file ? { file } : {}),
  };
}

function hedged(content: string): boolean {
  return HEDGE.test(content) || HEDGE.test(fold(content));
}

function prefixTokens(content: string): string[] {
  return unique(captures(PREFIX, content)).filter((token) => !PREFIX_WORD.has(fold(token).toLowerCase()));
}

function fromExplicit(record: LearningRecord): KnowledgeConstraint[] {
  const content = record.content.trim();
  if (!content || hedged(content)) return [];
  const file = fileOf(content);
  const applies = appliesToOf(content);
  const out: KnowledgeConstraint[] = [];
  const prefixes = prefixTokens(content);
  const wrappers = unique(captures(WRAPPER, content));
  if (prefixes.length === 1) {
    const value = prefixes[0]!;
    const where = applies === 'reply' ? 'function' : applies;
    out.push(
      constraint(
        record,
        'name-prefix',
        value,
        where,
        `le nom commence par ${value}`,
        file,
      ),
    );
  }
  if (wrappers.length === 1) {
    const value = wrappers[0]!;
    const where = applies === 'reply' ? 'function' : applies;
    out.push(
      constraint(record, 'return-wrapper', value, where, `return ${value}( ... )`, file),
    );
  }
  const start = STARTS.exec(content);
  if (start?.[1] && applies === 'reply') {
    out.push(
      constraint(record, 'starts-with', start[1], 'reply', `la réponse commence par ${start[1]}`, file),
    );
  }
  if (ONE_LINE.test(content) && applies === 'reply') {
    out.push(constraint(record, 'one-line', '1', 'reply', 'une seule ligne', file));
  }
  const reused = REUSE.exec(content);
  if (reused?.[1] && DONT_CREATE.test(content)) {
    out.push(
      constraint(
        record,
        'reuse-symbol',
        reused[1],
        'reply',
        `appeler ${reused[1]} sans le redéclarer`,
        file,
      ),
    );
  }
  return out;
}

function dropContradictions(items: KnowledgeConstraint[]): KnowledgeConstraint[] {
  const groups = new Map<string, KnowledgeConstraint[]>();
  for (const item of items) {
    const key = `${item.verify}:${item.file ?? '*'}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const kept: KnowledgeConstraint[] = [];
  for (const list of groups.values()) {
    const values = unique(list.map((item) => item.value));
    if (values.length !== 1) continue;
    kept.push(list[0]!);
  }
  return kept;
}

/** Règles explicites seulement. Une expérience, une méthode ou une page web n’en font pas partie. */
export function extractConstraints(records: readonly LearningRecord[]): KnowledgeConstraint[] {
  const found = records.filter(explicitRule).flatMap(fromExplicit);
  return dropContradictions(found);
}

export function constraintApplies(constraint: KnowledgeConstraint, path?: string): boolean {
  if (!constraint.file) return true;
  if (!path) return false;
  const want = constraint.file.replace(/\\/g, '/');
  const have = path.replace(/\\/g, '/');
  return have === want || have.endsWith(`/${want}`);
}

function applicable(records: readonly LearningRecord[], path?: string): KnowledgeConstraint[] {
  return extractConstraints(records).filter((item) => constraintApplies(item, path));
}

function codeConstraints(records: readonly LearningRecord[], path?: string): KnowledgeConstraint[] {
  return applicable(records, path).filter((item) => CODE_VERIFIES.has(item.verify));
}

function isIdent(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}

function isKeyword(source: string, index: number, word: string): boolean {
  if (!source.startsWith(word, index)) return false;
  return !isIdent(source[index - 1]) && !isIdent(source[index + word.length]);
}

function skipString(source: string, index: number): number {
  const quote = source[index];
  if (quote !== '"' && quote !== "'" && quote !== '`') return index;
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipNoise(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      i = nl < 0 ? source.length : nl + 1;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      i = skipString(source, i);
      continue;
    }
    break;
  }
  return i;
}

function skipSpaces(source: string, index: number): number {
  let i = index;
  while (i < source.length && /[ \t]/.test(source[i] ?? '')) i += 1;
  return i;
}

function declarationInfo(source: string, keywordAt: number): { declStart: number; exported: boolean } {
  const head = source.slice(Math.max(0, keywordAt - 48), keywordAt);
  const match = head.match(/(export\s+(?:default\s+)?)?(async\s+)?$/);
  return {
    declStart: keywordAt - (match?.[2]?.length ?? 0),
    exported: Boolean(match?.[1]),
  };
}

function readReturn(source: string, index: number): ReturnSite | null {
  if (!isKeyword(source, index, 'return')) return null;
  let j = skipSpaces(source, index + 'return'.length);
  if (j >= source.length || source[j] === ';' || source[j] === '\n' || source[j] === '}') {
    return { returnStart: index, expr: null, exprStart: j, exprEnd: j };
  }
  const exprStart = j;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  while (j < source.length) {
    const char = source[j] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      j = skipString(source, j);
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren = Math.max(0, paren - 1);
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket = Math.max(0, bracket - 1);
    else if (char === '{') {
      if (paren === 0 && bracket === 0 && brace === 0) break;
      brace += 1;
    } else if (char === '}') {
      if (brace === 0 && paren === 0 && bracket === 0) break;
      brace -= 1;
    } else if ((char === ';' || char === '\n') && paren === 0 && bracket === 0 && brace === 0) {
      break;
    }
    j += 1;
  }
  const expr = source.slice(exprStart, j).trim();
  return { returnStart: index, expr: expr || null, exprStart, exprEnd: j };
}

function readFunction(source: string, keywordAt: number): FoundFn | null {
  let j = skipSpaces(source, keywordAt + 'function'.length);
  if (!isIdent(source[j]) || /[0-9]/.test(source[j] ?? '')) return null;
  const nameStart = j;
  while (isIdent(source[j])) j += 1;
  const name = source.slice(nameStart, j);
  j = skipSpaces(source, j);
  if (source[j] !== '(') return null;
  let paren = 0;
  while (j < source.length) {
    const char = source[j] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      j = skipString(source, j);
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') {
      paren -= 1;
      j += 1;
      if (paren === 0) break;
      continue;
    }
    j += 1;
  }
  while (j < source.length && source[j] !== '{') j += 1;
  if (source[j] !== '{') return null;
  const returns: ReturnSite[] = [];
  let depth = 1;
  j += 1;
  while (j < source.length && depth > 0) {
    const noise = skipNoise(source, j);
    if (noise !== j) {
      j = noise;
      continue;
    }
    if (isKeyword(source, j, 'function')) {
      const nested = readFunction(source, j);
      if (nested) {
        j = nested.bodyEnd;
        continue;
      }
    }
    if (isKeyword(source, j, 'return')) {
      const ret = readReturn(source, j);
      if (ret) {
        returns.push(ret);
        j = Math.max(ret.exprEnd, j + 'return'.length);
        continue;
      }
    }
    const char = source[j] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      j = skipString(source, j);
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      j += 1;
      if (depth === 0) {
        const info = declarationInfo(source, keywordAt);
        return {
          name,
          nameStart,
          nameEnd: nameStart + name.length,
          declStart: info.declStart,
          exported: info.exported,
          bodyEnd: j,
          returns,
        };
      }
      continue;
    }
    j += 1;
  }
  return null;
}

function findFunctions(source: string): FoundFn[] {
  const found: FoundFn[] = [];
  let i = 0;
  while (i < source.length) {
    const noise = skipNoise(source, i);
    if (noise !== i) {
      i = noise;
      continue;
    }
    if (isKeyword(source, i, 'function')) {
      const fn = readFunction(source, i);
      if (fn) {
        found.push(fn);
        i = fn.bodyEnd;
        continue;
      }
    }
    i += 1;
  }
  return found;
}

function wrapped(expr: string, wrapper: string): boolean {
  return new RegExp(`^${escapeReg(wrapper)}\\s*\\(`).test(expr.trim());
}

function wrapperFunction(name: string, wrapper: string, prefix: string | undefined): boolean {
  return name === wrapper || (prefix !== undefined && name === `${prefix}${wrapper}`);
}

function nameFailure(fn: FoundFn, item: KnowledgeConstraint): string | null {
  if (!fn.name.startsWith(item.value)) {
    return `Contrainte ${item.id} : le nom « ${fn.name} » doit commencer par ${item.value}.`;
  }
  if (item.appliesTo === 'exported-function' && !fn.exported) {
    return `Contrainte ${item.id} : la fonction « ${fn.name} » doit être exportée.`;
  }
  return null;
}

function codeFailures(
  source: string,
  items: readonly KnowledgeConstraint[],
  requireFunction: boolean,
): ConstraintFailure[] {
  const functions = findFunctions(source);
  const prefix = items.find((item) => item.verify === 'name-prefix')?.value;
  const failures: ConstraintFailure[] = [];
  if (!functions.length) {
    if (requireFunction && items.length) {
      const item = items[0]!;
      failures.push({
        id: item.id,
        verify: item.verify,
        message: `Contrainte ${item.id} : aucune fonction à vérifier, et aucune fonction n’est inventée.`,
      });
    }
    return failures;
  }
  for (const item of items) {
    if (item.verify === 'name-prefix') {
      for (const fn of functions) {
        const message = nameFailure(fn, item);
        if (message) {
          failures.push({ id: item.id, verify: item.verify, message });
          break;
        }
      }
    }
    if (item.verify === 'return-wrapper') {
      for (const fn of functions) {
        if (wrapperFunction(fn.name, item.value, prefix)) continue;
        const broken = fn.returns.find((ret) => ret.expr && !wrapped(ret.expr, item.value));
        if (broken) {
          failures.push({
            id: item.id,
            verify: item.verify,
            message: `Contrainte ${item.id} : chaque return doit s’écrire return ${item.value}( ... ).`,
          });
          break;
        }
      }
    }
  }
  return failures;
}

function fixNames(source: string, item: KnowledgeConstraint): string {
  const functions = findFunctions(source);
  let next = source;
  for (const fn of functions) {
    if (fn.name.startsWith(item.value)) continue;
    const renamed = `${item.value}${fn.name}`;
    if (functions.some((other) => other.name === renamed)) continue;
    next = next.replace(new RegExp(`\\b${escapeReg(fn.name)}\\b`, 'g'), renamed);
  }
  if (item.appliesTo !== 'exported-function') return next;
  const again = findFunctions(next).filter((fn) => fn.name.startsWith(item.value) && !fn.exported);
  for (const fn of again.reverse()) {
    next = `${next.slice(0, fn.declStart)}export ${next.slice(fn.declStart)}`;
  }
  return next;
}

function fixReturns(source: string, item: KnowledgeConstraint, prefix: string | undefined): string {
  const functions = findFunctions(source);
  const sites = functions
    .filter((fn) => !wrapperFunction(fn.name, item.value, prefix))
    .flatMap((fn) => fn.returns)
    .filter((ret) => ret.expr && !wrapped(ret.expr, item.value));
  let next = source;
  for (const ret of sites.reverse()) {
    const expr = ret.expr ?? '';
    next = `${next.slice(0, ret.returnStart)}return ${item.value}(${expr})${next.slice(ret.exprEnd)}`;
  }
  return next;
}

function balanced(source: string): boolean {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const close = new Set(Object.values(pairs));
  const stack: string[] = [];
  let i = 0;
  while (i < source.length) {
    const noise = skipNoise(source, i);
    if (noise !== i) {
      i = noise;
      continue;
    }
    const char = source[i] ?? '';
    if (pairs[char]) stack.push(pairs[char]);
    else if (close.has(char) && stack.pop() !== char) return false;
    i += 1;
  }
  return stack.length === 0;
}

function syntaxOk(source: string, path?: string): boolean {
  if (!balanced(source)) return false;
  if ((path && /\.tsx?$/.test(path)) || /:\s*(?:number|string|boolean|any|void|unknown)\b/.test(source)) {
    return true;
  }
  const js = source.replace(/^\s*export\s+default\s+/gm, '').replace(/^\s*export\s+/gm, '');
  try {
    new Function(js);
    return true;
  } catch {
    return false;
  }
}

function fenceOf(source: string): { open: string; code: string; close: string } | null {
  const trimmed = source.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(trimmed);
  if (!match || match[1] === undefined) return null;
  const lineEnd = trimmed.indexOf('\n');
  return { open: trimmed.slice(0, lineEnd + 1), code: match[1], close: '\n```' };
}

function replyFailures(source: string, items: readonly KnowledgeConstraint[]): ConstraintFailure[] {
  const text = source.trim();
  const failures: ConstraintFailure[] = [];
  for (const item of items) {
    if (item.verify === 'starts-with' && !text.toLowerCase().startsWith(item.value.toLowerCase())) {
      failures.push({
        id: item.id,
        verify: item.verify,
        message: `Contrainte ${item.id} : la réponse doit commencer par ${item.value}.`,
      });
    }
    if (item.verify === 'one-line' && text.includes('\n')) {
      failures.push({
        id: item.id,
        verify: item.verify,
        message: `Contrainte ${item.id} : la réponse doit tenir sur une seule ligne.`,
      });
    }
    if (item.verify === 'reuse-symbol') {
      const name = item.value;
      const declared = new RegExp(
        `(?:function|class|const|let|var)\\s+${escapeReg(name)}\\b|\\b${escapeReg(name)}\\s*=`,
        'i',
      ).test(text);
      if (!text.includes(name) || declared) {
        failures.push({
          id: item.id,
          verify: item.verify,
          message: `Contrainte ${item.id} : appelle ${name} sans le déclarer.`,
        });
      }
    }
  }
  return failures;
}

/** Échecs nommés. Le modèle n’est pas une preuve : ce contrôle ne lit que le texte et les fiches. */
export function checkConstraints(
  source: string,
  records: readonly LearningRecord[],
  options: EnforceOptions = {},
): ConstraintFailure[] {
  const items = applicable(records, options.path);
  const code = codeFailures(source, items.filter((item) => CODE_VERIFIES.has(item.verify)), options.requireFunction === true);
  const replies = replyFailures(source, items.filter((item) => !CODE_VERIFIES.has(item.verify)));
  return [...code, ...replies];
}

function traceOf(
  records: readonly LearningRecord[],
  items: readonly KnowledgeConstraint[],
  functions: number,
  attempts: readonly ConstraintAttempt[],
  failed: readonly ConstraintFailure[],
  ok: boolean,
): KnowledgePathLog[] {
  const explicit = records.filter(explicitRule).length;
  const kinds = items.map((item) => item.verify).join(', ') || 'aucune';
  return [
    {
      stage: 'record',
      ok: true,
      detail: safe(`${explicit} règle(s) explicite(s) lue(s), expériences et méthodes écartées`),
    },
    {
      stage: 'retrieve',
      ok: items.length > 0,
      detail: safe(items.length ? `contraintes ${kinds}` : 'aucune contrainte applicable'),
    },
    {
      stage: 'prompt',
      ok: true,
      detail: safe(
        items.length
          ? 'règle structurée, distincte des méthodes et des exemples'
          : 'pas de règle structurée à ajouter',
      ),
    },
    {
      stage: 'plan',
      ok: true,
      detail: safe(
        items.some((item) => CODE_VERIFIES.has(item.verify))
          ? 'vérifier le nom et le retour, puis éditer seulement ce qui échoue'
          : 'rien à éditer dans le code',
      ),
    },
    { stage: 'code', ok: true, detail: safe(`${functions} fonction(s) au premier niveau`) },
    {
      stage: 'apply',
      ok: attempts.every((attempt) => attempt.changed) || attempts.length === 0,
      detail: safe(
        attempts.length
          ? attempts.map((attempt) => `${attempt.verify} ${attempt.reason}`).join(' ; ')
          : 'aucune édition',
      ),
    },
    {
      stage: 'verify',
      ok,
      detail: safe(ok ? 'contraintes de code tenues' : failed.map((failure) => failure.message).join(' ; ')),
    },
  ];
}

function enforceCode(source: string, records: readonly LearningRecord[], options: EnforceOptions): EnforceResult {
  const items = codeConstraints(records, options.path);
  const requireFunction = options.requireFunction === true;
  const functions = findFunctions(source).length;
  const base = {
    attempts: [] as ConstraintAttempt[],
    held: [] as KnowledgeConstraint[],
    failed: [] as ConstraintFailure[],
  };
  if (!items.length) {
    return {
      source,
      ok: true,
      changed: false,
      ...base,
      trace: traceOf(records, [], functions, [], [], true),
    };
  }
  const initial = codeFailures(source, items, requireFunction);
  if (!initial.length) {
    return {
      source,
      ok: true,
      changed: false,
      held: [...items],
      failed: [],
      attempts: [],
      trace: traceOf(records, items, functions, [], [], true),
    };
  }
  const limit = resolveMaxFixAttempts(options.limit);
  let current = source;
  const attempts: ConstraintAttempt[] = [];
  const prefix = items.find((item) => item.verify === 'name-prefix')?.value;
  const order: ConstraintVerify[] = ['name-prefix', 'return-wrapper'];
  for (let turn = 0; turn < limit; turn += 1) {
    const broken = codeFailures(current, items, requireFunction).sort(
      (a, b) => order.indexOf(a.verify) - order.indexOf(b.verify),
    );
    const target = broken[0];
    if (!target) break;
    const item = items.find((candidate) => candidate.id === target.id);
    if (!item) break;
    let edited = current;
    if (item.verify === 'name-prefix') edited = fixNames(current, item);
    else if (item.verify === 'return-wrapper') edited = fixReturns(current, item, prefix);
    const parsed = edited !== current && syntaxOk(edited, options.path);
    attempts.push({
      constraintId: item.id,
      verify: item.verify,
      broken: safe(target.message),
      changed: parsed,
      reason: edited === current ? 'aucune édition possible' : parsed ? 'édition de la contrainte en échec' : 'syntaxe refusée',
    });
    if (!parsed) break;
    current = edited;
  }
  const failed = codeFailures(current, items, requireFunction);
  const failedIds = new Set(failed.map((failure) => failure.id));
  const ok = failed.length === 0;
  return {
    source: current,
    ok,
    changed: current !== source,
    attempts,
    held: items.filter((item) => !failedIds.has(item.id)),
    failed,
    trace: traceOf(records, items, findFunctions(current).length, attempts, failed, ok),
  };
}

/**
 * Vérifie puis corrige seulement les contraintes de code encore rouges.
 * Une fiche vide, une règle ambiguë ou deux règles contradictoires ne changent rien.
 * Le résultat n’est réussi que si le contrôle final est vert.
 */
export function enforceConstraints(
  source: string,
  records: readonly LearningRecord[],
  options: EnforceOptions = {},
): EnforceResult {
  const fenced = fenceOf(source);
  const inner = fenced ? fenced.code : source;
  const result = enforceCode(inner, records, options);
  if (!fenced || result.source === inner) {
    return result.source === inner ? { ...result, source } : result;
  }
  const wrappedSource = `${fenced.open}${result.source.endsWith('\n') ? result.source : `${result.source}\n`}${fenced.close.trimStart()}`;
  return { ...result, source: wrappedSource, changed: wrappedSource !== source };
}
