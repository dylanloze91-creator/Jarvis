/**
 * Catalogue du laboratoire (5.0.55). Pur : pas de modèle, pas de disque.
 *
 * Deux jeux séparés, jamais mélangés :
 * - `train` : 104 missions de mesure étendue (5.0.56 : elles ne deviennent plus des exemples
 *   d'entraînement, voir `trainable`) ;
 * - `eval` : missions tenues à l'écart pour mesurer le modèle (les 9 de `referenceMissions()`
 *   plus celles de ce fichier marquées `validation`). Une mission d'évaluation n'entre jamais
 *   dans le jeu d'entraînement : sinon le banc mesurerait la mémoire du modèle, pas son niveau.
 *
 * Chaque mission a une solution de référence. Elle ne sert qu'à vérifier la mission
 * (tests rouges sur le fichier de départ, verts avec la solution) : le modèle ne la voit jamais.
 */
import { referenceMissions, type LabCategory, type LabFile, type LabLevel, type LabMission, type LabSplit } from './lab.js';

export interface CatalogEntry {
  mission: LabMission;
  /** Fichiers de la solution de référence (chemins du départ). */
  solution: LabFile[];
}

function file(path: string, content: string): LabFile {
  return { path, content: content.endsWith('\n') ? content : `${content}\n` };
}

function testFile(fn: string, from: string, lines: readonly string[], extraImports: readonly string[] = []): string {
  const head = [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    ...extraImports,
    `import { ${fn} } from '../${from}';`,
  ];
  const body = lines.map((line, index) => {
    const asyncFn = /\bawait\b/.test(line) ? 'async ' : '';
    return `test('cas ${index + 1}', ${asyncFn}() => {\n  ${line}\n});`;
  });
  return `${[...head, ...body].join('\n')}\n`;
}

interface FnSpec {
  id: string;
  level: LabLevel;
  category: LabCategory;
  split?: LabSplit;
  goal: string;
  constraints?: string[];
  criteria: string[];
  fn: string;
  params: string;
  stub: string;
  tests: string[];
  /** Corps complet du fichier solution. */
  solution: string;
  extraImports?: string[];
  extraStarters?: LabFile[];
}

/** Mission « une fonction dans un fichier ». */
function fnMission(spec: FnSpec): CatalogEntry {
  const path = `src/${spec.fn}.mjs`;
  return {
    mission: {
      id: spec.id,
      level: spec.level,
      category: spec.category,
      difficulty: spec.level,
      split: spec.split ?? 'development',
      goal: spec.goal,
      constraints: [...(spec.constraints ?? []), `Ne change pas le nom ${spec.fn}.`],
      passCriteria: spec.criteria,
      starterFiles: [file(path, `export function ${spec.fn}(${spec.params}) {\n  return ${spec.stub};\n}\n`), ...(spec.extraStarters ?? [])],
      hiddenTests: [file(`hidden/${spec.fn}.test.mjs`, testFile(spec.fn, path, spec.tests, spec.extraImports))],
    },
    solution: [file(path, spec.solution)],
  };
}

interface MultiSpec {
  id: string;
  level: LabLevel;
  category: LabCategory;
  split?: LabSplit;
  goal: string;
  constraints: string[];
  criteria: string[];
  starters: LabFile[];
  hidden: LabFile;
  solution: LabFile[];
}

/** Mission sur plusieurs fichiers (correction, non-régression). */
function multiMission(spec: MultiSpec): CatalogEntry {
  return {
    mission: {
      id: spec.id,
      level: spec.level,
      category: spec.category,
      difficulty: spec.level,
      split: spec.split ?? 'development',
      goal: spec.goal,
      constraints: spec.constraints,
      passCriteria: spec.criteria,
      starterFiles: spec.starters,
      hiddenTests: [spec.hidden],
    },
    solution: spec.solution,
  };
}

const ROOT = "const root = join(import.meta.dirname, '..');";
const FS_IMPORTS = ["import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';", "import { join } from 'node:path';"];

/* ------------------------------------------------------------------ */
/* Entraînement : niveau 1                                             */
/* ------------------------------------------------------------------ */

