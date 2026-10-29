/**
 * Générateur d'exercices (5.0.56). Fichier Node (exécute `node --test`) : pas exporté par l'index.
 *
 * Un modèle ouvert « professeur » (Qwen3-Coder par exemple) invente un exercice complet :
 * objectif, fichier(s) de départ, tests cachés et solution. Jarvis le vérifie sans modèle :
 * forme, imports et API autorisés, tests rouges sur le départ, verts deux fois avec la solution,
 * aucun doublon, rien de proche des missions d'évaluation. Un exercice accepté donne
 * directement un exemple d'entraînement : la consigne et la solution vérifiée, toutes deux
 * écrites par le professeur.
 *
 * Le format de sortie demandé est à balises (`@@ OBJECTIF`, `@@ DEPART chemin`…), pas du JSON :
 * du code dans une chaîne JSON est la première cause d'échec des modèles locaux.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OllamaProvider } from '../providers/ollama.js';
import { createMessage } from '../types.js';
import {
  labBrief,
  nearDuplicate,
  validateLabMission,
  type LabCategory,
  type LabFile,
  type LabLevel,
  type LabMission,
} from './lab.js';
import { evalCatalog } from './labCatalog.js';
import { executeHiddenTests, trainingExampleFromFiles, type LabTrainingExample } from './labRunner.js';

/* ------------------------------------------------------------------ */
/* Demande au professeur                                               */
/* ------------------------------------------------------------------ */

export const GENERATOR_CATEGORIES: readonly LabCategory[] = [
  'logic',
  'functions',
  'collections',
  'strings',
  'json',
  'errors',
  'types',
  'files',
  'bugfix',
  'regression',
];

const CATEGORY_HINTS: Record<LabCategory, string> = {
  logic: 'logique et calcul (conditions, boucles, arithmétique)',
  functions: 'fonctions (fonctions d’ordre supérieur, fermetures, asynchrone simple avec des promesses)',
  collections: 'tableaux, objets, Map et Set (tri, regroupement, recherche, transformation)',
  strings: 'traitement de texte (découpage, nettoyage, formatage, expressions régulières)',
  json: 'lecture et transformation de données JSON ou d’objets imbriqués',
  errors: 'validation des entrées et erreurs (TypeError, RangeError, messages)',
  types: 'vérification et conversion de types JavaScript',
  files: 'lecture ou écriture de fichiers avec node:fs, dans un dossier root reçu en paramètre',
  bugfix: 'correction d’un bogue réel dans du code existant',
  regression: 'correction d’un bogue sans casser une autre fonction du même projet, qui doit rester identique',
};

const LEVEL_HINTS: Record<LabLevel, string> = {
  1: 'Niveau 1 : une seule fonction courte dans un seul fichier, quelques lignes de solution.',
  2: 'Niveau 2 : une fonction avec plusieurs cas particuliers (vide, erreurs, bornes), un seul fichier. Les tests vérifient chaque borne exactement (valeur limite incluse ou exclue) et chaque entrée refusée.',
  3: 'Niveau 3 : OBLIGATOIREMENT deux ou trois fichiers @@ DEPART qui s’importent entre eux ; un bogue à corriger dans l’un, sans changer les autres. Les tests vérifient aussi la partie qui ne doit pas changer.',
};

/** Thèmes de départ, pour varier les exercices (le professeur invente le reste). */
export const GENERATOR_THEMES: readonly string[] = [
  'bibliothèque de prêt',
  'station météo',
  'inventaire de magasin',
  'notes d’élèves',
  'agenda',
  'recettes de cuisine',
  'jeu de cartes',
  'compte bancaire fictif',
  'messagerie',
  'parking',
  'horaires de train',
  'liste de lecture musicale',
  'capteurs de température',
  'panier d’achat',
  'tickets d’assistance',
  'journaux de serveur',
  'adresses web',
  'couleurs',
  'géométrie plane',
  'grilles et matrices',
  'dates et durées',
  'fichier de configuration',
  'tableur CSV',
  'réseau de villes',
  'tournoi sportif',
  'robot à roues',
  'potager',
  'location de vélos',
  'cinéma',
  'quiz',
  'traduction de mots',
  'mots de passe (règles de forme seulement)',
  'conversion d’unités',
  'file d’attente',
  'arbre généalogique',
  'factures',
  'sondage',
  'consommation électrique',
  'jeu de plateau',
  'carnet d’adresses',
];