const TRAIN_L1: CatalogEntry[] = [
  fnMission({
    id: 't1-is-even', level: 1, category: 'logic',
    goal: 'isEven(n) vaut true si l’entier n est pair, false sinon. Les négatifs et zéro sont gérés.',
    criteria: ['Zéro est pair.', 'Un négatif pair est pair.'],
    fn: 'isEven', params: 'n', stub: 'false',
    tests: ['assert.equal(isEven(4), true);', 'assert.equal(isEven(7), false);', 'assert.equal(isEven(-2), true);', 'assert.equal(isEven(0), true);'],
    solution: 'export function isEven(n) {\n  return n % 2 === 0;\n}',
  }),
  fnMission({
    id: 't1-max-three', level: 1, category: 'functions',
    goal: 'maxOfThree(a, b, c) rend le plus grand des trois nombres.',
    criteria: ['Le plus grand gagne quelle que soit sa position.'],
    fn: 'maxOfThree', params: 'a, b, c', stub: 'a',
    tests: ['assert.equal(maxOfThree(1, 2, 3), 3);', 'assert.equal(maxOfThree(9, 2, 3), 9);', 'assert.equal(maxOfThree(1, 8, 3), 8);', 'assert.equal(maxOfThree(-5, -2, -9), -2);'],
    solution: 'export function maxOfThree(a, b, c) {\n  return Math.max(a, b, c);\n}',
  }),
  fnMission({
    id: 't1-abs-diff', level: 1, category: 'functions',
    goal: 'absDiff(a, b) rend l’écart absolu entre deux nombres : jamais négatif.',
    criteria: ['L’ordre des arguments ne change pas le résultat.'],
    fn: 'absDiff', params: 'a, b', stub: 'a - b',
    tests: ['assert.equal(absDiff(3, 10), 7);', 'assert.equal(absDiff(10, 3), 7);', 'assert.equal(absDiff(-4, 4), 8);', 'assert.equal(absDiff(5, 5), 0);'],
    solution: 'export function absDiff(a, b) {\n  return Math.abs(a - b);\n}',
  }),
  fnMission({
    id: 't1-fizz-word', level: 1, category: 'logic',
    goal: 'fizzWord(n) rend "FizzBuzz" pour un multiple de 3 et de 5, "Fizz" pour un multiple de 3, "Buzz" pour un multiple de 5, et sinon le nombre écrit en texte.',
    criteria: ['Le cas des deux multiples passe avant les autres.', 'Un autre nombre devient une chaîne.'],
    fn: 'fizzWord', params: 'n', stub: "''",
    tests: ["assert.equal(fizzWord(15), 'FizzBuzz');", "assert.equal(fizzWord(9), 'Fizz');", "assert.equal(fizzWord(10), 'Buzz');", "assert.equal(fizzWord(7), '7');"],
    solution: "export function fizzWord(n) {\n  if (n % 15 === 0) return 'FizzBuzz';\n  if (n % 3 === 0) return 'Fizz';\n  if (n % 5 === 0) return 'Buzz';\n  return String(n);\n}",
  }),
  fnMission({
    id: 't1-leap-year', level: 1, category: 'logic',
    goal: 'leapYear(y) dit si l’année est bissextile : divisible par 4, sauf les siècles, sauf ceux divisibles par 400.',
    criteria: ['1900 n’est pas bissextile.', '2000 l’est.'],
    fn: 'leapYear', params: 'y', stub: 'false',
    tests: ['assert.equal(leapYear(2024), true);', 'assert.equal(leapYear(2023), false);', 'assert.equal(leapYear(1900), false);', 'assert.equal(leapYear(2000), true);'],
    solution: 'export function leapYear(y) {\n  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;\n}',
  }),
  fnMission({
    id: 't1-letter-grade', level: 1, category: 'logic',
    goal: 'grade(score) rend la lettre d’une note sur 100 : "A" à partir de 90, "B" à partir de 75, "C" à partir de 50, "F" en dessous.',
    criteria: ['Les seuils sont inclus.'],
    fn: 'grade', params: 'score', stub: "'F'",
    tests: ["assert.equal(grade(95), 'A');", "assert.equal(grade(90), 'A');", "assert.equal(grade(75), 'B');", "assert.equal(grade(50), 'C');", "assert.equal(grade(49), 'F');"],
    solution: "export function grade(score) {\n  if (score >= 90) return 'A';\n  if (score >= 75) return 'B';\n  if (score >= 50) return 'C';\n  return 'F';\n}",
  }),
  fnMission({
    id: 't1-celsius-fahrenheit', level: 1, category: 'functions',
    goal: 'toFahrenheit(c) convertit des degrés Celsius en Fahrenheit (c × 9 / 5 + 32).',
    criteria: ['0 °C vaut 32 °F.', '100 °C vaut 212 °F.'],
    fn: 'toFahrenheit', params: 'c', stub: 'c',
    tests: ['assert.equal(toFahrenheit(0), 32);', 'assert.equal(toFahrenheit(100), 212);', 'assert.equal(toFahrenheit(-40), -40);'],
    solution: 'export function toFahrenheit(c) {\n  return (c * 9) / 5 + 32;\n}',
  }),
  fnMission({
    id: 't1-count-vowels', level: 1, category: 'strings',
    goal: 'countVowels(text) compte les voyelles a, e, i, o, u, en minuscule comme en majuscule. Le y ne compte pas.',
    criteria: ['Les majuscules comptent.', 'Une chaîne vide donne 0.'],
    fn: 'countVowels', params: 'text', stub: '0',
    tests: ["assert.equal(countVowels('banane'), 3);", "assert.equal(countVowels('AEIOU'), 5);", "assert.equal(countVowels('rythm'), 0);", "assert.equal(countVowels(''), 0);"],
    solution: "export function countVowels(text) {\n  let count = 0;\n  for (const ch of text.toLowerCase()) if ('aeiou'.includes(ch)) count += 1;\n  return count;\n}",
  }),
  fnMission({
    id: 't1-reverse-words', level: 1, category: 'strings',
    goal: 'reverseWords(text) inverse l’ordre des mots. Les espaces multiples et ceux des bords disparaissent : un seul espace entre deux mots.',
    criteria: ['Les mots gardent leurs lettres.', 'Une chaîne vide reste vide.'],
    fn: 'reverseWords', params: 'text', stub: 'text',
    tests: ["assert.equal(reverseWords('un deux trois'), 'trois deux un');", "assert.equal(reverseWords('  a   b '), 'b a');", "assert.equal(reverseWords(''), '');"],
    solution: "export function reverseWords(text) {\n  return text.trim().split(/\\s+/).filter(Boolean).reverse().join(' ');\n}",
  }),
  fnMission({
    id: 't1-capitalize-first', level: 1, category: 'strings',
    goal: 'capitalize(text) met la première lettre en majuscule et laisse le reste tel quel. Une chaîne vide reste vide.',
    criteria: ['Le reste du texte ne change pas.'],
    fn: 'capitalize', params: 'text', stub: 'text',
    tests: ["assert.equal(capitalize('bonjour'), 'Bonjour');", "assert.equal(capitalize('éTÉ'), 'ÉTÉ');", "assert.equal(capitalize('a'), 'A');", "assert.equal(capitalize(''), '');"],
    solution: 'export function capitalize(text) {\n  return text ? text[0].toUpperCase() + text.slice(1) : text;\n}',
  }),
  fnMission({
    id: 't1-palindrome', level: 1, category: 'strings',
    goal: 'isPalindrome(text) dit si le texte se lit pareil dans les deux sens, sans tenir compte de la casse ni des caractères qui ne sont pas des lettres ou des chiffres.',
    criteria: ['Espaces et ponctuation sont ignorés.', 'La casse est ignorée.'],
    fn: 'isPalindrome', params: 'text', stub: 'false',
    tests: ["assert.equal(isPalindrome('Kayak'), true);", "assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true);", "assert.equal(isPalindrome('bonjour'), false);", "assert.equal(isPalindrome(''), true);"],
    solution: "export function isPalindrome(text) {\n  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');\n  return clean === [...clean].reverse().join('');\n}",
  }),
  fnMission({
    id: 't1-repeat-char', level: 1, category: 'strings',
    goal: 'repeatChar(ch, n) rend une chaîne de n fois le caractère ch. Si n vaut 0 ou moins, le résultat est vide.',
    criteria: ['n négatif donne une chaîne vide.'],
    fn: 'repeatChar', params: 'ch, n', stub: 'ch',
    tests: ["assert.equal(repeatChar('x', 3), 'xxx');", "assert.equal(repeatChar('-', 0), '');", "assert.equal(repeatChar('a', -2), '');"],
    solution: "export function repeatChar(ch, n) {\n  return n > 0 ? ch.repeat(n) : '';\n}",
  }),
  fnMission({
    id: 't1-initials', level: 1, category: 'strings',
    goal: 'initials(fullName) rend les initiales en majuscules, une par mot. Les espaces en trop sont ignorés.',
    criteria: ['"ada lovelace" donne "AL".'],
    fn: 'initials', params: 'fullName', stub: "''",
    tests: ["assert.equal(initials('Ada Lovelace'), 'AL');", "assert.equal(initials('  jean  paul sartre '), 'JPS');", "assert.equal(initials(''), '');"],
    solution: "export function initials(fullName) {\n  return fullName.trim().split(/\\s+/).filter(Boolean).map((word) => word[0].toUpperCase()).join('');\n}",
  }),
  fnMission({
    id: 't1-last-item', level: 1, category: 'collections',
    goal: 'lastItem(list) rend le dernier élément du tableau, ou undefined si le tableau est vide.',
    criteria: ['Le tableau n’est pas modifié.'],
    fn: 'lastItem', params: 'list', stub: 'list[0]',
    tests: ['assert.equal(lastItem([1, 2, 3]), 3);', 'assert.equal(lastItem([]), undefined);', "const l = ['a', 'b']; lastItem(l); assert.deepEqual(l, ['a', 'b']);"],
    solution: 'export function lastItem(list) {\n  return list.length ? list[list.length - 1] : undefined;\n}',
  }),
  fnMission({
    id: 't1-unique-values', level: 1, category: 'collections',
    goal: 'uniqueValues(list) retire les doublons et garde l’ordre de première apparition.',
    criteria: ['L’ordre d’origine est gardé.', 'Le tableau d’entrée n’est pas modifié.'],
    fn: 'uniqueValues', params: 'list', stub: 'list',
    tests: ['assert.deepEqual(uniqueValues([3, 1, 3, 2, 1]), [3, 1, 2]);', 'assert.deepEqual(uniqueValues([]), []);', 'const l = [1, 1]; uniqueValues(l); assert.deepEqual(l, [1, 1]);'],
    solution: 'export function uniqueValues(list) {\n  return [...new Set(list)];\n}',
  }),
  fnMission({
    id: 't1-count-occurrences', level: 1, category: 'collections',
    goal: 'countIf(list, value) compte combien de fois value apparaît dans le tableau (égalité stricte).',
    criteria: ['"1" et 1 sont différents.'],
    fn: 'countIf', params: 'list, value', stub: '0',
    tests: ['assert.equal(countIf([1, 2, 1, 1], 1), 3);', "assert.equal(countIf([1, '1'], '1'), 1);", 'assert.equal(countIf([], 4), 0);'],
    solution: 'export function countIf(list, value) {\n  return list.filter((item) => item === value).length;\n}',
  }),
  fnMission({
    id: 't1-int-range', level: 1, category: 'collections',
    goal: 'range(start, end) rend les entiers de start inclus à end exclu. Si end n’est pas plus grand que start, le tableau est vide.',
    criteria: ['end est exclu.'],
    fn: 'range', params: 'start, end', stub: '[]',
    tests: ['assert.deepEqual(range(2, 5), [2, 3, 4]);', 'assert.deepEqual(range(3, 3), []);', 'assert.deepEqual(range(5, 1), []);', 'assert.deepEqual(range(-1, 1), [-1, 0]);'],
    solution: 'export function range(start, end) {\n  const out = [];\n  for (let i = start; i < end; i += 1) out.push(i);\n  return out;\n}',
  }),
  fnMission({
    id: 't1-chunk-pairs', level: 1, category: 'collections',
    goal: 'chunkPairs(list) groupe les éléments deux par deux. Un élément seul à la fin forme un groupe d’un élément.',
    criteria: ['Le dernier groupe peut avoir un seul élément.'],
    fn: 'chunkPairs', params: 'list', stub: '[list]',
    tests: ["assert.deepEqual(chunkPairs([1, 2, 3, 4]), [[1, 2], [3, 4]]);", "assert.deepEqual(chunkPairs(['a', 'b', 'c']), [['a', 'b'], ['c']]);", 'assert.deepEqual(chunkPairs([]), []);'],
    solution: 'export function chunkPairs(list) {\n  const out = [];\n  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));\n  return out;\n}',
  }),
  fnMission({
    id: 't1-flatten-once', level: 1, category: 'collections',
    goal: 'flattenOnce(list) aplatit un seul niveau de tableaux imbriqués. Les niveaux plus profonds restent des tableaux.',
    criteria: ['Un seul niveau est aplati.'],
    fn: 'flattenOnce', params: 'list', stub: 'list',
    tests: ['assert.deepEqual(flattenOnce([1, [2, 3], 4]), [1, 2, 3, 4]);', 'assert.deepEqual(flattenOnce([[1, [2]], 3]), [1, [2], 3]);', 'assert.deepEqual(flattenOnce([]), []);'],
    solution: 'export function flattenOnce(list) {\n  return list.flat(1);\n}',
  }),
  fnMission({
    id: 't1-average', level: 1, category: 'collections',
    goal: 'average(nums) rend la moyenne des nombres. Un tableau vide vaut 0.',
    criteria: ['Le vide donne 0, pas NaN.'],
    fn: 'average', params: 'nums', stub: 'nums[0]',
    tests: ['assert.equal(average([2, 4, 6]), 4);', 'assert.equal(average([5]), 5);', 'assert.equal(average([]), 0);', 'assert.equal(average([1, 2]), 1.5);'],
    solution: 'export function average(nums) {\n  if (nums.length === 0) return 0;\n  return nums.reduce((sum, n) => sum + n, 0) / nums.length;\n}',
  }),
  fnMission({
    id: 't1-min-index', level: 1, category: 'collections',
    goal: 'minIndex(nums) rend la position du plus petit nombre. En cas d’égalité, la première position. Un tableau vide donne -1.',
    criteria: ['La première position gagne en cas d’égalité.'],
    fn: 'minIndex', params: 'nums', stub: '0',
    tests: ['assert.equal(minIndex([4, 1, 3]), 1);', 'assert.equal(minIndex([2, 0, 0]), 1);', 'assert.equal(minIndex([]), -1);', 'assert.equal(minIndex([-1, 5]), 0);'],
    solution: 'export function minIndex(nums) {\n  let best = -1;\n  for (let i = 0; i < nums.length; i += 1) if (best === -1 || nums[i] < nums[best]) best = i;\n  return best;\n}',
  }),
  fnMission({
    id: 't1-zip-pairs', level: 1, category: 'collections',
    goal: 'zipPairs(a, b) forme des paires [a[i], b[i]] jusqu’à la fin du plus court des deux tableaux.',
    criteria: ['Le tableau le plus long est tronqué.'],
    fn: 'zipPairs', params: 'a, b', stub: '[]',
    tests: ["assert.deepEqual(zipPairs([1, 2], ['a', 'b']), [[1, 'a'], [2, 'b']]);", "assert.deepEqual(zipPairs([1, 2, 3], ['x']), [[1, 'x']]);", 'assert.deepEqual(zipPairs([], [1]), []);'],
    solution: 'export function zipPairs(a, b) {\n  const n = Math.min(a.length, b.length);\n  const out = [];\n  for (let i = 0; i < n; i += 1) out.push([a[i], b[i]]);\n  return out;\n}',
  }),
  fnMission({
    id: 't1-sum-digits', level: 1, category: 'logic',
    goal: 'sumDigits(n) additionne les chiffres de l’entier n. Le signe est ignoré.',
    criteria: ['-123 donne 6.'],
    fn: 'sumDigits', params: 'n', stub: 'n',
    tests: ['assert.equal(sumDigits(123), 6);', 'assert.equal(sumDigits(-123), 6);', 'assert.equal(sumDigits(0), 0);', 'assert.equal(sumDigits(9009), 18);'],
    solution: "export function sumDigits(n) {\n  return String(Math.abs(n)).split('').reduce((sum, d) => sum + Number(d), 0);\n}",
  }),
  fnMission({
    id: 't1-gcd', level: 1, category: 'logic',
    goal: 'gcd(a, b) rend le plus grand diviseur commun de deux entiers positifs. gcd(a, 0) vaut a.',
    criteria: ['Algorithme d’Euclide ou équivalent.'],
    fn: 'gcd', params: 'a, b', stub: '1',
    tests: ['assert.equal(gcd(12, 18), 6);', 'assert.equal(gcd(7, 13), 1);', 'assert.equal(gcd(9, 0), 9);', 'assert.equal(gcd(100, 75), 25);'],
    solution: 'export function gcd(a, b) {\n  while (b !== 0) [a, b] = [b, a % b];\n  return a;\n}',
  }),
  fnMission({
    id: 't1-is-prime', level: 1, category: 'logic',
    goal: 'isPrime(n) dit si l’entier n est premier. 0, 1 et les négatifs ne le sont pas.',
    criteria: ['2 est premier.', '1 ne l’est pas.'],
    fn: 'isPrime', params: 'n', stub: 'false',
    tests: ['assert.equal(isPrime(2), true);', 'assert.equal(isPrime(17), true);', 'assert.equal(isPrime(1), false);', 'assert.equal(isPrime(21), false);', 'assert.equal(isPrime(-7), false);'],
    solution: 'export function isPrime(n) {\n  if (n < 2) return false;\n  for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;\n  return true;\n}',
  }),
  fnMission({
    id: 't1-pad-number', level: 1, category: 'strings',
    goal: 'padNumber(n, width) écrit l’entier positif n avec des zéros à gauche jusqu’à width caractères. Un nombre déjà plus long n’est pas coupé.',
    criteria: ['7 sur 3 caractères donne "007".'],
    fn: 'padNumber', params: 'n, width', stub: 'String(n)',
    tests: ["assert.equal(padNumber(7, 3), '007');", "assert.equal(padNumber(42, 2), '42');", "assert.equal(padNumber(12345, 3), '12345');"],
    solution: "export function padNumber(n, width) {\n  return String(n).padStart(width, '0');\n}",
  }),
  fnMission({
    id: 't1-truncate-text', level: 1, category: 'strings',
    goal: 'truncate(text, max) rend le texte tel quel s’il fait au plus max caractères. Sinon, il garde les max - 3 premiers caractères et ajoute "...", pour un total de max caractères.',
    criteria: ['Le résultat ne dépasse jamais max caractères (max ≥ 3).'],
    fn: 'truncate', params: 'text, max', stub: 'text',
    tests: ["assert.equal(truncate('bonjour', 10), 'bonjour');", "assert.equal(truncate('bonjour le monde', 10), 'bonjour...');", "assert.equal(truncate('abcdef', 6), 'abcdef');", "assert.equal(truncate('abcdefg', 6), 'abc...');"],
    solution: "export function truncate(text, max) {\n  return text.length <= max ? text : text.slice(0, max - 3) + '...';\n}",
  }),
  fnMission({
    id: 't1-camel-case', level: 1, category: 'strings',
    goal: 'camelCase(text) transforme des mots séparés par des espaces en camelCase : premier mot en minuscules, les suivants avec une majuscule initiale.',
    criteria: ['"hello big world" donne "helloBigWorld".'],
    fn: 'camelCase', params: 'text', stub: 'text',
    tests: ["assert.equal(camelCase('hello big world'), 'helloBigWorld');", "assert.equal(camelCase('Un'), 'un');", "assert.equal(camelCase('  deux   MOTS '), 'deuxMots');"],
    solution: "export function camelCase(text) {\n  const words = text.trim().toLowerCase().split(/\\s+/).filter(Boolean);\n  return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');\n}",
  }),
  fnMission({
    id: 't1-snake-case', level: 1, category: 'strings',
    goal: 'snakeCase(text) transforme un identifiant camelCase en snake_case : chaque majuscule devient un tiret bas suivi de la minuscule.',
    criteria: ['"helloBigWorld" donne "hello_big_world".'],
    fn: 'snakeCase', params: 'text', stub: 'text',
    tests: ["assert.equal(snakeCase('helloBigWorld'), 'hello_big_world');", "assert.equal(snakeCase('simple'), 'simple');", "assert.equal(snakeCase('aB'), 'a_b');"],
    solution: "export function snakeCase(text) {\n  return text.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase());\n}",
  }),
  fnMission({
    id: 't1-count-words', level: 1, category: 'strings',
    goal: 'countWords(text) compte les mots séparés par des espaces. Un texte vide ou fait d’espaces vaut 0.',
    criteria: ['Les espaces multiples ne créent pas de mot vide.'],
    fn: 'countWords', params: 'text', stub: '1',
    tests: ["assert.equal(countWords('un deux trois'), 3);", "assert.equal(countWords('   '), 0);", "assert.equal(countWords(''), 0);", "assert.equal(countWords(' a  b '), 2);"],
    solution: 'export function countWords(text) {\n  return text.trim() ? text.trim().split(/\\s+/).length : 0;\n}',
  }),
  fnMission({
    id: 't1-round-to', level: 1, category: 'functions',
    goal: 'roundTo(value, decimals) arrondit value au nombre de décimales demandé (arrondi au plus proche).',
    criteria: ['roundTo(3.14159, 2) vaut 3.14.'],
    fn: 'roundTo', params: 'value, decimals', stub: 'value',
    tests: ['assert.equal(roundTo(3.14159, 2), 3.14);', 'assert.equal(roundTo(2.5, 0), 3);', 'assert.equal(roundTo(1.005, 1), 1);', 'assert.equal(roundTo(10, 3), 10);'],
    solution: 'export function roundTo(value, decimals) {\n  const f = 10 ** decimals;\n  return Math.round(value * f) / f;\n}',
  }),
  fnMission({
    id: 't1-toggle-case', level: 1, category: 'strings',
    goal: 'toggleCase(text) inverse la casse de chaque lettre : minuscules en majuscules et inversement. Le reste ne change pas.',
    criteria: ['Les chiffres et la ponctuation restent.'],
    fn: 'toggleCase', params: 'text', stub: 'text',
    tests: ["assert.equal(toggleCase('aBc'), 'AbC');", "assert.equal(toggleCase('Hello 42!'), 'hELLO 42!');", "assert.equal(toggleCase(''), '');"],
    solution: "export function toggleCase(text) {\n  return [...text].map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('');\n}",
  }),
  fnMission({
    id: 't1-nth-fibonacci', level: 1, category: 'logic',
    goal: 'fib(n) rend le n-ième nombre de Fibonacci, avec fib(0) = 0 et fib(1) = 1. Itératif, pas de récursion exponentielle.',
    criteria: ['fib(10) vaut 55.', 'fib(50) répond vite.'],
    fn: 'fib', params: 'n', stub: 'n',
    tests: ['assert.equal(fib(0), 0);', 'assert.equal(fib(1), 1);', 'assert.equal(fib(10), 55);', 'assert.equal(fib(50), 12586269025);'],
    solution: 'export function fib(n) {\n  let a = 0;\n  let b = 1;\n  for (let i = 0; i < n; i += 1) [a, b] = [b, a + b];\n  return a;\n}',
  }),
  fnMission({
    id: 't1-day-name', level: 1, category: 'logic',
    goal: 'dayName(index) rend le nom du jour en français, en minuscules, de 0 = "dimanche" à 6 = "samedi". Hors de 0..6, le résultat est null.',
    criteria: ['Index invalide : null.'],
    fn: 'dayName', params: 'index', stub: "'lundi'",
    tests: ["assert.equal(dayName(0), 'dimanche');", "assert.equal(dayName(1), 'lundi');", "assert.equal(dayName(6), 'samedi');", 'assert.equal(dayName(7), null);', 'assert.equal(dayName(-1), null);'],
    solution: "const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];\nexport function dayName(index) {\n  return DAYS[index] ?? null;\n}",
  }),
  fnMission({
    id: 't1-sign-label', level: 1, category: 'logic',
    goal: 'signLabel(n) rend "positif", "négatif" ou "zéro" selon le signe du nombre.',
    criteria: ['Trois libellés distincts.'],
    fn: 'signLabel', params: 'n', stub: "'zéro'",
    tests: ["assert.equal(signLabel(3), 'positif');", "assert.equal(signLabel(-0.5), 'négatif');", "assert.equal(signLabel(0), 'zéro');"],
    solution: "export function signLabel(n) {\n  if (n > 0) return 'positif';\n  if (n < 0) return 'négatif';\n  return 'zéro';\n}",
  }),
  fnMission({
    id: 't1-sum-evens', level: 1, category: 'collections',
    goal: 'sumEvens(nums) additionne uniquement les nombres pairs du tableau.',
    criteria: ['Sans nombre pair, le résultat est 0.'],
    fn: 'sumEvens', params: 'nums', stub: '0',
    tests: ['assert.equal(sumEvens([1, 2, 3, 4]), 6);', 'assert.equal(sumEvens([1, 3]), 0);', 'assert.equal(sumEvens([-2, 2]), 0);'],
    solution: 'export function sumEvens(nums) {\n  return nums.filter((n) => n % 2 === 0).reduce((sum, n) => sum + n, 0);\n}',
  }),
];

/* ------------------------------------------------------------------ */
/* Entraînement : niveau 2                                             */
/* ------------------------------------------------------------------ */

const TRAIN_L2: CatalogEntry[] = [
  fnMission({
    id: 't2-csv-line', level: 2, category: 'strings',
    goal: 'parseCsvLine(line) découpe une ligne CSV sur les virgules et retire les espaces autour de chaque champ. Une ligne vide donne un tableau vide. Pas de guillemets à gérer.',
    criteria: ['Les champs sont nettoyés.', 'Un champ vide au milieu est gardé.'],
    fn: 'parseCsvLine', params: 'line', stub: '[line]',
    tests: ["assert.deepEqual(parseCsvLine('a, b ,c'), ['a', 'b', 'c']);", "assert.deepEqual(parseCsvLine('x,,y'), ['x', '', 'y']);", "assert.deepEqual(parseCsvLine(''), []);"],
    solution: "export function parseCsvLine(line) {\n  if (line.trim() === '') return [];\n  return line.split(',').map((field) => field.trim());\n}",
  }),
  fnMission({
    id: 't2-group-first-letter', level: 2, category: 'collections',
    goal: 'groupByFirstLetter(words) rend un objet dont chaque clé est une première lettre en minuscule et la valeur la liste des mots qui commencent par elle, dans l’ordre d’origine.',
    criteria: ['"Pomme" et "poire" vont sous "p".'],
    fn: 'groupByFirstLetter', params: 'words', stub: '{}',
    tests: ["assert.deepEqual(groupByFirstLetter(['Pomme', 'banane', 'poire']), { p: ['Pomme', 'poire'], b: ['banane'] });", 'assert.deepEqual(groupByFirstLetter([]), {});'],
    solution: 'export function groupByFirstLetter(words) {\n  const out = {};\n  for (const word of words) {\n    const key = word[0].toLowerCase();\n    (out[key] ??= []).push(word);\n  }\n  return out;\n}',
  }),
  fnMission({
    id: 't2-letter-counts', level: 2, category: 'strings',
    goal: 'countLetters(text) rend un objet qui compte chaque lettre a-z en minuscule. Les autres caractères sont ignorés.',
    criteria: ['La casse est ignorée.', 'Chiffres et espaces ne sont pas comptés.'],
    fn: 'countLetters', params: 'text', stub: '{}',
    tests: ["assert.deepEqual(countLetters('Abba 1!'), { a: 2, b: 2 });", "assert.deepEqual(countLetters(''), {});"],
    solution: 'export function countLetters(text) {\n  const out = {};\n  for (const ch of text.toLowerCase()) if (ch >= \'a\' && ch <= \'z\') out[ch] = (out[ch] ?? 0) + 1;\n  return out;\n}',
  }),
  fnMission({
    id: 't2-merge-settings', level: 2, category: 'json',
    goal: 'mergeSettings(base, override) rend un nouvel objet : les clés de base, remplacées par celles d’override sauf quand la valeur d’override est undefined. Les deux objets d’entrée ne changent pas.',
    criteria: ['undefined ne remplace rien.', 'null remplace.'],
    fn: 'mergeSettings', params: 'base, override', stub: 'base',
    tests: ['assert.deepEqual(mergeSettings({ a: 1, b: 2 }, { b: 3, c: 4 }), { a: 1, b: 3, c: 4 });', 'assert.deepEqual(mergeSettings({ a: 1 }, { a: undefined }), { a: 1 });', 'assert.deepEqual(mergeSettings({ a: 1 }, { a: null }), { a: null });', 'const base = { a: 1 }; mergeSettings(base, { a: 2 }); assert.deepEqual(base, { a: 1 });'],
    solution: 'export function mergeSettings(base, override) {\n  const out = { ...base };\n  for (const [key, value] of Object.entries(override)) if (value !== undefined) out[key] = value;\n  return out;\n}',
  }),
  fnMission({
    id: 't2-deep-get', level: 2, category: 'json',
    goal: 'deepGet(obj, path) lit une valeur par un chemin pointé comme "a.b.c". Si un maillon manque, le résultat est undefined, sans erreur.',
    criteria: ['Un chemin absent ne lève pas d’erreur.'],
    fn: 'deepGet', params: 'obj, path', stub: 'obj',
    tests: ["assert.equal(deepGet({ a: { b: { c: 5 } } }, 'a.b.c'), 5);", "assert.equal(deepGet({ a: {} }, 'a.b.c'), undefined);", "assert.equal(deepGet({ x: 0 }, 'x'), 0);", "assert.equal(deepGet(null, 'a'), undefined);"],
    solution: "export function deepGet(obj, path) {\n  let cur = obj;\n  for (const key of path.split('.')) {\n    if (cur == null) return undefined;\n    cur = cur[key];\n  }\n  return cur;\n}",
  }),
  fnMission({
    id: 't2-pick-keys', level: 2, category: 'json',
    goal: 'pick(obj, keys) rend un nouvel objet avec seulement les clés demandées qui existent dans obj.',
    criteria: ['Une clé absente n’apparaît pas.'],
    fn: 'pick', params: 'obj, keys', stub: 'obj',
    tests: ["assert.deepEqual(pick({ a: 1, b: 2, c: 3 }, ['a', 'c']), { a: 1, c: 3 });", "assert.deepEqual(pick({ a: 1 }, ['z']), {});", "assert.deepEqual(pick({ a: undefined }, ['a']), { a: undefined });"],
    solution: 'export function pick(obj, keys) {\n  const out = {};\n  for (const key of keys) if (Object.hasOwn(obj, key)) out[key] = obj[key];\n  return out;\n}',
  }),
  fnMission({
    id: 't2-omit-keys', level: 2, category: 'json',
    goal: 'omit(obj, keys) rend un nouvel objet sans les clés listées. L’objet d’entrée ne change pas.',
    criteria: ['L’entrée n’est pas modifiée.'],
    fn: 'omit', params: 'obj, keys', stub: 'obj',
    tests: ["assert.deepEqual(omit({ a: 1, b: 2 }, ['b']), { a: 1 });", "assert.deepEqual(omit({ a: 1 }, []), { a: 1 });", "const o = { a: 1, b: 2 }; omit(o, ['a']); assert.deepEqual(o, { a: 1, b: 2 });"],
    solution: 'export function omit(obj, keys) {\n  const out = { ...obj };\n  for (const key of keys) delete out[key];\n  return out;\n}',
  }),
  fnMission({
    id: 't2-safe-divide', level: 2, category: 'errors',
    goal: 'safeDivide(a, b) rend a / b. Si b vaut 0, la fonction lève une RangeError.',
    criteria: ['La division par zéro lève RangeError.'],
    fn: 'safeDivide', params: 'a, b', stub: 'a / b',
    tests: ['assert.equal(safeDivide(10, 4), 2.5);', 'assert.throws(() => safeDivide(1, 0), RangeError);', 'assert.equal(safeDivide(0, 5), 0);'],
    solution: "export function safeDivide(a, b) {\n  if (b === 0) throw new RangeError('division par zéro');\n  return a / b;\n}",
  }),
  fnMission({
    id: 't2-to-port', level: 2, category: 'types',
    goal: 'toPort(value) accepte un nombre ou une chaîne de chiffres et rend le port entier s’il est entre 1 et 65535. Sinon (décimal, hors bornes, texte, autre type), il rend null.',
    criteria: ['"8080" donne 8080.', '0 et 70000 donnent null.'],
    fn: 'toPort', params: 'value', stub: 'value',
    tests: ["assert.equal(toPort('8080'), 8080);", 'assert.equal(toPort(443), 443);', 'assert.equal(toPort(0), null);', 'assert.equal(toPort(70000), null);', "assert.equal(toPort('abc'), null);", 'assert.equal(toPort(80.5), null);', 'assert.equal(toPort(null), null);'],
    solution: "export function toPort(value) {\n  if (typeof value === 'string' && !/^\\d+$/.test(value)) return null;\n  if (typeof value !== 'string' && typeof value !== 'number') return null;\n  const n = Number(value);\n  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;\n}",
  }),
  fnMission({
    id: 't2-json-or-fallback', level: 2, category: 'json',
    goal: 'parseJsonOr(raw, fallback) rend le JSON lu, ou fallback si le texte n’est pas du JSON valide.',
    criteria: ['Aucune exception ne sort.'],
    fn: 'parseJsonOr', params: 'raw, fallback', stub: 'JSON.parse(raw)',
    tests: ["assert.deepEqual(parseJsonOr('{\"a\":1}', null), { a: 1 });", "assert.equal(parseJsonOr('pas du json', 7), 7);", "assert.equal(parseJsonOr('', 'vide'), 'vide');", "assert.equal(parseJsonOr('false', true), false);"],
    solution: 'export function parseJsonOr(raw, fallback) {\n  try {\n    return JSON.parse(raw);\n  } catch {\n    return fallback;\n  }\n}',
  }),
  fnMission({
    id: 't2-sum-json-field', level: 2, category: 'json',
    goal: 'sumField(raw, field) lit un tableau JSON d’objets et additionne la propriété field quand c’est un nombre. Les autres valeurs sont ignorées. Un JSON invalide ou qui n’est pas un tableau donne 0.',
    criteria: ['Les valeurs non numériques sont ignorées.', 'Un JSON invalide donne 0.'],
    fn: 'sumField', params: 'raw, field', stub: '0',
    tests: ["assert.equal(sumField('[{\"p\":2},{\"p\":3},{\"p\":\"x\"}]', 'p'), 5);", "assert.equal(sumField('{', 'p'), 0);", "assert.equal(sumField('{\"p\":4}', 'p'), 0);", "assert.equal(sumField('[]', 'p'), 0);"],
    solution: "export function sumField(raw, field) {\n  let data;\n  try {\n    data = JSON.parse(raw);\n  } catch {\n    return 0;\n  }\n  if (!Array.isArray(data)) return 0;\n  return data.reduce((sum, item) => (item && typeof item[field] === 'number' ? sum + item[field] : sum), 0);\n}",
  }),
  fnMission({
    id: 't2-query-string', level: 2, category: 'strings',
    goal: 'toQueryString(obj) construit "clé=valeur&clé=valeur" dans l’ordre des clés, avec encodeURIComponent sur les clés et les valeurs. Les valeurs null ou undefined sont sautées.',
    criteria: ['Les espaces deviennent %20.', 'null et undefined sont absents.'],
    fn: 'toQueryString', params: 'obj', stub: "''",
    tests: ["assert.equal(toQueryString({ a: 1, b: 'x y' }), 'a=1&b=x%20y');", "assert.equal(toQueryString({ a: null, b: undefined, c: 0 }), 'c=0');", "assert.equal(toQueryString({}), '');"],
    solution: "export function toQueryString(obj) {\n  return Object.entries(obj)\n    .filter(([, value]) => value !== null && value !== undefined)\n    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))\n    .join('&');\n}",
  }),
  fnMission({
    id: 't2-parse-query', level: 2, category: 'strings',
    goal: 'parseQuery(text) lit "a=1&b=x%20y" en objet { a: "1", b: "x y" } en décodant les valeurs. Un texte vide donne un objet vide. Un "?" en tête est ignoré.',
    criteria: ['Les valeurs restent des chaînes.', 'Le "?" initial est retiré.'],
    fn: 'parseQuery', params: 'text', stub: '{}',
    tests: ["assert.deepEqual(parseQuery('a=1&b=x%20y'), { a: '1', b: 'x y' });", "assert.deepEqual(parseQuery('?q=chat'), { q: 'chat' });", "assert.deepEqual(parseQuery(''), {});"],
    solution: "export function parseQuery(text) {\n  const out = {};\n  const body = text.startsWith('?') ? text.slice(1) : text;\n  if (!body) return out;\n  for (const part of body.split('&')) {\n    const [key, value = ''] = part.split('=');\n    out[decodeURIComponent(key)] = decodeURIComponent(value);\n  }\n  return out;\n}",
  }),
  fnMission({
    id: 't2-email-shape', level: 2, category: 'strings',
    goal: 'looksLikeEmail(text) dit si le texte a la forme d’une adresse : un seul "@", une partie non vide avant, un domaine après qui contient un point (pas en premier ni en dernier), et aucun espace.',
    criteria: ['Deux "@" : faux.', 'Domaine sans point : faux.'],
    fn: 'looksLikeEmail', params: 'text', stub: 'true',
    tests: ["assert.equal(looksLikeEmail('ada@exemple.fr'), true);", "assert.equal(looksLikeEmail('a@b@c.fr'), false);", "assert.equal(looksLikeEmail('@exemple.fr'), false);", "assert.equal(looksLikeEmail('ada@exemple'), false);", "assert.equal(looksLikeEmail('a da@x.fr'), false);", "assert.equal(looksLikeEmail('ada@.fr'), false);"],
    solution: "export function looksLikeEmail(text) {\n  if (/\\s/.test(text)) return false;\n  const parts = text.split('@');\n  if (parts.length !== 2) return false;\n  const [local, domain] = parts;\n  if (!local || !domain) return false;\n  const dot = domain.indexOf('.');\n  return dot > 0 && !domain.endsWith('.');\n}",
  }),
  fnMission({
    id: 't2-parse-duration', level: 2, category: 'strings',
    goal: 'parseDuration(text) convertit une durée comme "1h30m", "45m" ou "2h" en minutes. Un texte d’une autre forme rend null.',
    criteria: ['"1h30m" vaut 90.', 'Un texte vide ou inconnu donne null.'],
    fn: 'parseDuration', params: 'text', stub: '0',
    tests: ["assert.equal(parseDuration('1h30m'), 90);", "assert.equal(parseDuration('45m'), 45);", "assert.equal(parseDuration('2h'), 120);", "assert.equal(parseDuration(''), null);", "assert.equal(parseDuration('abc'), null);"],
    solution: "export function parseDuration(text) {\n  const match = /^(?:(\\d+)h)?(?:(\\d+)m)?$/.exec(text.trim());\n  if (!match || (!match[1] && !match[2])) return null;\n  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);\n}",
  }),
  fnMission({
    id: 't2-format-bytes', level: 2, category: 'strings',
    goal: 'formatBytes(n) écrit une taille : moins de 1024 → "N o" ; moins de 1024 × 1024 → "X.Y Ko" ; sinon "X.Y Mo", avec une décimale (toFixed(1)).',
    criteria: ['512 donne "512 o".', '1536 donne "1.5 Ko".'],
    fn: 'formatBytes', params: 'n', stub: 'String(n)',
    tests: ["assert.equal(formatBytes(512), '512 o');", "assert.equal(formatBytes(1536), '1.5 Ko');", "assert.equal(formatBytes(1048576), '1.0 Mo');", "assert.equal(formatBytes(1024), '1.0 Ko');"],
    solution: "export function formatBytes(n) {\n  if (n < 1024) return n + ' o';\n  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' Ko';\n  return (n / (1024 * 1024)).toFixed(1) + ' Mo';\n}",
  }),
  fnMission({
    id: 't2-dedupe-by-key', level: 2, category: 'collections',
    goal: 'dedupeBy(list, key) retire les objets dont la propriété key a déjà été vue, et garde le premier.',
    criteria: ['Le premier objet de chaque valeur est gardé.'],
    fn: 'dedupeBy', params: 'list, key', stub: 'list',
    tests: ["assert.deepEqual(dedupeBy([{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'c' }], 'id'), [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]);", "assert.deepEqual(dedupeBy([], 'id'), []);"],
    solution: 'export function dedupeBy(list, key) {\n  const seen = new Set();\n  return list.filter((item) => {\n    if (seen.has(item[key])) return false;\n    seen.add(item[key]);\n    return true;\n  });\n}',
  }),
  fnMission({
    id: 't2-sort-by-age', level: 2, category: 'collections',
    goal: 'sortByAge(people) rend une copie triée par âge croissant. À âge égal, l’ordre d’origine est gardé. Le tableau d’entrée ne change pas.',
    criteria: ['Tri stable.', 'Pas de modification de l’entrée.'],
    fn: 'sortByAge', params: 'people', stub: 'people',
    tests: ["assert.deepEqual(sortByAge([{ n: 'a', age: 30 }, { n: 'b', age: 20 }, { n: 'c', age: 30 }]).map((p) => p.n), ['b', 'a', 'c']);", "const input = [{ age: 2 }, { age: 1 }]; sortByAge(input); assert.equal(input[0].age, 2);"],
    solution: 'export function sortByAge(people) {\n  return [...people].sort((a, b) => a.age - b.age);\n}',
  }),
  fnMission({
    id: 't2-top-n', level: 2, category: 'collections',
    goal: 'topN(nums, n) rend les n plus grands nombres en ordre décroissant, sans modifier le tableau d’entrée.',
    criteria: ['Ordre décroissant.', 'Si n dépasse la taille, tous les nombres sont rendus.'],
    fn: 'topN', params: 'nums, n', stub: 'nums',
    tests: ['assert.deepEqual(topN([5, 1, 9, 3], 2), [9, 5]);', 'assert.deepEqual(topN([2, 1], 5), [2, 1]);', 'const input = [1, 3, 2]; topN(input, 1); assert.deepEqual(input, [1, 3, 2]);'],
    solution: 'export function topN(nums, n) {\n  return [...nums].sort((a, b) => b - a).slice(0, n);\n}',
  }),
  fnMission({
    id: 't2-most-common', level: 2, category: 'collections',
    goal: 'mostCommon(list) rend l’élément le plus fréquent. En cas d’égalité, celui qui apparaît en premier. Un tableau vide rend undefined.',
    criteria: ['Égalité : le premier apparu.'],
    fn: 'mostCommon', params: 'list', stub: 'list[0]',
    tests: ["assert.equal(mostCommon(['a', 'b', 'b', 'c']), 'b');", "assert.equal(mostCommon(['x', 'y', 'y', 'x']), 'x');", 'assert.equal(mostCommon([]), undefined);'],
    solution: 'export function mostCommon(list) {\n  const counts = new Map();\n  for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);\n  let best;\n  let bestCount = 0;\n  for (const [item, count] of counts) if (count > bestCount) [best, bestCount] = [item, count];\n  return best;\n}',
  }),
  fnMission({
    id: 't2-plain-object', level: 2, category: 'types',
    goal: 'isPlainObject(value) vaut true pour un objet littéral {} et false pour null, un tableau, une date, une fonction ou une valeur primitive.',
    criteria: ['Un tableau n’est pas un objet simple.', 'null non plus.'],
    fn: 'isPlainObject', params: 'value', stub: "typeof value === 'object'",
    tests: ['assert.equal(isPlainObject({ a: 1 }), true);', 'assert.equal(isPlainObject(null), false);', 'assert.equal(isPlainObject([]), false);', 'assert.equal(isPlainObject(new Date()), false);', "assert.equal(isPlainObject('x'), false);"],
    solution: "export function isPlainObject(value) {\n  if (value === null || typeof value !== 'object') return false;\n  const proto = Object.getPrototypeOf(value);\n  return proto === Object.prototype || proto === null;\n}",
  }),
  fnMission({
    id: 't2-type-name', level: 2, category: 'types',
    goal: 'typeName(value) rend un nom de type précis : "null", "array", "date", "object", "number", "string", "boolean", "undefined" ou "function".',
    criteria: ['null, tableau et date sont distingués d’un objet.'],
    fn: 'typeName', params: 'value', stub: 'typeof value',
    tests: ["assert.equal(typeName(null), 'null');", "assert.equal(typeName([]), 'array');", "assert.equal(typeName(new Date()), 'date');", "assert.equal(typeName({}), 'object');", "assert.equal(typeName(1), 'number');", "assert.equal(typeName(undefined), 'undefined');"],
    solution: "export function typeName(value) {\n  if (value === null) return 'null';\n  if (Array.isArray(value)) return 'array';\n  if (value instanceof Date) return 'date';\n  return typeof value;\n}",
  }),
  fnMission({
    id: 't2-ensure-array', level: 2, category: 'types',
    goal: 'ensureArray(value) rend value si c’est un tableau, un tableau vide pour null ou undefined, et sinon un tableau d’un seul élément.',
    criteria: ['0 et "" deviennent [0] et [""].'],
    fn: 'ensureArray', params: 'value', stub: 'value',
    tests: ['assert.deepEqual(ensureArray([1, 2]), [1, 2]);', 'assert.deepEqual(ensureArray(null), []);', 'assert.deepEqual(ensureArray(undefined), []);', 'assert.deepEqual(ensureArray(0), [0]);', "assert.deepEqual(ensureArray(''), ['']);"],
    solution: 'export function ensureArray(value) {\n  if (Array.isArray(value)) return value;\n  if (value === null || value === undefined) return [];\n  return [value];\n}',
  }),
  fnMission({
    id: 't2-assert-positive', level: 2, category: 'errors',
    goal: 'assertPositive(n) rend n si c’est un nombre strictement positif. Un nombre nul ou négatif lève RangeError. Une valeur qui n’est pas un nombre lève TypeError.',
    criteria: ['Deux types d’erreur distincts.'],
    fn: 'assertPositive', params: 'n', stub: 'n',
    tests: ['assert.equal(assertPositive(3), 3);', 'assert.throws(() => assertPositive(0), RangeError);', 'assert.throws(() => assertPositive(-1), RangeError);', "assert.throws(() => assertPositive('3'), TypeError);"],
    solution: "export function assertPositive(n) {\n  if (typeof n !== 'number' || Number.isNaN(n)) throw new TypeError('nombre attendu');\n  if (n <= 0) throw new RangeError('nombre positif attendu');\n  return n;\n}",
  }),
  fnMission({
    id: 't2-strict-int', level: 2, category: 'errors',
    goal: 'parseIntStrict(text) lit un entier écrit uniquement avec des chiffres et un "-" optionnel en tête. Toute autre forme lève une Error dont le message contient "nombre invalide".',
    criteria: ['"12a" est refusé.', '"-7" est accepté.'],
    fn: 'parseIntStrict', params: 'text', stub: 'parseInt(text, 10)',
    tests: ["assert.equal(parseIntStrict('42'), 42);", "assert.equal(parseIntStrict('-7'), -7);", "assert.throws(() => parseIntStrict('12a'), /nombre invalide/);", "assert.throws(() => parseIntStrict(''), /nombre invalide/);", "assert.throws(() => parseIntStrict('1.5'), /nombre invalide/);"],
    solution: "export function parseIntStrict(text) {\n  if (!/^-?\\d+$/.test(text)) throw new Error('nombre invalide : ' + text);\n  return Number(text);\n}",
  }),
  fnMission({
    id: 't2-map-async', level: 2, category: 'functions',
    goal: 'mapAsync(list, fn) appelle la fonction asynchrone fn sur chaque élément et rend une promesse du tableau des résultats, dans l’ordre de la liste.',
    criteria: ['L’ordre des résultats suit la liste, pas la fin des promesses.'],
    fn: 'mapAsync', params: 'list, fn', stub: 'list',
    tests: ['assert.deepEqual(await mapAsync([1, 2, 3], async (n) => n * 2), [2, 4, 6]);', 'assert.deepEqual(await mapAsync([30, 1], (n) => new Promise((r) => setTimeout(() => r(n), n))), [30, 1]);', 'assert.deepEqual(await mapAsync([], async (n) => n), []);'],
    solution: 'export function mapAsync(list, fn) {\n  return Promise.all(list.map((item) => fn(item)));\n}',
  }),
  fnMission({
    id: 't2-memoize-one-arg', level: 2, category: 'functions',
    goal: 'memoize(fn) rend une fonction qui garde en cache le résultat de fn pour chaque argument (un seul argument). fn n’est appelée qu’une fois par argument.',
    criteria: ['Deux appels avec le même argument n’appellent fn qu’une fois.'],
    fn: 'memoize', params: 'fn', stub: 'fn',
    tests: ['let calls = 0; const sq = memoize((n) => { calls += 1; return n * n; }); assert.equal(sq(3), 9); assert.equal(sq(3), 9); assert.equal(calls, 1);', 'let c = 0; const f = memoize((n) => { c += 1; return n; }); f(1); f(2); f(1); assert.equal(c, 2);'],
    solution: 'export function memoize(fn) {\n  const cache = new Map();\n  return (arg) => {\n    if (!cache.has(arg)) cache.set(arg, fn(arg));\n    return cache.get(arg);\n  };\n}',
  }),
  fnMission({
    id: 't2-call-once', level: 2, category: 'functions',
    goal: 'once(fn) rend une fonction qui appelle fn au premier appel seulement, puis rend toujours ce premier résultat.',
    criteria: ['fn n’est appelée qu’une fois.', 'Les arguments du premier appel sont transmis.'],
    fn: 'once', params: 'fn', stub: 'fn',
    tests: ['let n = 0; const f = once((x) => { n += 1; return x * 10; }); assert.equal(f(2), 20); assert.equal(f(5), 20); assert.equal(n, 1);'],
    solution: 'export function once(fn) {\n  let done = false;\n  let result;\n  return (...args) => {\n    if (!done) {\n      done = true;\n      result = fn(...args);\n    }\n    return result;\n  };\n}',
  }),
  fnMission({
    id: 't2-compose-two', level: 2, category: 'functions',
    goal: 'compose(f, g) rend une fonction x → f(g(x)) : g est appliquée en premier.',
    criteria: ['L’ordre d’application est g puis f.'],
    fn: 'compose', params: 'f, g', stub: 'f',
    tests: ['const inc = (x) => x + 1; const dbl = (x) => x * 2; assert.equal(compose(inc, dbl)(5), 11); assert.equal(compose(dbl, inc)(5), 12);'],
    solution: 'export function compose(f, g) {\n  return (x) => f(g(x));\n}',
  }),
  fnMission({
    id: 't2-make-counter', level: 2, category: 'functions',
    goal: 'makeCounter(start) rend un objet avec inc() qui ajoute 1 et rend la nouvelle valeur, et value() qui rend la valeur. Deux compteurs sont indépendants. start vaut 0 par défaut.',
    criteria: ['Deux compteurs ne partagent rien.'],
    fn: 'makeCounter', params: 'start = 0', stub: '{}',
    tests: ['const a = makeCounter(); a.inc(); a.inc(); assert.equal(a.value(), 2);', 'const a = makeCounter(5); const b = makeCounter(); assert.equal(a.inc(), 6); assert.equal(b.value(), 0);'],
    solution: 'export function makeCounter(start = 0) {\n  let n = start;\n  return {\n    inc: () => (n += 1),\n    value: () => n,\n  };\n}',
  }),
  fnMission({
    id: 't2-count-log-lines', level: 2, category: 'files',
    goal: 'countLines(root) lit le fichier data/log.txt dans le dossier root et rend le nombre de lignes non vides (une ligne faite d’espaces est vide).',
    constraints: ['Lecture seule.'],
    criteria: ['Les lignes vides ne comptent pas.', 'Le fichier est relu à chaque appel.'],
    fn: 'countLines', params: 'root', stub: '0',
    extraImports: FS_IMPORTS,
    tests: [`${ROOT} mkdirSync(join(root, 'data'), { recursive: true }); writeFileSync(join(root, 'data/log.txt'), 'a\\n\\n  \\nb\\nc\\n'); assert.equal(countLines(root), 3);`],
    solution: "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function countLines(root) {\n  return readFileSync(join(root, 'data/log.txt'), 'utf8').split(/\\r?\\n/).filter((line) => line.trim()).length;\n}",
  }),
  fnMission({
    id: 't2-read-config', level: 2, category: 'files',
    goal: 'readConfig(root) lit le fichier config.json dans root et rend l’objet. Si le fichier n’existe pas, il rend un objet vide.',
    constraints: ['Lecture seule.'],
    criteria: ['Fichier absent : {}.'],
    fn: 'readConfig', params: 'root', stub: '{}',
    extraImports: FS_IMPORTS,
    tests: [`${ROOT} writeFileSync(join(root, 'config.json'), '{"port":8080}'); assert.deepEqual(readConfig(root), { port: 8080 }); rmSync(join(root, 'config.json')); assert.deepEqual(readConfig(root), {});`],
    solution: "import { existsSync, readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function readConfig(root) {\n  const path = join(root, 'config.json');\n  if (!existsSync(path)) return {};\n  return JSON.parse(readFileSync(path, 'utf8'));\n}",
  }),
  fnMission({
    id: 't2-write-report', level: 2, category: 'files',
    goal: 'writeReport(root, lines) écrit les lignes jointes par "\\n" (avec un "\\n" final) dans le fichier out/report.txt de root, crée le dossier out si besoin, et rend le chemin relatif "out/report.txt".',
    constraints: ['Aucune écriture hors de root.'],
    criteria: ['Le dossier est créé.', 'Le contenu se termine par un saut de ligne.'],
    fn: 'writeReport', params: 'root, lines', stub: "''",
    extraImports: FS_IMPORTS,
    tests: [`${ROOT} rmSync(join(root, 'out'), { recursive: true, force: true }); assert.equal(writeReport(root, ['a', 'b']), 'out/report.txt'); assert.equal(readFileSync(join(root, 'out/report.txt'), 'utf8'), 'a\\nb\\n');`],
    solution: "import { mkdirSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function writeReport(root, lines) {\n  mkdirSync(join(root, 'out'), { recursive: true });\n  writeFileSync(join(root, 'out/report.txt'), lines.join('\\n') + '\\n');\n  return 'out/report.txt';\n}",
  }),
  fnMission({
    id: 't2-list-text-files', level: 2, category: 'files',
    goal: 'listTxt(root) rend, triés par ordre alphabétique, les noms des fichiers .txt du dossier docs de root (sans les sous-dossiers). Si docs n’existe pas, le résultat est vide.',
    constraints: ['Lecture seule.'],
    criteria: ['Seuls les .txt sont listés.', 'Dossier absent : [].'],
    fn: 'listTxt', params: 'root', stub: '[]',
    extraImports: FS_IMPORTS,
    tests: [`${ROOT} rmSync(join(root, 'docs'), { recursive: true, force: true }); assert.deepEqual(listTxt(root), []); mkdirSync(join(root, 'docs/sub'), { recursive: true }); writeFileSync(join(root, 'docs/b.txt'), ''); writeFileSync(join(root, 'docs/a.txt'), ''); writeFileSync(join(root, 'docs/c.md'), ''); assert.deepEqual(listTxt(root), ['a.txt', 'b.txt']);`],
    solution: "import { existsSync, readdirSync, statSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function listTxt(root) {\n  const dir = join(root, 'docs');\n  if (!existsSync(dir)) return [];\n  return readdirSync(dir).filter((name) => name.endsWith('.txt') && statSync(join(dir, name)).isFile()).sort();\n}",
  }),
  fnMission({
    id: 't2-wrap-text', level: 2, category: 'strings',
    goal: 'wrapText(text, width) coupe le texte en lignes d’au plus width caractères sans couper un mot (un mot plus long que width reste seul sur sa ligne). Rend le tableau des lignes.',
    criteria: ['Remplissage glouton : on ajoute des mots tant que ça tient.'],
    fn: 'wrapText', params: 'text, width', stub: '[text]',
    tests: ["assert.deepEqual(wrapText('le petit chat dort', 9), ['le petit', 'chat dort']);", "assert.deepEqual(wrapText('extraordinaire a', 5), ['extraordinaire', 'a']);", "assert.deepEqual(wrapText('', 5), []);"],
    solution: "export function wrapText(text, width) {\n  const lines = [];\n  let line = '';\n  for (const word of text.split(/\\s+/).filter(Boolean)) {\n    if (!line) line = word;\n    else if (line.length + 1 + word.length <= width) line += ' ' + word;\n    else {\n      lines.push(line);\n      line = word;\n    }\n  }\n  if (line) lines.push(line);\n  return lines;\n}",
  }),
  fnMission({
    id: 't2-slugify', level: 2, category: 'strings',
    goal: 'slugify(text) produit un identifiant d’URL : minuscules, accents retirés, tout ce qui n’est pas lettre ou chiffre devient un tiret, pas de tiret en double ni aux bords.',
    criteria: ['"Été à Paris !" donne "ete-a-paris".'],
    fn: 'slugify', params: 'text', stub: 'text',
    tests: ["assert.equal(slugify('Été à Paris !'), 'ete-a-paris');", "assert.equal(slugify('  Hello---World  '), 'hello-world');", "assert.equal(slugify(''), '');"],
    solution: "export function slugify(text) {\n  return text\n    .normalize('NFD')\n    .replace(/[\\u0300-\\u036f]/g, '')\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, '-')\n    .replace(/^-+|-+$/g, '');\n}",
  }),
  fnMission({
    id: 't2-mask-end', level: 2, category: 'strings',
    goal: 'maskExceptLast(text, visible) remplace tous les caractères par "*" sauf les visible derniers. Si le texte est plus court, il reste inchangé.',
    criteria: ['La longueur ne change pas.'],
    fn: 'maskExceptLast', params: 'text, visible', stub: 'text',
    tests: ["assert.equal(maskExceptLast('123456789', 4), '*****6789');", "assert.equal(maskExceptLast('abc', 4), 'abc');", "assert.equal(maskExceptLast('abcd', 0), '****');"],
    solution: "export function maskExceptLast(text, visible) {\n  if (text.length <= visible) return text;\n  const keep = visible > 0 ? text.slice(-visible) : '';\n  return '*'.repeat(text.length - keep.length) + keep;\n}",
  }),
  fnMission({
    id: 't2-intersect', level: 2, category: 'collections',
    goal: 'intersect(a, b) rend les valeurs présentes dans les deux tableaux, sans doublon, dans l’ordre de a.',
    criteria: ['Pas de doublon.', 'Ordre du premier tableau.'],
    fn: 'intersect', params: 'a, b', stub: 'a',
    tests: ['assert.deepEqual(intersect([3, 1, 2, 3], [2, 3, 4]), [3, 2]);', 'assert.deepEqual(intersect([1], []), []);'],
    solution: 'export function intersect(a, b) {\n  const other = new Set(b);\n  return [...new Set(a)].filter((value) => other.has(value));\n}',
  }),
  fnMission({
    id: 't2-difference', level: 2, category: 'collections',
    goal: 'difference(a, b) rend les éléments de a absents de b, dans l’ordre de a (les doublons de a sont gardés).',
    criteria: ['Les doublons de a restent.'],
    fn: 'difference', params: 'a, b', stub: 'a',
    tests: ['assert.deepEqual(difference([1, 2, 2, 3], [3]), [1, 2, 2]);', 'assert.deepEqual(difference([], [1]), []);', 'assert.deepEqual(difference([1], []), [1]);'],
    solution: 'export function difference(a, b) {\n  const other = new Set(b);\n  return a.filter((value) => !other.has(value));\n}',
  }),
  fnMission({
    id: 't2-partition', level: 2, category: 'collections',
    goal: 'partition(list, test) rend [oui, non] : les éléments pour lesquels test rend true, puis les autres, chacun dans l’ordre d’origine.',
    criteria: ['Deux tableaux, ordre gardé.'],
    fn: 'partition', params: 'list, test', stub: '[list, []]',
    tests: ['assert.deepEqual(partition([1, 2, 3, 4], (n) => n % 2 === 0), [[2, 4], [1, 3]]);', 'assert.deepEqual(partition([], () => true), [[], []]);'],
    solution: 'export function partition(list, test) {\n  const yes = [];\n  const no = [];\n  for (const item of list) (test(item) ? yes : no).push(item);\n  return [yes, no];\n}',
  }),
  fnMission({
    id: 't2-diff-keys', level: 2, category: 'json',
    goal: 'diffKeys(before, after) compare deux objets plats et rend { added, removed, changed } : listes triées des clés ajoutées, retirées, et présentes des deux côtés avec une valeur différente (===).',
    criteria: ['Chaque liste est triée.'],
    fn: 'diffKeys', params: 'before, after', stub: '{ added: [], removed: [], changed: [] }',
    tests: ["assert.deepEqual(diffKeys({ a: 1, b: 2, c: 3 }, { b: 2, c: 4, d: 5 }), { added: ['d'], removed: ['a'], changed: ['c'] });", 'assert.deepEqual(diffKeys({}, {}), { added: [], removed: [], changed: [] });'],
    solution: 'export function diffKeys(before, after) {\n  const added = Object.keys(after).filter((k) => !(k in before)).sort();\n  const removed = Object.keys(before).filter((k) => !(k in after)).sort();\n  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]).sort();\n  return { added, removed, changed };\n}',
  }),
  fnMission({
    id: 't2-stable-stringify', level: 2, category: 'json',
    goal: 'stableStringify(value) produit le même JSON que JSON.stringify, mais avec les clés des objets triées, à toutes les profondeurs. L’ordre des tableaux ne change pas.',
    criteria: ['Deux objets de mêmes clés dans un autre ordre donnent le même texte.'],
    fn: 'stableStringify', params: 'value', stub: 'JSON.stringify(value)',
    tests: ["assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{\"a\":{\"c\":3,\"d\":2},\"b\":1}');", "assert.equal(stableStringify([{ b: 1, a: 2 }, 3]), '[{\"a\":2,\"b\":1},3]');", "assert.equal(stableStringify('x'), '\"x\"');"],
    solution: "function sortDeep(value) {\n  if (Array.isArray(value)) return value.map(sortDeep);\n  if (value && typeof value === 'object') {\n    const out = {};\n    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);\n    return out;\n  }\n  return value;\n}\nexport function stableStringify(value) {\n  return JSON.stringify(sortDeep(value));\n}",
  }),
  fnMission({
    id: 't2-factorial-guard', level: 2, category: 'errors',
    goal: 'factorial(n) rend n! pour un entier n ≥ 0, avec 0! = 1. Un négatif ou un nombre non entier lève RangeError.',
    criteria: ['5! vaut 120.', 'Négatif ou décimal : RangeError.'],
    fn: 'factorial', params: 'n', stub: 'n',
    tests: ['assert.equal(factorial(5), 120);', 'assert.equal(factorial(0), 1);', 'assert.throws(() => factorial(-1), RangeError);', 'assert.throws(() => factorial(2.5), RangeError);'],
    solution: "export function factorial(n) {\n  if (!Number.isInteger(n) || n < 0) throw new RangeError('entier positif attendu');\n  let out = 1;\n  for (let i = 2; i <= n; i += 1) out *= i;\n  return out;\n}",
  }),
  fnMission({
    id: 't2-hex-color', level: 2, category: 'strings',
    goal: 'hexToRgb(hex) convertit "#ff8800" ou "#f80" en { r, g, b }. Une couleur mal formée rend null.',
    criteria: ['La forme courte est acceptée.', 'Forme invalide : null.'],
    fn: 'hexToRgb', params: 'hex', stub: 'null',
    tests: ["assert.deepEqual(hexToRgb('#ff8800'), { r: 255, g: 136, b: 0 });", "assert.deepEqual(hexToRgb('#f80'), { r: 255, g: 136, b: 0 });", "assert.equal(hexToRgb('ff8800'), null);", "assert.equal(hexToRgb('#zzzzzz'), null);"],
    solution: "export function hexToRgb(hex) {\n  let match = /^#([0-9a-f]{6})$/i.exec(hex);\n  let body = match?.[1];\n  if (!body) {\n    match = /^#([0-9a-f]{3})$/i.exec(hex);\n    if (!match) return null;\n    body = [...match[1]].map((ch) => ch + ch).join('');\n  }\n  return { r: parseInt(body.slice(0, 2), 16), g: parseInt(body.slice(2, 4), 16), b: parseInt(body.slice(4, 6), 16) };\n}",
  }),
  fnMission({
    id: 't2-invert-map', level: 2, category: 'json',
    goal: 'invert(obj) échange clés et valeurs. Si deux clés ont la même valeur, la dernière gagne.',
    criteria: ['Les valeurs deviennent des clés (texte).'],
    fn: 'invert', params: 'obj', stub: 'obj',
    tests: ["assert.deepEqual(invert({ a: 'x', b: 'y' }), { x: 'a', y: 'b' });", "assert.deepEqual(invert({ a: 1, b: 1 }), { 1: 'b' });", 'assert.deepEqual(invert({}), {});'],
    solution: 'export function invert(obj) {\n  const out = {};\n  for (const [key, value] of Object.entries(obj)) out[value] = key;\n  return out;\n}',
  }),
  fnMission({
    id: 't2-cumulative-sum', level: 2, category: 'collections',
    goal: 'runningTotal(nums) rend le tableau des sommes cumulées : chaque case vaut la somme des nombres jusqu’à elle incluse.',
    criteria: ['Même longueur que l’entrée.'],
    fn: 'runningTotal', params: 'nums', stub: 'nums',
    tests: ['assert.deepEqual(runningTotal([1, 2, 3]), [1, 3, 6]);', 'assert.deepEqual(runningTotal([]), []);', 'assert.deepEqual(runningTotal([5, -5]), [5, 0]);'],
    solution: 'export function runningTotal(nums) {\n  let sum = 0;\n  return nums.map((n) => (sum += n));\n}',
  }),
  fnMission({
    id: 't2-binary-search', level: 2, category: 'collections',
    goal: 'binarySearch(sorted, target) cherche target dans un tableau trié croissant et rend sa position, ou -1 s’il n’y est pas. Recherche dichotomique.',
    criteria: ['Absent : -1.'],
    fn: 'binarySearch', params: 'sorted, target', stub: '-1',
    tests: ['assert.equal(binarySearch([1, 3, 5, 7, 9], 7), 3);', 'assert.equal(binarySearch([1, 3, 5], 4), -1);', 'assert.equal(binarySearch([], 1), -1);', 'assert.equal(binarySearch([2], 2), 0);'],
    solution: 'export function binarySearch(sorted, target) {\n  let lo = 0;\n  let hi = sorted.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (sorted[mid] === target) return mid;\n    if (sorted[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}',
  }),
  fnMission({
    id: 't2-anagrams', level: 2, category: 'strings',
    goal: 'areAnagrams(a, b) dit si les deux mots utilisent exactement les mêmes lettres, sans tenir compte de la casse ni des espaces.',
    criteria: ['"Chien" et "niche" sont des anagrammes.'],
    fn: 'areAnagrams', params: 'a, b', stub: 'false',
    tests: ["assert.equal(areAnagrams('Chien', 'niche'), true);", "assert.equal(areAnagrams('abc', 'abd'), false);", "assert.equal(areAnagrams('a b', 'ba'), true);", "assert.equal(areAnagrams('aa', 'a'), false);"],
    solution: "export function areAnagrams(a, b) {\n  const key = (s) => [...s.toLowerCase().replace(/\\s+/g, '')].sort().join('');\n  return key(a) === key(b);\n}",
  }),
];