export const GENERATOR_SYSTEM_PROMPT = [
  'Tu crées des exercices de programmation JavaScript (modules ES, fichiers .mjs, Node 20 ou plus, sans dépendance npm).',
  'Un exercice = un objectif en français, un ou plusieurs fichiers de départ incomplets ou faux, un fichier de tests caché, et la solution.',
  'Règles :',
  '- Les fichiers de départ et de solution sont dans src/ ; le fichier de tests est hidden/<nom>.test.mjs.',
  '- Les tests utilisent node:test et node:assert/strict, importent depuis ../src/, et contiennent au moins trois assertions.',
  '- Les tests doivent échouer sur les fichiers de départ et réussir avec la solution. Le départ garde les mêmes noms exportés que la solution.',
  '- Le départ est volontairement incomplet ou faux (fonction qui rend une valeur fixe, cas oublié, bogue) mais il se charge sans erreur. La SOLUTION est différente du départ.',
  '- Avant de répondre, exécute la solution à la main sur chaque test et vérifie chaque valeur attendue.',
  '- Extension .mjs partout, y compris dans les imports entre fichiers (./autre.mjs, ../src/nom.mjs).',
  '- L’objectif décrit précisément le comportement attendu, y compris les cas particuliers vérifiés par les tests, sans recopier les tests.',
  '- Imports autorisés : node:fs, node:path, node:test, node:assert/strict et les fichiers du projet. Rien d’autre.',
  '- Interdit : réseau, processus, Math.random, l’heure courante, setInterval, process.exit, eval.',
  '- Pour un fichier : la fonction reçoit le dossier root en paramètre ; les tests créent eux-mêmes les fichiers dans join(import.meta.dirname, \'..\').',
  'Réponds uniquement dans ce format, sans rien avant ni après :',
  '@@ OBJECTIF',
  '<une à trois phrases>',
  '@@ CONTRAINTES',
  '- <une contrainte par ligne>',
  '@@ CRITERES',
  '- <un critère vérifiable par ligne>',
  '@@ DEPART src/<fichier>.mjs',
  '<code de départ>',
  '(répète @@ DEPART pour chaque fichier de départ)',
  '@@ TEST hidden/<nom>.test.mjs',
  '<code des tests>',
  '@@ SOLUTION src/<fichier>.mjs',
  '<code complet du fichier corrigé>',
  '(répète @@ SOLUTION pour chaque fichier modifié)',
  '@@ FIN',
].join('\n');

export interface GeneratorSeed {
  level: LabLevel;
  category: LabCategory;
  theme: string;
}

export function generatorPrompt(seed: GeneratorSeed, avoid: readonly string[] = [], sameTheme: readonly string[] = []): string {
  const lines = [
    `Crée un nouvel exercice. ${LEVEL_HINTS[seed.level]}`,
    `Domaine : ${CATEGORY_HINTS[seed.category]}.`,
    `Thème de l’histoire : ${seed.theme}.`,
  ];
  if (avoid.length) {
    lines.push(`Ne reprends pas ces noms de fonctions, déjà utilisés : ${avoid.slice(-40).join(', ')}.`);
  }
  if (sameTheme.length) {
    // 5.0.59 : le professeur reprenait le même sujet sur un thème (conversion de température ×4).
    lines.push(
      'Exercices déjà faits sur ce thème : invente un sujet et une fonction vraiment différents.',
      ...sameTheme.slice(-8).map((goal) => `- ${goal.length > 140 ? `${goal.slice(0, 140)}…` : goal}`),
    );
  }
  return lines.join('\n');
}

/** Tirage déterministe d'une graine (le n-ième exercice d'une série). */
export function seedFor(index: number, salt = 0): GeneratorSeed {
  const mix = (value: number) => {
    let x = (value + salt * 7919) | 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return (x ^ (x >>> 16)) >>> 0;
  };
  // 5.0.59 : plus de niveau 3 et de corrections de code existant (audit de la première nuit :
  // 22 exercices de niveau 3 sur 147, 32 départs avec du vrai code à corriger).
  const levels: LabLevel[] = [1, 2, 2, 3, 3, 3];
  const categories = [...GENERATOR_CATEGORIES, 'bugfix', 'regression'] as const;
  return {
    level: levels[mix(index * 3 + 1) % levels.length]!,
    category: categories[mix(index * 3 + 2) % categories.length]!,
    theme: GENERATOR_THEMES[mix(index * 3 + 3) % GENERATOR_THEMES.length]!,
  };
}

/* ------------------------------------------------------------------ */
/* Lecture de la réponse                                               */
/* ------------------------------------------------------------------ */

export interface ParsedExercise {
  goal: string;
  constraints: string[];
  criteria: string[];
  starters: LabFile[];
  test: LabFile | null;
  solutions: LabFile[];
}