/* ------------------------------------------------------------------ */
/* Entraînement : niveau 3 (plusieurs fichiers, correction)            */
/* ------------------------------------------------------------------ */

function hiddenMulti(name: string, imports: readonly string[], lines: readonly string[]): LabFile {
  const head = ["import test from 'node:test';", "import assert from 'node:assert/strict';", ...imports];
  const body = lines.map((line, index) => {
    const asyncFn = /\bawait\b/.test(line) ? 'async ' : '';
    return `test('cas ${index + 1}', ${asyncFn}() => {\n  ${line}\n});`;
  });
  return file(`hidden/${name}.test.mjs`, [...head, ...body].join('\n'));
}

const TRAIN_L3: CatalogEntry[] = [
  multiMission({
    id: 't3-cart-total', level: 3, category: 'bugfix',
    goal: 'total(items) du panier doit additionner prix × quantité de chaque ligne (prix en centimes), puis appliquer une seule fois applyDiscount(somme, pct). applyDiscount est juste : ne la change pas.',
    constraints: ['Deux fichiers déjà là.', 'applyDiscount ne change pas.', 'Ne change pas les noms total et applyDiscount.'],
    criteria: ['La quantité compte.', 'La remise est appliquée une fois.'],
    starters: [
      file('src/price.mjs', 'export function applyDiscount(cents, pct) {\n  return Math.round(cents * (1 - pct / 100));\n}\n'),
      file('src/cart.mjs', 'import { applyDiscount } from "./price.mjs";\nexport function total(items, pct = 0) {\n  let sum = 0;\n  for (const item of items) sum += applyDiscount(item.price, pct);\n  return sum;\n}\n'),
    ],
    hidden: hiddenMulti('cart', ["import { applyDiscount } from '../src/price.mjs';", "import { total } from '../src/cart.mjs';"], [
      'assert.equal(applyDiscount(1000, 10), 900);',
      'assert.equal(total([{ price: 250, qty: 2 }, { price: 100, qty: 1 }]), 600);',
      'assert.equal(total([{ price: 333, qty: 3 }], 10), 899);',
    ]),
    solution: [file('src/cart.mjs', 'import { applyDiscount } from "./price.mjs";\nexport function total(items, pct = 0) {\n  let sum = 0;\n  for (const item of items) sum += item.price * item.qty;\n  return applyDiscount(sum, pct);\n}\n')],
  }),
  multiMission({
    id: 't3-pagination', level: 3, category: 'bugfix',
    goal: 'page(list, n, size) doit rendre la page n (numérotée à partir de 1) de size éléments. Aujourd’hui la page 1 saute les premiers éléments. pageCount reste juste.',
    constraints: ['pageCount ne change pas.', 'Ne change pas les noms page et pageCount.'],
    criteria: ['La page 1 commence au premier élément.', 'La dernière page peut être incomplète.'],
    starters: [file('src/pages.mjs', 'export function pageCount(total, size) {\n  return Math.ceil(total / size);\n}\nexport function page(list, n, size) {\n  return list.slice(n * size, n * size + size);\n}\n')],
    hidden: hiddenMulti('pages', ["import { page, pageCount } from '../src/pages.mjs';"], [
      'assert.deepEqual(page([1, 2, 3, 4, 5], 1, 2), [1, 2]);',
      'assert.deepEqual(page([1, 2, 3, 4, 5], 3, 2), [5]);',
      'assert.deepEqual(page([1, 2], 2, 2), []);',
      'assert.equal(pageCount(5, 2), 3);',
    ]),
    solution: [file('src/pages.mjs', 'export function pageCount(total, size) {\n  return Math.ceil(total / size);\n}\nexport function page(list, n, size) {\n  return list.slice((n - 1) * size, (n - 1) * size + size);\n}\n')],
  }),
  multiMission({
    id: 't3-average-rounding', level: 3, category: 'bugfix',
    goal: 'averageScore(scores) doit rendre la moyenne exacte (pas tronquée). Une liste vide vaut 0. sum reste la référence pour l’addition.',
    constraints: ['Deux fichiers déjà là.', 'sum ne change pas.'],
    criteria: ['[1, 2] donne 1.5.'],
    starters: [
      file('src/sum.mjs', 'export function sum(nums) {\n  return nums.reduce((a, b) => a + b, 0);\n}\n'),
      file('src/stats.mjs', 'import { sum } from "./sum.mjs";\nexport function averageScore(scores) {\n  return Math.floor(sum(scores) / scores.length);\n}\n'),
    ],
    hidden: hiddenMulti('stats', ["import { sum } from '../src/sum.mjs';", "import { averageScore } from '../src/stats.mjs';"], [
      'assert.equal(averageScore([1, 2]), 1.5);',
      'assert.equal(averageScore([]), 0);',
      'assert.equal(averageScore([10, 10, 11]), 31 / 3);',
      'assert.equal(sum([1, 2, 3]), 6);',
    ]),
    solution: [file('src/stats.mjs', 'import { sum } from "./sum.mjs";\nexport function averageScore(scores) {\n  if (scores.length === 0) return 0;\n  return sum(scores) / scores.length;\n}\n')],
  }),
  multiMission({
    id: 't3-adult-boundary', level: 3, category: 'bugfix',
    goal: 'isAdult(birthYear, year) doit être vrai à partir de 18 ans révolus (18 inclus), en se servant de ageIn. ageIn est juste : ne la change pas.',
    constraints: ['ageIn ne change pas.', 'Ne change pas les noms isAdult et ageIn.'],
    criteria: ['18 ans pile : majeur.'],
    starters: [
      file('src/age.mjs', 'export function ageIn(birthYear, year) {\n  return year - birthYear;\n}\n'),
      file('src/adult.mjs', 'import { ageIn } from "./age.mjs";\nexport function isAdult(birthYear, year) {\n  return ageIn(birthYear, year) > 18;\n}\n'),
    ],
    hidden: hiddenMulti('adult', ["import { ageIn } from '../src/age.mjs';", "import { isAdult } from '../src/adult.mjs';"], [
      'assert.equal(isAdult(2000, 2018), true);',
      'assert.equal(isAdult(2001, 2018), false);',
      'assert.equal(isAdult(1980, 2018), true);',
      'assert.equal(ageIn(2000, 2018), 18);',
    ]),
    solution: [file('src/adult.mjs', 'import { ageIn } from "./age.mjs";\nexport function isAdult(birthYear, year) {\n  return ageIn(birthYear, year) >= 18;\n}\n')],
  }),
  multiMission({
    id: 't3-find-user-case', level: 3, category: 'bugfix',
    goal: 'findUser(users, name) doit retrouver un utilisateur par son nom sans tenir compte de la casse ni des espaces autour de name. Sans résultat, il rend null.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom findUser.'],
    criteria: ['" ADA " retrouve "Ada".', 'Absent : null.'],
    starters: [file('src/users.mjs', 'export function findUser(users, name) {\n  return users.find((user) => user.name === name);\n}\n')],
    hidden: hiddenMulti('users', ["import { findUser } from '../src/users.mjs';"], [
      "assert.deepEqual(findUser([{ name: 'Ada' }, { name: 'Bob' }], ' ADA '), { name: 'Ada' });",
      "assert.equal(findUser([{ name: 'Ada' }], 'Zoe'), null);",
    ]),
    solution: [file('src/users.mjs', 'export function findUser(users, name) {\n  const wanted = name.trim().toLowerCase();\n  return users.find((user) => user.name.toLowerCase() === wanted) ?? null;\n}\n')],
  }),
  multiMission({
    id: 't3-sorted-copy-mutation', level: 3, category: 'bugfix',
    goal: 'sortedCopy(nums) doit rendre une copie triée par ordre croissant numérique sans modifier le tableau reçu. Aujourd’hui le tableau d’origine change et 10 passe avant 9.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom sortedCopy.'],
    criteria: ['Tri numérique.', 'Entrée intacte.'],
    starters: [file('src/sorted.mjs', 'export function sortedCopy(nums) {\n  return nums.sort();\n}\n')],
    hidden: hiddenMulti('sorted', ["import { sortedCopy } from '../src/sorted.mjs';"], [
      'assert.deepEqual(sortedCopy([10, 9, 1]), [1, 9, 10]);',
      'const input = [3, 1, 2]; sortedCopy(input); assert.deepEqual(input, [3, 1, 2]);',
    ]),
    solution: [file('src/sorted.mjs', 'export function sortedCopy(nums) {\n  return [...nums].sort((a, b) => a - b);\n}\n')],
  }),
  multiMission({
    id: 't3-load-all-await', level: 3, category: 'bugfix',
    goal: 'loadAll(ids) doit attendre tous les chargements de fetchItem et rendre le tableau des valeurs dans l’ordre des ids. Aujourd’hui il rend des promesses. fetchItem ne change pas.',
    constraints: ['fetchItem ne change pas.', 'Ne change pas les noms loadAll et fetchItem.'],
    criteria: ['Le résultat contient des valeurs, pas des promesses.'],
    starters: [
      file('src/fetchItem.mjs', 'export async function fetchItem(id) {\n  await new Promise((resolve) => setTimeout(resolve, 5));\n  return { id, label: "item-" + id };\n}\n'),
      file('src/loadAll.mjs', 'import { fetchItem } from "./fetchItem.mjs";\nexport async function loadAll(ids) {\n  return ids.map((id) => fetchItem(id));\n}\n'),
    ],
    hidden: hiddenMulti('loadAll', ["import { loadAll } from '../src/loadAll.mjs';", "import { fetchItem } from '../src/fetchItem.mjs';"], [
      "assert.deepEqual(await loadAll([2, 1]), [{ id: 2, label: 'item-2' }, { id: 1, label: 'item-1' }]);",
      'assert.deepEqual(await loadAll([]), []);',
      "assert.deepEqual(await fetchItem(3), { id: 3, label: 'item-3' });",
    ]),
    solution: [file('src/loadAll.mjs', 'import { fetchItem } from "./fetchItem.mjs";\nexport async function loadAll(ids) {\n  return Promise.all(ids.map((id) => fetchItem(id)));\n}\n')],
  }),
  multiMission({
    id: 't3-invoice-format', level: 3, category: 'regression',
    goal: 'invoice(lines) doit rendre le total formaté par formatPrice de la somme des cents × qty. Aujourd’hui la quantité est ignorée. formatPrice (ex. "12,50 €") ne doit pas changer.',
    constraints: ['formatPrice ne change pas de sortie.', 'Ne change pas les noms invoice et formatPrice.'],
    criteria: ['formatPrice reste la référence.', 'La quantité compte.'],
    starters: [
      file('src/format.mjs', 'export function formatPrice(cents) {\n  return (cents / 100).toFixed(2).replace(".", ",") + " €";\n}\n'),
      file('src/invoice.mjs', 'import { formatPrice } from "./format.mjs";\nexport function invoice(lines) {\n  return formatPrice(lines.reduce((sum, line) => sum + line.cents, 0));\n}\n'),
    ],
    hidden: hiddenMulti('invoice', ["import { formatPrice } from '../src/format.mjs';", "import { invoice } from '../src/invoice.mjs';"], [
      "assert.equal(formatPrice(1250), '12,50 €');",
      "assert.equal(invoice([{ cents: 500, qty: 2 }, { cents: 250, qty: 1 }]), '12,50 €');",
      "assert.equal(invoice([]), '0,00 €');",
    ]),
    solution: [file('src/invoice.mjs', 'import { formatPrice } from "./format.mjs";\nexport function invoice(lines) {\n  return formatPrice(lines.reduce((sum, line) => sum + line.cents * line.qty, 0));\n}\n')],
  }),
  multiMission({
    id: 't3-parse-date-month', level: 3, category: 'bugfix',
    goal: 'parseDate(text) lit une date "JJ/MM/AAAA" et rend { day, month, year } avec month de 1 à 12. Aujourd’hui le mois est décalé d’un. Une forme invalide rend null.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom parseDate.'],
    criteria: ['"05/03/2024" donne le mois 3.', 'Forme invalide : null.'],
    starters: [file('src/date.mjs', 'export function parseDate(text) {\n  const m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(text);\n  return { day: Number(m[1]), month: Number(m[2]) - 1, year: Number(m[3]) };\n}\n')],
    hidden: hiddenMulti('date', ["import { parseDate } from '../src/date.mjs';"], [
      "assert.deepEqual(parseDate('05/03/2024'), { day: 5, month: 3, year: 2024 });",
      "assert.equal(parseDate('2024-03-05'), null);",
      "assert.deepEqual(parseDate('31/12/1999'), { day: 31, month: 12, year: 1999 });",
    ]),
    solution: [file('src/date.mjs', 'export function parseDate(text) {\n  const m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(text);\n  if (!m) return null;\n  return { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) };\n}\n')],
  }),
  multiMission({
    id: 't3-shared-counter-state', level: 3, category: 'bugfix',
    goal: 'createTally() doit rendre un compteur indépendant : add() ajoute 1, count() rend le total. Aujourd’hui tous les compteurs partagent la même variable du module.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom createTally.'],
    criteria: ['Deux compteurs sont indépendants.'],
    starters: [file('src/tally.mjs', 'let total = 0;\nexport function createTally() {\n  return {\n    add() {\n      total += 1;\n    },\n    count() {\n      return total;\n    },\n  };\n}\n')],
    hidden: hiddenMulti('tally', ["import { createTally } from '../src/tally.mjs';"], [
      'const a = createTally(); const b = createTally(); a.add(); a.add(); b.add(); assert.equal(a.count(), 2); assert.equal(b.count(), 1);',
      'assert.equal(createTally().count(), 0);',
    ]),
    solution: [file('src/tally.mjs', 'export function createTally() {\n  let total = 0;\n  return {\n    add() {\n      total += 1;\n    },\n    count() {\n      return total;\n    },\n  };\n}\n')],
  }),
  multiMission({
    id: 't3-stock-negative', level: 3, category: 'regression',
    goal: 'removeStock(stock, item, n) ne doit jamais laisser une quantité négative : si n dépasse ce qui reste, il lève RangeError et ne change rien. addStock est juste et ne change pas.',
    constraints: ['addStock ne change pas.', 'Ne change pas les noms addStock et removeStock.'],
    criteria: ['Retrait trop grand : RangeError, stock intact.'],
    starters: [file('src/stock.mjs', 'export function addStock(stock, item, n) {\n  stock[item] = (stock[item] ?? 0) + n;\n  return stock;\n}\nexport function removeStock(stock, item, n) {\n  stock[item] = (stock[item] ?? 0) - n;\n  return stock;\n}\n')],
    hidden: hiddenMulti('stock', ["import { addStock, removeStock } from '../src/stock.mjs';"], [
      'const s = addStock({}, "vis", 5); assert.deepEqual(removeStock(s, "vis", 3), { vis: 2 });',
      'const s = { vis: 1 }; assert.throws(() => removeStock(s, "vis", 2), RangeError); assert.deepEqual(s, { vis: 1 });',
      'assert.deepEqual(addStock({ a: 1 }, "a", 2), { a: 3 });',
    ]),
    solution: [file('src/stock.mjs', 'export function addStock(stock, item, n) {\n  stock[item] = (stock[item] ?? 0) + n;\n  return stock;\n}\nexport function removeStock(stock, item, n) {\n  const left = (stock[item] ?? 0) - n;\n  if (left < 0) throw new RangeError("stock insuffisant");\n  stock[item] = left;\n  return stock;\n}\n')],
  }),
  multiMission({
    id: 't3-escape-html-order', level: 3, category: 'bugfix',
    goal: 'escapeHtml(text) doit remplacer & < > " par &amp; &lt; &gt; &quot; sans échapper deux fois. Aujourd’hui "<" devient "&amp;lt;".',
    constraints: ['Un seul fichier.', 'Ne change pas le nom escapeHtml.'],
    criteria: ['Chaque caractère est échappé une seule fois.'],
    starters: [file('src/escape.mjs', 'export function escapeHtml(text) {\n  return text\n    .replace(/</g, "&lt;")\n    .replace(/>/g, "&gt;")\n    .replace(/"/g, "&quot;")\n    .replace(/&/g, "&amp;");\n}\n')],
    hidden: hiddenMulti('escape', ["import { escapeHtml } from '../src/escape.mjs';"], [
      "assert.equal(escapeHtml('<b>'), '&lt;b&gt;');",
      "assert.equal(escapeHtml('a & b'), 'a &amp; b');",
      "assert.equal(escapeHtml('\"x\"'), '&quot;x&quot;');",
    ]),
    solution: [file('src/escape.mjs', 'export function escapeHtml(text) {\n  return text\n    .replace(/&/g, "&amp;")\n    .replace(/</g, "&lt;")\n    .replace(/>/g, "&gt;")\n    .replace(/"/g, "&quot;");\n}\n')],
  }),
  multiMission({
    id: 't3-word-count-spaces', level: 3, category: 'bugfix',
    goal: 'wordTotal(text) doit compter les mots même avec plusieurs espaces, des tabulations ou des espaces aux bords. Un texte vide vaut 0.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom wordTotal.'],
    criteria: ['Les espaces multiples ne créent pas de mot.'],
    starters: [file('src/words.mjs', 'export function wordTotal(text) {\n  return text.split(" ").length;\n}\n')],
    hidden: hiddenMulti('words', ["import { wordTotal } from '../src/words.mjs';"], [
      "assert.equal(wordTotal('un  deux\\ttrois '), 3);",
      "assert.equal(wordTotal(''), 0);",
      "assert.equal(wordTotal('seul'), 1);",
    ]),
    solution: [file('src/words.mjs', 'export function wordTotal(text) {\n  const trimmed = text.trim();\n  return trimmed ? trimmed.split(/\\s+/).length : 0;\n}\n')],
  }),
  multiMission({
    id: 't3-initial-empty-crash', level: 3, category: 'bugfix',
    goal: 'firstInitial(name) doit rendre la première lettre en majuscule, et une chaîne vide pour un nom vide ou fait d’espaces, sans planter.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom firstInitial.'],
    criteria: ['Nom vide : "" sans exception.'],
    starters: [file('src/initial.mjs', 'export function firstInitial(name) {\n  return name.trim()[0].toUpperCase();\n}\n')],
    hidden: hiddenMulti('initial', ["import { firstInitial } from '../src/initial.mjs';"], [
      "assert.equal(firstInitial(' ada'), 'A');",
      "assert.equal(firstInitial(''), '');",
      "assert.equal(firstInitial('   '), '');",
    ]),
    solution: [file('src/initial.mjs', 'export function firstInitial(name) {\n  const trimmed = name.trim();\n  return trimmed ? trimmed[0].toUpperCase() : "";\n}\n')],
  }),
  multiMission({
    id: 't3-temperature-pair', level: 3, category: 'regression',
    goal: 'Le module convertit les températures. toCelsius est juste. toFahrenheitTemp donne un résultat faux : corrige-la (F = C × 9 / 5 + 32) sans toucher à toCelsius.',
    constraints: ['toCelsius ne change pas.', 'Ne change pas les noms toCelsius et toFahrenheitTemp.'],
    criteria: ['Les deux conversions sont inverses l’une de l’autre.'],
    starters: [file('src/temp.mjs', 'export function toCelsius(f) {\n  return ((f - 32) * 5) / 9;\n}\nexport function toFahrenheitTemp(c) {\n  return (c * 5) / 9 + 32;\n}\n')],
    hidden: hiddenMulti('temp', ["import { toCelsius, toFahrenheitTemp } from '../src/temp.mjs';"], [
      'assert.equal(toFahrenheitTemp(100), 212);',
      'assert.equal(toCelsius(212), 100);',
      'assert.equal(toCelsius(toFahrenheitTemp(37)), 37);',
    ]),
    solution: [file('src/temp.mjs', 'export function toCelsius(f) {\n  return ((f - 32) * 5) / 9;\n}\nexport function toFahrenheitTemp(c) {\n  return (c * 9) / 5 + 32;\n}\n')],
  }),
  multiMission({
    id: 't3-slug-unique', level: 3, category: 'functions',
    goal: 'uniqueSlug(base, taken) doit rendre base s’il n’est pas dans la liste taken, sinon base-2, base-3… le premier libre. Le module utilise déjà normalizeSlug pour nettoyer base : garde-le.',
    constraints: ['normalizeSlug ne change pas.', 'Ne change pas les noms uniqueSlug et normalizeSlug.'],
    criteria: ['Le premier suffixe libre est choisi.'],
    starters: [
      file('src/normalize.mjs', 'export function normalizeSlug(text) {\n  return text.trim().toLowerCase().replace(/\\s+/g, "-");\n}\n'),
      file('src/unique.mjs', 'import { normalizeSlug } from "./normalize.mjs";\nexport function uniqueSlug(base, taken) {\n  return normalizeSlug(base);\n}\n'),
    ],
    hidden: hiddenMulti('unique', ["import { uniqueSlug } from '../src/unique.mjs';", "import { normalizeSlug } from '../src/normalize.mjs';"], [
      "assert.equal(uniqueSlug('Mon Post', []), 'mon-post');",
      "assert.equal(uniqueSlug('Mon Post', ['mon-post', 'mon-post-2']), 'mon-post-3');",
      "assert.equal(normalizeSlug(' A B '), 'a-b');",
    ]),
    solution: [file('src/unique.mjs', 'import { normalizeSlug } from "./normalize.mjs";\nexport function uniqueSlug(base, taken) {\n  const slug = normalizeSlug(base);\n  if (!taken.includes(slug)) return slug;\n  let n = 2;\n  while (taken.includes(slug + "-" + n)) n += 1;\n  return slug + "-" + n;\n}\n')],
  }),
  multiMission({
    id: 't3-retry-attempts', level: 3, category: 'errors',
    goal: 'retry(fn, times) doit appeler la fonction asynchrone fn jusqu’à ce qu’elle réussisse, au plus times fois, et rendre son résultat. Si tous les essais échouent, la dernière erreur est relancée.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom retry.'],
    criteria: ['Un succès au 2e essai rend la valeur.', 'Après times échecs, l’erreur sort.'],
    starters: [file('src/retry.mjs', 'export async function retry(fn, times) {\n  return fn();\n}\n')],
    hidden: hiddenMulti('retry', ["import { retry } from '../src/retry.mjs';"], [
      "let n = 0; const value = await retry(async () => { n += 1; if (n < 2) throw new Error('raté'); return 'ok'; }, 3); assert.equal(value, 'ok'); assert.equal(n, 2);",
      "let n = 0; await assert.rejects(retry(async () => { n += 1; throw new Error('toujours ' + n); }, 3), /toujours 3/); assert.equal(n, 3);",
    ]),
    solution: [file('src/retry.mjs', 'export async function retry(fn, times) {\n  let last;\n  for (let i = 0; i < times; i += 1) {\n    try {\n      return await fn();\n    } catch (error) {\n      last = error;\n    }\n  }\n  throw last;\n}\n')],
  }),
  multiMission({
    id: 't3-event-emitter', level: 3, category: 'functions',
    goal: 'createEmitter() doit rendre un objet avec on(name, handler) qui rend une fonction de désabonnement, et emit(name, value) qui appelle les handlers de ce nom dans l’ordre d’abonnement. Aujourd’hui emit n’appelle rien.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom createEmitter.'],
    criteria: ['Désabonné : plus appelé.', 'Un autre nom n’est pas appelé.'],
    starters: [file('src/emitter.mjs', 'export function createEmitter() {\n  return {\n    on(name, handler) {\n      return () => {};\n    },\n    emit(name, value) {},\n  };\n}\n')],
    hidden: hiddenMulti('emitter', ["import { createEmitter } from '../src/emitter.mjs';"], [
      "const e = createEmitter(); const seen = []; e.on('a', (v) => seen.push('1:' + v)); e.on('a', (v) => seen.push('2:' + v)); e.on('b', () => seen.push('b')); e.emit('a', 'x'); assert.deepEqual(seen, ['1:x', '2:x']);",
      "const e = createEmitter(); let n = 0; const off = e.on('t', () => { n += 1; }); e.emit('t'); off(); e.emit('t'); assert.equal(n, 1);",
    ]),
    solution: [file('src/emitter.mjs', 'export function createEmitter() {\n  const handlers = new Map();\n  return {\n    on(name, handler) {\n      const list = handlers.get(name) ?? [];\n      list.push(handler);\n      handlers.set(name, list);\n      return () => {\n        const current = handlers.get(name) ?? [];\n        handlers.set(name, current.filter((h) => h !== handler));\n      };\n    },\n    emit(name, value) {\n      for (const handler of handlers.get(name) ?? []) handler(value);\n    },\n  };\n}\n')],
  }),
  multiMission({
    id: 't3-lru-cache', level: 3, category: 'collections',
    goal: 'createCache(limit) doit rendre un cache get(key)/set(key, value) qui garde au plus limit entrées et retire la moins récemment utilisée (un get compte comme une utilisation). get d’une clé absente rend undefined.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom createCache.'],
    criteria: ['La plus ancienne utilisation est retirée en premier.'],
    starters: [file('src/cache.mjs', 'export function createCache(limit) {\n  const data = new Map();\n  return {\n    get(key) {\n      return data.get(key);\n    },\n    set(key, value) {\n      data.set(key, value);\n    },\n  };\n}\n')],
    hidden: hiddenMulti('cache', ["import { createCache } from '../src/cache.mjs';"], [
      "const c = createCache(2); c.set('a', 1); c.set('b', 2); c.set('c', 3); assert.equal(c.get('a'), undefined); assert.equal(c.get('c'), 3);",
      "const c = createCache(2); c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3); assert.equal(c.get('a'), 1); assert.equal(c.get('b'), undefined);",
    ]),
    solution: [file('src/cache.mjs', 'export function createCache(limit) {\n  const data = new Map();\n  return {\n    get(key) {\n      if (!data.has(key)) return undefined;\n      const value = data.get(key);\n      data.delete(key);\n      data.set(key, value);\n      return value;\n    },\n    set(key, value) {\n      data.delete(key);\n      data.set(key, value);\n      if (data.size > limit) data.delete(data.keys().next().value);\n    },\n  };\n}\n')],
  }),
  multiMission({
    id: 't3-csv-to-objects', level: 3, category: 'json',
    goal: 'csvToObjects(text) doit lire un CSV dont la première ligne donne les en-têtes et rendre un tableau d’objets. Les lignes vides sont ignorées. splitLine (découpe d’une ligne) est juste : réutilise-la.',
    constraints: ['splitLine ne change pas.', 'Ne change pas les noms csvToObjects et splitLine.'],
    criteria: ['Chaque ligne devient un objet clé → valeur texte.'],
    starters: [
      file('src/split.mjs', 'export function splitLine(line) {\n  return line.split(",").map((field) => field.trim());\n}\n'),
      file('src/csv.mjs', 'import { splitLine } from "./split.mjs";\nexport function csvToObjects(text) {\n  return [];\n}\n'),
    ],
    hidden: hiddenMulti('csv', ["import { csvToObjects } from '../src/csv.mjs';", "import { splitLine } from '../src/split.mjs';"], [
      "assert.deepEqual(csvToObjects('nom,age\\nAda,36\\n\\nBob, 40\\n'), [{ nom: 'Ada', age: '36' }, { nom: 'Bob', age: '40' }]);",
      "assert.deepEqual(csvToObjects('a,b'), []);",
      "assert.deepEqual(splitLine(' x , y'), ['x', 'y']);",
    ]),
    solution: [file('src/csv.mjs', 'import { splitLine } from "./split.mjs";\nexport function csvToObjects(text) {\n  const lines = text.split(/\\r?\\n/).filter((line) => line.trim());\n  if (lines.length < 2) return [];\n  const headers = splitLine(lines[0]);\n  return lines.slice(1).map((line) => {\n    const fields = splitLine(line);\n    const row = {};\n    headers.forEach((header, i) => (row[header] = fields[i] ?? ""));\n    return row;\n  });\n}\n')],
  }),
];

/* ------------------------------------------------------------------ */
/* Évaluation (tenue à l’écart, jamais entraînée)                      */
/* ------------------------------------------------------------------ */

const EVAL_EXTRA: CatalogEntry[] = [
  fnMission({
    id: 'e1-min-of-list', level: 1, category: 'collections', split: 'validation',
    goal: 'smallest(nums) rend le plus petit nombre du tableau, ou null si le tableau est vide.',
    criteria: ['Vide : null.'],
    fn: 'smallest', params: 'nums', stub: 'nums[0]',
    tests: ['assert.equal(smallest([4, -2, 9]), -2);', 'assert.equal(smallest([]), null);', 'assert.equal(smallest([7]), 7);'],
    solution: 'export function smallest(nums) {\n  return nums.length ? Math.min(...nums) : null;\n}',
  }),
  fnMission({
    id: 'e1-count-char', level: 1, category: 'strings', split: 'validation',
    goal: 'countChar(text, ch) compte les apparitions exactes du caractère ch dans text (casse respectée).',
    criteria: ['La casse compte.'],
    fn: 'countChar', params: 'text, ch', stub: '0',
    tests: ["assert.equal(countChar('banana', 'a'), 3);", "assert.equal(countChar('Banana', 'b'), 0);", "assert.equal(countChar('', 'x'), 0);"],
    solution: 'export function countChar(text, ch) {\n  return text.split(ch).length - 1;\n}',
  }),
  fnMission({
    id: 'e1-title-case', level: 1, category: 'strings', split: 'validation',
    goal: 'titleCase(text) met chaque mot avec une majuscule initiale et le reste du mot en minuscules. Les mots sont séparés par un espace.',
    criteria: ['"bONJOUR le MONDE" donne "Bonjour Le Monde".'],
    fn: 'titleCase', params: 'text', stub: 'text',
    tests: ["assert.equal(titleCase('bONJOUR le MONDE'), 'Bonjour Le Monde');", "assert.equal(titleCase('a'), 'A');", "assert.equal(titleCase(''), '');"],
    solution: "export function titleCase(text) {\n  return text.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');\n}",
  }),
  fnMission({
    id: 'e1-strip-vowels', level: 1, category: 'strings', split: 'validation',
    goal: 'stripVowels(text) retire les voyelles a e i o u, minuscules et majuscules, et garde tout le reste.',
    criteria: ['Les majuscules sont retirées aussi.'],
    fn: 'stripVowels', params: 'text', stub: 'text',
    tests: ["assert.equal(stripVowels('Bonjour'), 'Bnjr');", "assert.equal(stripVowels('AEIOU xyz'), ' xyz');"],
    solution: "export function stripVowels(text) {\n  return text.replace(/[aeiou]/gi, '');\n}",
  }),
  fnMission({
    id: 'e1-last-n', level: 1, category: 'collections', split: 'validation',
    goal: 'takeLast(list, n) rend les n derniers éléments. Si n vaut 0 ou moins, le tableau rendu est vide.',
    criteria: ['n = 0 : [].'],
    fn: 'takeLast', params: 'list, n', stub: 'list',
    tests: ['assert.deepEqual(takeLast([1, 2, 3, 4], 2), [3, 4]);', 'assert.deepEqual(takeLast([1, 2], 0), []);', 'assert.deepEqual(takeLast([1], 5), [1]);'],
    solution: 'export function takeLast(list, n) {\n  return n > 0 ? list.slice(-n) : [];\n}',
  }),
  fnMission({
    id: 'e1-sum-odd', level: 1, category: 'collections', split: 'validation',
    goal: 'sumOdd(nums) additionne les nombres impairs du tableau, négatifs compris.',
    criteria: ['-3 est impair.'],
    fn: 'sumOdd', params: 'nums', stub: '0',
    tests: ['assert.equal(sumOdd([1, 2, 3]), 4);', 'assert.equal(sumOdd([-3, 4]), -3);', 'assert.equal(sumOdd([]), 0);'],
    solution: 'export function sumOdd(nums) {\n  return nums.filter((n) => n % 2 !== 0).reduce((s, n) => s + n, 0);\n}',
  }),
  fnMission({
    id: 'e1-is-sorted', level: 1, category: 'logic', split: 'validation',
    goal: 'isSorted(nums) dit si le tableau est en ordre croissant au sens large (deux valeurs égales côte à côte sont acceptées).',
    criteria: ['Vide et un seul élément : true.'],
    fn: 'isSorted', params: 'nums', stub: 'true',
    tests: ['assert.equal(isSorted([1, 2, 2, 5]), true);', 'assert.equal(isSorted([3, 1]), false);', 'assert.equal(isSorted([]), true);'],
    solution: 'export function isSorted(nums) {\n  for (let i = 1; i < nums.length; i += 1) if (nums[i] < nums[i - 1]) return false;\n  return true;\n}',
  }),
  fnMission({
    id: 'e2-key-value-pairs', level: 2, category: 'strings', split: 'validation',
    goal: 'parsePairs(text) lit "a=1;b=2" en objet { a: "1", b: "2" }. Les morceaux vides sont ignorés et les espaces autour des clés et valeurs retirés.',
    criteria: ['Un ";" final ne crée pas de clé vide.'],
    fn: 'parsePairs', params: 'text', stub: '{}',
    tests: ["assert.deepEqual(parsePairs('a=1;b=2'), { a: '1', b: '2' });", "assert.deepEqual(parsePairs(' x = y ;'), { x: 'y' });", "assert.deepEqual(parsePairs(''), {});"],
    solution: "export function parsePairs(text) {\n  const out = {};\n  for (const part of text.split(';')) {\n    if (!part.trim()) continue;\n    const [key, ...rest] = part.split('=');\n    out[key.trim()] = rest.join('=').trim();\n  }\n  return out;\n}",
  }),
  fnMission({
    id: 'e2-leaf-count', level: 2, category: 'json', split: 'validation',
    goal: 'countLeaves(value) compte les valeurs qui ne sont ni des objets ni des tableaux, en parcourant récursivement objets et tableaux. null compte comme une feuille.',
    criteria: ['La profondeur ne limite pas le compte.'],
    fn: 'countLeaves', params: 'value', stub: '0',
    tests: ['assert.equal(countLeaves({ a: 1, b: [2, 3, { c: null }] }), 4);', 'assert.equal(countLeaves(5), 1);', 'assert.equal(countLeaves({}), 0);'],
    solution: "export function countLeaves(value) {\n  if (Array.isArray(value)) return value.reduce((s, v) => s + countLeaves(v), 0);\n  if (value !== null && typeof value === 'object') return Object.values(value).reduce((s, v) => s + countLeaves(v), 0);\n  return 1;\n}",
  }),
  fnMission({
    id: 'e2-safe-sqrt', level: 2, category: 'errors', split: 'validation',
    goal: 'safeSqrt(n) rend la racine carrée de n. Un nombre négatif lève RangeError ; une valeur qui n’est pas un nombre lève TypeError.',
    criteria: ['Deux erreurs distinctes.'],
    fn: 'safeSqrt', params: 'n', stub: 'Math.sqrt(n)',
    tests: ['assert.equal(safeSqrt(9), 3);', 'assert.throws(() => safeSqrt(-4), RangeError);', "assert.throws(() => safeSqrt('9'), TypeError);"],
    solution: "export function safeSqrt(n) {\n  if (typeof n !== 'number') throw new TypeError('nombre attendu');\n  if (n < 0) throw new RangeError('négatif');\n  return Math.sqrt(n);\n}",
  }),
  fnMission({
    id: 'e2-to-bool', level: 2, category: 'types', split: 'validation',
    goal: 'toBool(text) rend true pour "oui", "true" ou "1", false pour "non", "false" ou "0" (casse et espaces ignorés), et null pour tout autre texte.',
    criteria: ['" OUI " donne true.', 'Texte inconnu : null.'],
    fn: 'toBool', params: 'text', stub: 'Boolean(text)',
    tests: ["assert.equal(toBool(' OUI '), true);", "assert.equal(toBool('0'), false);", "assert.equal(toBool('peut-être'), null);"],
    solution: "export function toBool(text) {\n  const t = text.trim().toLowerCase();\n  if (['oui', 'true', '1'].includes(t)) return true;\n  if (['non', 'false', '0'].includes(t)) return false;\n  return null;\n}",
  }),
  fnMission({
    id: 'e2-rotate-right', level: 2, category: 'collections', split: 'validation',
    goal: 'rotateRight(list, k) décale les éléments de k positions vers la droite ; ceux qui sortent à droite reviennent au début. k peut dépasser la longueur. L’entrée n’est pas modifiée.',
    criteria: ['k plus grand que la taille est géré.'],
    fn: 'rotateRight', params: 'list, k', stub: 'list',
    tests: ['assert.deepEqual(rotateRight([1, 2, 3, 4], 1), [4, 1, 2, 3]);', 'assert.deepEqual(rotateRight([1, 2, 3], 4), [3, 1, 2]);', 'assert.deepEqual(rotateRight([], 3), []);'],
    solution: 'export function rotateRight(list, k) {\n  if (list.length === 0) return [];\n  const s = k % list.length;\n  return [...list.slice(list.length - s), ...list.slice(0, list.length - s)];\n}',
  }),
  fnMission({
    id: 'e2-run-length', level: 2, category: 'strings', split: 'validation',
    goal: 'runLength(text) encode les répétitions consécutives : "aaabcc" devient "a3b1c2".',
    criteria: ['Chaque groupe est suivi de son nombre.'],
    fn: 'runLength', params: 'text', stub: 'text',
    tests: ["assert.equal(runLength('aaabcc'), 'a3b1c2');", "assert.equal(runLength(''), '');", "assert.equal(runLength('abab'), 'a1b1a1b1');"],
    solution: "export function runLength(text) {\n  let out = '';\n  for (let i = 0; i < text.length; ) {\n    let j = i;\n    while (j < text.length && text[j] === text[i]) j += 1;\n    out += text[i] + (j - i);\n    i = j;\n  }\n  return out;\n}",
  }),
  fnMission({
    id: 'e2-sum-number-file', level: 2, category: 'files', split: 'validation',
    goal: 'sumFile(root) lit le fichier nums.txt de root, un nombre par ligne, et rend leur somme. Les lignes vides sont ignorées.',
    constraints: ['Lecture seule.'],
    criteria: ['Le fichier est relu à chaque appel.'],
    fn: 'sumFile', params: 'root', stub: '0',
    extraImports: FS_IMPORTS,
    tests: [`${ROOT} writeFileSync(join(root, 'nums.txt'), '3\\n\\n4.5\\n-1\\n'); assert.equal(sumFile(root), 6.5);`],
    solution: "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function sumFile(root) {\n  return readFileSync(join(root, 'nums.txt'), 'utf8').split(/\\r?\\n/).filter((l) => l.trim()).reduce((s, l) => s + Number(l), 0);\n}",
  }),
  fnMission({
    id: 'e2-compact-falsy', level: 2, category: 'collections', split: 'validation',
    goal: 'compact(list) retire null, undefined et les chaînes vides, mais garde 0 et false.',
    criteria: ['0 et false restent.'],
    fn: 'compact', params: 'list', stub: 'list',
    tests: ["assert.deepEqual(compact([0, null, 'a', '', undefined, false]), [0, 'a', false]);", 'assert.deepEqual(compact([]), []);'],
    solution: "export function compact(list) {\n  return list.filter((v) => v !== null && v !== undefined && v !== '');\n}",
  }),
  fnMission({
    id: 'e2-median', level: 2, category: 'collections', split: 'validation',
    goal: 'median(nums) rend la médiane : la valeur du milieu après tri, ou la moyenne des deux du milieu si le nombre d’éléments est pair. Vide : null. L’entrée n’est pas modifiée.',
    criteria: ['Nombre pair d’éléments : moyenne des deux centraux.'],
    fn: 'median', params: 'nums', stub: 'nums[0]',
    tests: ['assert.equal(median([3, 1, 2]), 2);', 'assert.equal(median([4, 1, 3, 2]), 2.5);', 'assert.equal(median([]), null);', 'const input = [2, 1]; median(input); assert.deepEqual(input, [2, 1]);'],
    solution: 'export function median(nums) {\n  if (nums.length === 0) return null;\n  const s = [...nums].sort((a, b) => a - b);\n  const mid = s.length >> 1;\n  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;\n}',
  }),
  fnMission({
    id: 'e2-roman-numerals', level: 2, category: 'logic', split: 'validation',
    goal: 'romanToInt(text) convertit un nombre romain (I, V, X, L, C, D, M, avec la soustraction comme IV ou XC) en entier.',
    criteria: ['"XIV" vaut 14.', '"MCMXC" vaut 1990.'],
    fn: 'romanToInt', params: 'text', stub: '0',
    tests: ["assert.equal(romanToInt('XIV'), 14);", "assert.equal(romanToInt('MCMXC'), 1990);", "assert.equal(romanToInt('III'), 3);"],
    solution: "const V = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };\nexport function romanToInt(text) {\n  let total = 0;\n  for (let i = 0; i < text.length; i += 1) {\n    const cur = V[text[i]];\n    const next = V[text[i + 1]] ?? 0;\n    total += cur < next ? -cur : cur;\n  }\n  return total;\n}",
  }),
  multiMission({
    id: 'e3-max-by-comparator', level: 3, category: 'bugfix', split: 'validation',
    goal: 'maxBy(list, key) doit rendre l’objet dont la propriété key est la plus grande. Aujourd’hui il rend la plus petite. compareBy est juste : ne la change pas.',
    constraints: ['compareBy ne change pas.', 'Ne change pas les noms maxBy et compareBy.'],
    criteria: ['Le plus grand gagne.'],
    starters: [
      file('src/compare.mjs', 'export function compareBy(key) {\n  return (a, b) => a[key] - b[key];\n}\n'),
      file('src/maxBy.mjs', 'import { compareBy } from "./compare.mjs";\nexport function maxBy(list, key) {\n  return [...list].sort(compareBy(key))[0];\n}\n'),
    ],
    hidden: hiddenMulti('maxBy', ["import { maxBy } from '../src/maxBy.mjs';", "import { compareBy } from '../src/compare.mjs';"], [
      "assert.deepEqual(maxBy([{ v: 2 }, { v: 9 }, { v: 4 }], 'v'), { v: 9 });",
      "assert.equal(compareBy('v')({ v: 1 }, { v: 3 }), -2);",
    ]),
    solution: [file('src/maxBy.mjs', 'import { compareBy } from "./compare.mjs";\nexport function maxBy(list, key) {\n  return [...list].sort(compareBy(key)).at(-1);\n}\n')],
  }),
  multiMission({
    id: 'e3-percent-zero', level: 3, category: 'regression', split: 'validation',
    goal: 'percent(part, total) doit rendre 0 quand total vaut 0 au lieu de Infinity ou NaN. formatPercent (ex. "12.5 %") ne change pas.',
    constraints: ['formatPercent ne change pas.', 'Ne change pas les noms percent et formatPercent.'],
    criteria: ['total = 0 : 0.'],
    starters: [file('src/percent.mjs', 'export function percent(part, total) {\n  return (part / total) * 100;\n}\nexport function formatPercent(value) {\n  return value.toFixed(1) + " %";\n}\n')],
    hidden: hiddenMulti('percent', ["import { percent, formatPercent } from '../src/percent.mjs';"], [
      'assert.equal(percent(1, 8), 12.5);',
      'assert.equal(percent(3, 0), 0);',
      'assert.equal(percent(0, 0), 0);',
      "assert.equal(formatPercent(12.5), '12.5 %');",
    ]),
    solution: [file('src/percent.mjs', 'export function percent(part, total) {\n  if (total === 0) return 0;\n  return (part / total) * 100;\n}\nexport function formatPercent(value) {\n  return value.toFixed(1) + " %";\n}\n')],
  }),
  multiMission({
    id: 'e3-queue-order', level: 3, category: 'bugfix', split: 'validation',
    goal: 'createQueue() rend une file : push(x) ajoute à la fin, shift() doit retirer et rendre le premier arrivé (undefined si vide). Aujourd’hui shift rend le dernier.',
    constraints: ['Un seul fichier.', 'Ne change pas le nom createQueue.'],
    criteria: ['Premier entré, premier sorti.'],
    starters: [file('src/queue.mjs', 'export function createQueue() {\n  const items = [];\n  return {\n    push(x) {\n      items.push(x);\n    },\n    shift() {\n      return items.pop();\n    },\n    size() {\n      return items.length;\n    },\n  };\n}\n')],
    hidden: hiddenMulti('queue', ["import { createQueue } from '../src/queue.mjs';"], [
      "const q = createQueue(); q.push('a'); q.push('b'); assert.equal(q.shift(), 'a'); assert.equal(q.size(), 1);",
      'assert.equal(createQueue().shift(), undefined);',
    ]),
    solution: [file('src/queue.mjs', 'export function createQueue() {\n  const items = [];\n  return {\n    push(x) {\n      items.push(x);\n    },\n    shift() {\n      return items.shift();\n    },\n    size() {\n      return items.length;\n    },\n  };\n}\n')],
  }),
];