function stripFence(body: string): string {
  const trimmed = body.replace(/^\s*\n/, '').replace(/\s+$/, '');
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

function listLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

/** Lit la réponse à balises. Une section absente reste vide ; la validation tranche ensuite. */
export function parseExercise(text: string): ParsedExercise {
  const result: ParsedExercise = { goal: '', constraints: [], criteria: [], starters: [], test: null, solutions: [] };
  const sections = text.split(/^@@[ \t]*/m).slice(1);
  for (const section of sections) {
    const newline = section.indexOf('\n');
    const header = (newline === -1 ? section : section.slice(0, newline)).trim();
    const body = newline === -1 ? '' : section.slice(newline + 1);
    const [keyword, ...rest] = header.split(/\s+/);
    const key = (keyword ?? '').toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
    const path = rest.join(' ').trim();
    if (key === 'OBJECTIF') result.goal = listLines(body).join(' ');
    else if (key === 'CONTRAINTES') result.constraints = listLines(body);
    else if (key === 'CRITERES') result.criteria = listLines(body);
    else if (key === 'DEPART' && path) result.starters.push(fileOf(path, stripFence(body)));
    else if (key === 'TEST' && path && !result.test) result.test = fileOf(path, stripFence(body));
    else if (key === 'SOLUTION' && path) result.solutions.push(fileOf(path, stripFence(body)));
    else if (key === 'FIN') break;
  }
  return result;
}

function fileOf(path: string, content: string): LabFile {
  return { path: path.replace(/^\.\//, ''), content: content.endsWith('\n') ? content : `${content}\n` };
}

/* ------------------------------------------------------------------ */
/* Contrôles statiques                                                 */
/* ------------------------------------------------------------------ */

const MAX_FILE_CHARS = 8_000;
const FORBIDDEN: { pattern: RegExp; label: string }[] = [
  { pattern: /child_process|node:(?:http|https|net|dgram|worker_threads|cluster|vm)\b/, label: 'module système interdit' },
  { pattern: /\bfetch\s*\(|XMLHttpRequest|WebSocket/, label: 'réseau' },
  { pattern: /process\.exit|process\.kill/, label: 'arrêt du processus' },
  { pattern: /\beval\s*\(|new\s+Function\b/, label: 'code dynamique' },
  { pattern: /Math\.random/, label: 'hasard' },
  { pattern: /setInterval/, label: 'minuterie répétée' },
  { pattern: /Date\.now\s*\(|new\s+Date\s*\(\s*\)/, label: 'heure courante' },
  { pattern: /\b(?:rmSync|rm|unlinkSync|rmdirSync)\s*\(\s*['"`]\//, label: 'suppression absolue' },
];

const ALLOWED_IMPORT = /^(?:node:(?:fs|fs\/promises|path|test|assert|assert\/strict|os|util)|\.{1,2}\/[\w./-]+\.mjs)$/;

function importsOf(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/(?:import\s[^'"`]*?from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) found.push(match[1]!);
  for (const match of code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]/g)) found.push(match[1]!);
  return found;
}

export interface StaticCheck {
  ok: boolean;
  reason: string;
  /** 5.0.57 : sortie des tests (rejets à l'exécution), pour le professeur et pour rejets.jsonl. */
  detail?: string;
}

/**
 * 5.0.57 : `.js` devient `.mjs` (chemins et imports relatifs). Le professeur l'oublie souvent ;
 * en `.js`, Node lirait le fichier comme CommonJS et l'exercice serait refusé pour rien.
 */
export function normalizeExtensions(parsed: ParsedExercise): ParsedExercise {
  const path = (value: string) => value.replace(/\.test\.js$/, '.test.mjs').replace(/^(src\/[\w-]+)\.js$/, '$1.mjs');
  const code = (content: string) =>
    content.replace(/(['"])(\.{1,2}\/[\w./-]+?)\.js\1/g, (_all, quote: string, base: string) => `${quote}${base}.mjs${quote}`);
  const file = (item: LabFile): LabFile => ({ path: path(item.path), content: code(item.content) });
  return {
    ...parsed,
    starters: parsed.starters.map(file),
    test: parsed.test ? file(parsed.test) : null,
    solutions: parsed.solutions.map(file),
  };
}

/**
 * 5.0.59 : le professeur écrit souvent « Le fichier de test est hidden/x.test.mjs » dans les
 * contraintes. Le contrôle des tests cachés refusait tout l'exercice (8 refus la première nuit) ;
 * ces phrases sont retirées, le reste de l'exercice est gardé.
 */
export function scrubTestMentions(parsed: ParsedExercise): ParsedExercise {
  const mentions = (text: string) => /\bhidden\//.test(text) || (parsed.test ? text.includes(parsed.test.path) : false);
  const sentences = (text: string) =>
    text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !mentions(sentence))
      .join(' ');
  return {
    ...parsed,
    goal: mentions(parsed.goal) ? sentences(parsed.goal) : parsed.goal,
    constraints: parsed.constraints.filter((line) => !mentions(line)),
    criteria: parsed.criteria.filter((line) => !mentions(line)),
  };
}

function rejected(reason: string): StaticCheck {
  return { ok: false, reason };
}

export function staticCheck(parsed: ParsedExercise): StaticCheck {
  if (parsed.goal.length < 20) return rejected('objectif absent ou trop court');
  if (parsed.goal.length > 700) return rejected('objectif trop long');
  if (parsed.criteria.length === 0) return rejected('aucun critère');
  if (parsed.starters.length === 0 || parsed.starters.length > 3) return rejected('nombre de fichiers de départ hors de 1 à 3');
  if (!parsed.test) return rejected('fichier de tests absent');
  if (parsed.solutions.length === 0) return rejected('solution absente');
  const starterPaths = new Set(parsed.starters.map((item) => item.path));
  if (starterPaths.size !== parsed.starters.length) return rejected('fichier de départ en double');
  for (const item of parsed.starters) {
    if (!/^src\/[\w-]+\.mjs$/.test(item.path)) return rejected(`chemin de départ refusé : ${item.path}`);
  }
  if (!/^hidden\/[\w-]+\.test\.mjs$/.test(parsed.test.path)) return rejected(`chemin de test refusé : ${parsed.test.path}`);
  for (const item of parsed.solutions) {
    if (!starterPaths.has(item.path)) return rejected(`solution hors des fichiers de départ : ${item.path}`);
  }
  const all = [...parsed.starters, parsed.test, ...parsed.solutions];
  for (const item of all) {
    if (item.content.length > MAX_FILE_CHARS) return rejected(`fichier trop long : ${item.path}`);
    for (const rule of FORBIDDEN) if (rule.pattern.test(item.content)) return rejected(`${rule.label} dans ${item.path}`);
    for (const specifier of importsOf(item.content)) {
      if (!ALLOWED_IMPORT.test(specifier)) return rejected(`import refusé dans ${item.path} : ${specifier}`);
    }
  }
  const asserts = (parsed.test.content.match(/\bassert\.\w+\s*\(/g) ?? []).length;
  if (asserts < 3) return rejected('moins de trois assertions');
  if (!/from\s*['"]\.\.\/src\//.test(parsed.test.content)) return rejected('les tests n’importent pas ../src/');
  const changed = parsed.solutions.filter((item) => parsed.starters.find((s) => s.path === item.path)?.content !== item.content);
  if (changed.length === 0) return rejected('la solution est identique au départ');
  return { ok: true, reason: '' };
}

/* ------------------------------------------------------------------ */
/* Mission, doublons, contamination                                    */
/* ------------------------------------------------------------------ */

function hash6(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).padStart(6, '0').slice(-6);
}

function slug(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Niveau réellement produit : plusieurs fichiers = 3 ; un seul fichier ne dépasse pas 2, quelle que soit la demande. */
export function producedLevel(parsed: ParsedExercise, seed: GeneratorSeed): LabLevel {
  if (parsed.starters.length >= 2) return 3;
  return seed.level === 3 ? 2 : seed.level;
}

export function missionFromParsed(parsed: ParsedExercise, seed: GeneratorSeed): LabMission {
  const base = parsed.starters[0]!.path.replace(/^src\//, '').replace(/\.mjs$/, '');
  const level = producedLevel(parsed, seed);
  return {
    id: `g${level}-${slug(base) || 'exercice'}-${hash6(parsed.goal + parsed.test!.content)}`,
    level,
    category: seed.category,
    difficulty: level,
    split: 'development',
    goal: parsed.goal,
    constraints: parsed.constraints,
    passCriteria: parsed.criteria,
    starterFiles: parsed.starters,
    hiddenTests: [parsed.test!],
  };
}

/** Noms exportés des fichiers (fonctions et constantes). */
export function exportedNames(files: readonly LabFile[]): string[] {
  const names = new Set<string>();
  for (const item of files) {
    for (const match of item.content.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]!);
  }
  return [...names];
}

let evalIndex: { goals: { id: string; goal: string; category: LabCategory }[]; names: Set<string> } | null = null;
function evalReference() {
  if (!evalIndex) {
    const missions = evalCatalog().map((entry) => entry.mission);
    evalIndex = {
      goals: missions.map((mission) => ({ id: mission.id, goal: mission.goal, category: mission.category })),
      names: new Set(missions.flatMap((mission) => exportedNames(mission.starterFiles))),
    };
  }
  return evalIndex;
}

/** Exercice déjà accepté, tel que le générateur le compare (5.0.59 : tests et thème facultatifs). */
export type AcceptedExercise = Pick<LabMission, 'id' | 'goal' | 'category' | 'starterFiles'> & {
  hiddenTests?: readonly LabFile[];
  theme?: string;
};

const SIMILARITY_STOP = new Set([
  'test', 'assert', 'import', 'from', 'node', 'const', 'strict', 'equal', 'deepequal', 'strictequal', 'throws',
  'return', 'function', 'export', 'await', 'async', 'join', 'dirname', 'meta', 'writefile', 'promises', 'path',
]);

function similarityTokens(text: string): Set<string> {
  return new Set(
    (text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .match(/[a-z]{4,}/g) ?? []).filter((word) => !SIMILARITY_STOP.has(word)),
  );
}

/**
 * 5.0.59 : ressemblance de deux exercices (mots de l'objectif et des tests, 0 à 1).
 * Calibrée sur la première nuit (147 exercices) : au-dessus de 0,40, ou de 0,30 avec un
 * nom exporté commun, ce sont des quasi-doublons (conversion de température ×4, calcul de durée ×2…).
 */
export function exerciseSimilarity(
  left: Pick<AcceptedExercise, 'goal' | 'hiddenTests'>,
  right: Pick<AcceptedExercise, 'goal' | 'hiddenTests'>,
): number {
  const words = (item: Pick<AcceptedExercise, 'goal' | 'hiddenTests'>) =>
    similarityTokens(`${item.goal} ${(item.hiddenTests ?? []).map((file) => file.content).join(' ')}`);
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export const DUPLICATE_SIMILARITY = { alone: 0.4, sameName: 0.3 };

/**
 * Un exercice généré ne doit ressembler à aucune mission d'évaluation (sinon le banc
 * mesurerait la mémoire du futur modèle) ni à un exercice déjà accepté.
 */
export function noveltyCheck(mission: LabMission, accepted: readonly AcceptedExercise[]): StaticCheck {
  const reference = evalReference();
  for (const name of exportedNames(mission.starterFiles)) {
    if (reference.names.has(name)) return rejected(`nom ${name} déjà utilisé par l’évaluation`);
  }
  for (const item of reference.goals) {
    const evalLike = { id: item.id, goal: item.goal, category: mission.category };
    if (nearDuplicate({ id: mission.id, goal: mission.goal, category: mission.category }, evalLike)) {
      return rejected(`trop proche de l’évaluation (${item.id})`);
    }
  }
  const names = new Set(exportedNames(mission.starterFiles));
  for (const other of accepted) {
    if (other.id === mission.id || nearDuplicate(mission, other)) return rejected(`doublon de ${other.id}`);
    const sameName = exportedNames(other.starterFiles).some((name) => names.has(name));
    if (sameName && nearDuplicate({ ...mission, category: 'logic' }, { ...other, category: 'logic' })) {
      return rejected(`doublon de ${other.id}`);
    }
    const similarity = exerciseSimilarity(mission, other);
    if (similarity >= DUPLICATE_SIMILARITY.alone || (sameName && similarity >= DUPLICATE_SIMILARITY.sameName)) {
      return rejected(`doublon de ${other.id} (ressemblance ${similarity.toFixed(2)})`);
    }
  }
  return { ok: true, reason: '' };
}

/* ------------------------------------------------------------------ */
/* Exécution : rouge au départ, vert deux fois avec la solution        */
/* ------------------------------------------------------------------ */

function countTests(output: string): { total: number | null; failed: number | null } {
  const total = /(?:ℹ|#)\s+tests\s+(\d+)/.exec(output);
  const failed = /(?:ℹ|#)\s+fail\s+(\d+)/.exec(output);
  return { total: total ? Number(total[1]) : null, failed: failed ? Number(failed[1]) : null };
}

async function writeTree(root: string, files: readonly LabFile[]): Promise<void> {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const item of files) {
    const dest = join(root, item.path);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, item.content);
  }
}

/** Sortie de test lisible : sans chemins temporaires, bornée. */
function testDetail(output: string, workParent: string): string {
  const cleaned = output.split(workParent).join('.').replace(/\/verify-[\w-]+?-\d+/g, '');
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim() && !/^#\s+(?:suites|cancelled|skipped|todo|duration_ms)\b/.test(line));
  return lines.join('\n').slice(-2_000);
}

/* ------------------------------------------------------------------ */
/* 5.0.59 : solidité des tests (petites erreurs glissées)             */
/* ------------------------------------------------------------------ */

/** Une petite erreur glissée dans la solution : les tests doivent la voir. */
export interface Mutant {
  path: string;
  line: number;
  label: string;
  content: string;
}

const MUTATIONS: { pattern: RegExp; replace: string; label: string }[] = [
  { pattern: / >= /, replace: ' > ', label: '>= devient >' },
  { pattern: / <= /, replace: ' < ', label: '<= devient <' },
  { pattern: / > /, replace: ' >= ', label: '> devient >=' },
  { pattern: / < /, replace: ' <= ', label: '< devient <=' },
  { pattern: / === /, replace: ' !== ', label: '=== devient !==' },
  { pattern: / !== /, replace: ' === ', label: '!== devient ===' },
  { pattern: / && /, replace: ' || ', label: '&& devient ||' },
  { pattern: / \|\| /, replace: ' && ', label: '|| devient &&' },
  { pattern: / \+ 1\b/, replace: ' + 2', label: '+ 1 devient + 2' },
  { pattern: / - 1\b/, replace: ' - 2', label: '- 1 devient - 2' },
  { pattern: /\breturn true\b/, replace: 'return false', label: 'return true devient return false' },
  { pattern: /\breturn false\b/, replace: 'return true', label: 'return false devient return true' },
  { pattern: /\.trim\(\)/, replace: '', label: '.trim() retiré' },
  { pattern: /\.toLowerCase\(\)/, replace: '', label: '.toLowerCase() retiré' },
  { pattern: /Math\.round\(/, replace: 'Math.floor(', label: 'Math.round devient Math.floor' },
  { pattern: /\bthrow new \w*Error\(.*?\);/, replace: ';', label: 'throw retiré' },
];

/** Partie d'une ligne hors chaînes et commentaire de fin (les mutations n'y touchent pas). */
function codePart(line: string): string {
  let out = '';
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (quote) {
      if (char === '\\') {
        out += '  ';
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        out += char;
      } else {
        out += ' ';
      }
      continue;
    }
    if (char === '/' && line[index + 1] === '/') break;
    if (char === '"' || char === "'" || char === '`') quote = char;
    out += char;
  }
  return out.padEnd(line.length, ' ');
}

/**
 * Au plus `limit` mutants des fichiers changés : une règle par mutant, à sa première
 * ligne de code (hors import, commentaire et chaîne). Déterministe, sans modèle.
 */
export function mutantsOf(files: readonly LabFile[], limit = 8): Mutant[] {
  const out: Mutant[] = [];
  for (const rule of MUTATIONS) {
    if (out.length >= limit) break;
    search: for (const file of files) {
      const lines = file.content.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (/^\s*(?:import\b|\/\/|\*|\/\*)/.test(line)) continue;
        const match = rule.pattern.exec(codePart(line));
        if (!match) continue;
        const mutated = line.slice(0, match.index) + match[0].replace(rule.pattern, rule.replace) + line.slice(match.index + match[0].length);
        if (mutated === line) continue;
        const copy = [...lines];
        copy[index] = mutated;
        out.push({ path: file.path, line: index + 1, label: rule.label, content: copy.join('\n') });
        break search;
      }
    }
  }
  return out;
}

export interface StrengthResult {
  total: number;
  killed: number;
  /** Mutations que les tests n'ont pas vues (« src/x.mjs, ligne 4 : > devient >= »). */
  survivors: string[];
}

/** Rejoue les tests sur chaque mutant de la solution ; un mutant est « vu » si les tests échouent. */
export async function testStrength(
  mission: LabMission,
  solutions: readonly LabFile[],
  workParent: string,
  limit = 8,
): Promise<StrengthResult> {
  const starters = new Map(mission.starterFiles.map((item) => [item.path, item]));
  const changed = solutions.filter((item) => starters.get(item.path)?.content !== item.content);
  const mutants = mutantsOf(changed, limit);
  const root = join(workParent, `${mission.id}-mutant`);
  const survivors: string[] = [];
  let killed = 0;
  try {
    for (const mutant of mutants) {
      const files = new Map(starters);
      for (const item of solutions) files.set(item.path, item);
      files.set(mutant.path, { path: mutant.path, content: mutant.content });
      await writeTree(root, [...files.values()]);
      const run = await executeHiddenTests(root, mission);
      if (run.exitCode !== 0 || run.broken) killed += 1;
      else survivors.push(`${mutant.path}, ligne ${mutant.line} : ${mutant.label}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  return { total: mutants.length, killed, survivors };
}

/** Seuil de refus : avec au moins 3 mutants, les tests doivent en voir au moins un tiers. */
export const MIN_TEST_STRENGTH = { mutants: 3, ratio: 1 / 3 };

export function weakTests(strength: StrengthResult): boolean {
  return strength.total >= MIN_TEST_STRENGTH.mutants && strength.killed / strength.total < MIN_TEST_STRENGTH.ratio;
}

export async function runtimeCheck(mission: LabMission, solutions: readonly LabFile[], workParent: string): Promise<StaticCheck> {
  const root = join(workParent, mission.id);
  try {
    await writeTree(root, mission.starterFiles);
    const before = await executeHiddenTests(root, mission);
    const counted = countTests(before.output);
    if (before.broken || before.exitCode === null || counted.total === null || counted.total === 0) {
      return { ...rejected('tests cassés sur le départ (import, syntaxe ou délai)'), detail: testDetail(before.output, workParent) };
    }
    if (before.exitCode === 0 || !counted.failed) return rejected('les tests passent déjà sur le départ');
    if (counted.failed === counted.total && /SyntaxError|ReferenceError|does not provide an export/.test(before.output)) {
      return { ...rejected('départ illisible (erreur de syntaxe ou export manquant)'), detail: testDetail(before.output, workParent) };
    }
    const solved = new Map(mission.starterFiles.map((item) => [item.path, item]));
    for (const item of solutions) solved.set(item.path, item);
    for (let pass = 1; pass <= 2; pass += 1) {
      await writeTree(root, [...solved.values()]);
      const after = await executeHiddenTests(root, mission);
      const afterCount = countTests(after.output);
      if (after.exitCode !== 0 || afterCount.failed !== 0 || !afterCount.total) {
        return {
          ...rejected(pass === 1 ? 'la solution ne passe pas ses propres tests' : 'tests instables (rouges au second passage)'),
          detail: testDetail(after.output, workParent),
        };
      }
    }
    return { ok: true, reason: '' };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* Un exercice de bout en bout                                         */
/* ------------------------------------------------------------------ */

export interface GeneratedExercise {
  mission: LabMission;
  solution: LabFile[];
  provenance: { model: string; seed: GeneratorSeed; at: string };
  /** 5.0.59 : petites erreurs glissées dans la solution, et combien les tests en ont vues. */
  strength?: { total: number; killed: number };
}

export type GenerationOutcome =
  | { ok: true; exercise: GeneratedExercise; example: LabTrainingExample; repaired?: boolean }
  | { ok: false; reason: string; raw: string; detail?: string; firstReason?: string; firstDetail?: string; firstRaw?: string };

export interface TeacherTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TeacherModel {
  name: string;
  /** `history` (5.0.57) : échanges précédents, pour une demande de correction. */
  complete(input: { system: string; prompt: string; history?: readonly TeacherTurn[]; signal?: AbortSignal }): Promise<string>;
}

/** Un refus qui se corrige en montrant le problème au professeur (pas un doublon ni une erreur du modèle). */
export function repairable(reason: string): boolean {
  return !/^doublon|déjà utilisé par l’évaluation|trop proche de l’évaluation|^erreur du modèle|^délai/.test(reason);
}

export function repairPrompt(reason: string, detail?: string): string {
  if (/^tests trop faibles/.test(reason)) {
    return [
      `Ton exercice a été refusé par la vérification automatique : ${reason}.`,
      detail ? `Erreurs glissées dans ta solution que tes tests n’ont pas vues :\n${detail}` : '',
      'Ajoute des assertions qui échouent pour ces erreurs : valeur exactement à la limite, juste à côté, entrées refusées.',
      'Garde le même objectif et la même solution, précise l’objectif si une limite n’y est pas dite. Vérifie chaque valeur attendue à la main.',
      'Renvoie l’exercice complet dans le même format, de @@ OBJECTIF à @@ FIN.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `Ton exercice a été refusé par la vérification automatique : ${reason}.`,
    detail ? `Sortie des tests :\n\`\`\`\n${detail}\n\`\`\`` : '',
    'Corrige-le et renvoie l’exercice complet dans le même format, de @@ OBJECTIF à @@ FIN.',
    'Garde le même objectif. Les tests doivent échouer sur le départ (qui se charge sans erreur) et réussir avec la solution, qui doit être différente du départ.',
    'Corrige d’abord la solution ; ne change un test que s’il contredit l’objectif.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Vérifie un texte de professeur. Séparé de l'appel au modèle pour être testé sans modèle. */
export async function acceptExercise(input: {
  text: string;
  seed: GeneratorSeed;
  model: string;
  accepted: readonly AcceptedExercise[];
  workParent: string;
  now?: Date;
  /** 5.0.59 : contrôle de solidité des tests (défaut : oui). */
  strength?: boolean;
}): Promise<GenerationOutcome> {
  const parsed = scrubTestMentions(normalizeExtensions(parseExercise(input.text)));
  const shape = staticCheck(parsed);
  if (!shape.ok) return { ok: false, reason: shape.reason, raw: input.text };
  const mission = missionFromParsed(parsed, input.seed);
  const valid = validateLabMission(mission);
  if (!valid.ok) return { ok: false, reason: valid.reason, raw: input.text };
  const brief = JSON.stringify(labBrief(mission));
  for (const item of parsed.solutions) {
    const starter = parsed.starters.find((s) => s.path === item.path);
    if (starter?.content !== item.content && brief.includes(JSON.stringify(item.content.trim()).slice(1, -1))) {
      return { ok: false, reason: 'la solution apparaît dans la consigne', raw: input.text };
    }
  }
  const novel = noveltyCheck(mission, input.accepted);
  if (!novel.ok) return { ok: false, reason: novel.reason, raw: input.text };
  const runtime = await runtimeCheck(mission, parsed.solutions, input.workParent);
  if (!runtime.ok) {
    return { ok: false, reason: runtime.reason, raw: input.text, ...(runtime.detail ? { detail: runtime.detail } : {}) };
  }
  let strength: StrengthResult | null = null;
  if (input.strength !== false) {
    strength = await testStrength(mission, parsed.solutions, input.workParent);
    if (weakTests(strength)) {
      return {
        ok: false,
        reason: `tests trop faibles (${strength.killed} erreur(s) glissée(s) vue(s) sur ${strength.total})`,
        raw: input.text,
        detail: strength.survivors.map((line) => `- ${line}`).join('\n'),
      };
    }
  }
  const starters = new Map(mission.starterFiles.map((item) => [item.path, item.content]));
  const changed = parsed.solutions.filter((item) => starters.get(item.path) !== item.content);
  const exercise: GeneratedExercise = {
    mission,
    solution: parsed.solutions,
    provenance: { model: input.model, seed: input.seed, at: (input.now ?? new Date()).toISOString() },
    ...(strength ? { strength: { total: strength.total, killed: strength.killed } } : {}),
  };
  const example = trainingExampleFromFiles(mission, changed, {
    model: input.model,
    attempts: 1,
    source: 'generated',
  });
  return { ok: true, exercise, example };
}

export async function generateExercise(input: {
  teacher: TeacherModel;
  seed: GeneratorSeed;
  accepted: readonly AcceptedExercise[];
  workParent?: string;
  signal?: AbortSignal;
  /** 5.0.57 : une demande de correction au professeur après un refus corrigeable. Défaut : oui. */
  repair?: boolean;
  /** 5.0.59 : contrôle de solidité des tests. Défaut : oui. */
  strength?: boolean;
}): Promise<GenerationOutcome> {
  const avoid = [...new Set(input.accepted.flatMap((mission) => exportedNames(mission.starterFiles)))];
  const sameTheme = input.accepted.filter((item) => item.theme === input.seed.theme).map((item) => item.goal);
  const prompt = generatorPrompt(input.seed, avoid, sameTheme);
  const ask = async (request: { prompt: string; history?: readonly TeacherTurn[] }): Promise<string | { error: string }> => {
    try {
      return await input.teacher.complete({
        system: GENERATOR_SYSTEM_PROMPT,
        ...request,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      return { error: `erreur du modèle : ${error instanceof Error ? error.message.slice(0, 160) : String(error)}` };
    }
  };
  const first = await ask({ prompt });
  if (typeof first !== 'string') return { ok: false, reason: first.error, raw: '' };
  const workParent = input.workParent ?? (await mkdtemp(join(tmpdir(), 'jarvis-gen-')));
  try {
    const check = (text: string) =>
      acceptExercise({
        text,
        seed: input.seed,
        model: input.teacher.name,
        accepted: input.accepted,
        workParent,
        ...(input.strength === false ? { strength: false } : {}),
      });
    const outcome = await check(first);
    if (outcome.ok || input.repair === false || !repairable(outcome.reason)) return outcome;
    const second = await ask({
      prompt: repairPrompt(outcome.reason, outcome.detail),
      history: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: first },
      ],
    });
    const first$ = {
      firstReason: outcome.reason,
      firstRaw: first,
      ...(outcome.detail ? { firstDetail: outcome.detail } : {}),
    };
    if (typeof second !== 'string') return { ...outcome, ...first$, reason: second.error };
    const retried = await check(second);
    return retried.ok ? { ...retried, repaired: true } : { ...retried, ...first$ };
  } finally {
    if (!input.workParent) await rm(workParent, { recursive: true, force: true });
  }
}

/** Professeur servi par Ollama (aucun outil, texte seul, réflexion coupée). */
export function ollamaTeacher(
  model: string,
  options: { baseUrl?: string; numCtx?: number; temperature?: number; maxTokens?: number; think?: boolean | null } = {},
): TeacherModel {
  const think = options.think === undefined ? false : options.think;
  const provider = new OllamaProvider({
    provider: 'ollama',
    model,
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:11434',
    ollama: {
      numCtx: options.numCtx ?? 8192,
      keepAlive: '30m',
      ...(think === null ? {} : { think }),
      recoverToolCalls: true,
    },
  });
  return {
    name: model,
    async complete({ system, prompt, history, signal }) {
      let text = '';
      for await (const event of provider.streamChat({
        system,
        messages: [...(history ?? []).map((turn) => createMessage(turn.role, turn.content)), createMessage('user', prompt)],
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens ?? 3000,
        ...(signal ? { signal } : {}),
      })) {
        if (event.type === 'text') text += event.delta;
        if (event.type === 'error') throw new Error(event.message);
      }
      return text;
    },
  };
}