/** Solutions des 9 missions de référence (5.0.52), pour vérifier le catalogue entier. */
const REFERENCE_SOLUTIONS: Record<string, LabFile[]> = {
  'l1-keel-sign': [file('src/keel.mjs', 'export function keel(n) {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}')],
  'l1-span-clamp': [file('src/span.mjs', 'export function span(value, low, high) {\n  return Math.min(high, Math.max(low, value));\n}')],
  'l1-basket-sum': [file('src/basket.mjs', 'export function basket(nums) {\n  return nums.reduce((sum, n) => sum + n, 0);\n}')],
  'l1-fold-label': [file('src/foldLabel.mjs', "export function foldLabel(text) {\n  return text.trim().replace(/\\s+/g, ' ');\n}")],
  'l2-qty-json': [file('src/readQty.mjs', "export function readQty(raw) {\n  try {\n    const v = JSON.parse(raw);\n    return v && typeof v.qty === 'number' ? v.qty : null;\n  } catch {\n    return null;\n  }\n}")],
  'l2-need-name': [file('src/needName.mjs', "export function needName(value) {\n  if (typeof value !== 'string' || !value.trim()) throw new TypeError('nom');\n  return value.trim();\n}")],
  'l2-kind-tag': [file('src/kindTag.mjs', "export function kindTag(value) {\n  if (typeof value === 'number') return 'number';\n  if (typeof value === 'string') return 'string';\n  return 'other';\n}")],
  'l2-note-file': [file('src/note.mjs', "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport function noteTitle(root) {\n  return readFileSync(join(root, 'notes/title.txt'), 'utf8').trimEnd();\n}")],
  'l3-quote-fee': [file('src/quote.mjs', 'import { fee } from "./fee.mjs";\nexport function quote(cents) {\n  return cents + fee(cents);\n}')],
};

export type LabSet = 'reference' | 'train' | 'eval' | 'all';

/** Missions d'entraînement : seules leurs réussites vérifiées peuvent devenir des exemples. */
export function trainCatalog(): CatalogEntry[] {
  return [...TRAIN_L1, ...TRAIN_L2, ...TRAIN_L3];
}

/** Missions d'évaluation : les 9 de référence, puis les nouvelles tenues à l'écart. Jamais entraînées. */
export function evalCatalog(): CatalogEntry[] {
  const reference = referenceMissions().map((mission) => ({
    mission: { ...mission, split: 'validation' as const },
    solution: REFERENCE_SOLUTIONS[mission.id] ?? [],
  }));
  return [...reference, ...EVAL_EXTRA];
}

export function catalogEntries(set: LabSet): CatalogEntry[] {
  if (set === 'reference') return evalCatalog().slice(0, referenceMissions().length);
  if (set === 'train') return trainCatalog();
  if (set === 'eval') return evalCatalog();
  return [...trainCatalog(), ...evalCatalog()];
}

export function catalogMissions(set: LabSet): LabMission[] {
  return catalogEntries(set).map((entry) => entry.mission);
}

/**
 * Une mission du catalogue peut-elle fournir un exemple d'entraînement ? Non, aucune (5.0.56).
 * Le catalogue a été écrit avec Claude ; les conditions d'Anthropic interdisent d'utiliser ses
 * réponses pour entraîner un modèle. Le catalogue sert donc uniquement à mesurer. Les exemples
 * d'entraînement viennent du générateur (`labGenerator.ts`), dont un modèle ouvert écrit
 * l'énoncé et la solution.
 */
export function trainable(_mission: Pick<LabMission, 'id'>): boolean {
  return false;
}
