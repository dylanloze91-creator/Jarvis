import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalCatalog } from './labCatalog.js';
import { LAB_TOOLS, type LabTrainingExample } from './labRunner.js';
import {
  PREP_DEFAULTS,
  estimateTokens,
  exactKey,
  examContamination,
  examFingerprint,
  parseExampleLine,
  prepareTrainingData,
  preparationFiles,
  readExerciseInfo,
  refusalMessage,
  splitByLevel,
  validationCount,
} from './labTrainPrep.js';
import type { LabLevel } from './lab.js';

/**
 * Exemples synthétiques de test : minuscules, marqués comme tels (`modele: synthetique-test`),
 * jamais copiés dans le cahier. Aucun n'est un exercice réel.
 */
function synthetic(input: { n: number; level?: LabLevel; goal?: string; path?: string; content?: string; mission?: string }): LabTrainingExample {
  const level = input.level ?? 1;
  const mission = input.mission ?? `g${level}-synthetique-${String(input.n).padStart(3, '0')}`;
  const path = input.path ?? `src/synthetique${input.n}.mjs`;
  const content = input.content ?? `export function synthetique${input.n}(x) {\n  return x + ${input.n};\n}\n`;
  const goal = input.goal ?? `Exemple synthétique de test numéro ${input.n} : ajouter ${input.n} à un nombre.`;
  return {
    id: `${mission}:synthetique-test:${content.length}`,
    messages: [
      { role: 'system', content: 'Consigne synthétique de test.' },
      { role: 'user', content: `${goal}\n\nFichier ${path} :\nexport function synthetique${input.n}(x) {\n  return 0;\n}\n\nÉcris le fichier.` },
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'write_file', arguments: { path, content } } }] },
    ],
    tools: LAB_TOOLS.map((tool) => ({ type: 'function' as const, function: tool })),
    meta: { mission, level, category: 'logic', model: 'synthetique-test', attempts: 1, firstTry: true, source: 'generated' },
  };
}

function line(example: LabTrainingExample): string {
  return JSON.stringify(example);
}

function exerciseLine(mission: string, level: LabLevel, theme: string, goal: string): string {
  return JSON.stringify({ mission: { id: mission, level, category: 'logic', goal, starterFiles: [] }, provenance: { seed: { level, theme } } });
}

/** Cahier synthétique assez grand pour passer le minimum (100). */
function corpus(count: number, levelOf: (n: number) => LabLevel = (n) => ((n % 3) + 1) as LabLevel): string[] {
  return Array.from({ length: count }, (_, index) => line(synthetic({ n: index + 1, level: levelOf(index + 1) })));
}

describe('préparation des données : lecture et écarts', () => {
  it('écarte une ligne illisible, un exemple sans write_file et un doublon exact, avec la raison', () => {
    const good = synthetic({ n: 1 });
    const noCall: LabTrainingExample = { ...good, id: 'sans-appel', messages: [good.messages[0], good.messages[1], { role: 'assistant', content: 'Voilà.', tool_calls: [] }] };
    const lines = [line(good), 'ceci n’est pas du JSON', line(noCall), line({ ...good, id: 'copie', meta: { ...good.meta, attempts: 2 } }), ...corpus(120).slice(1)];
    const result = prepareTrainingData({ exampleLines: lines });
    expect(result.ok).toBe(true);
    expect(result.setAside).toEqual([
      { line: 2, id: null, reason: 'ligne illisible' },
      { line: 3, id: 'sans-appel', reason: 'sans appel write_file' },
      { line: 4, id: 'copie', reason: 'doublon exact de la ligne 1' },
    ]);
    expect(result.summary.setAside.byReason).toEqual({ 'ligne illisible': 1, 'sans appel write_file': 1, 'doublon exact': 1 });
    expect(result.summary.kept).toBe(120);
  });

  it('un write_file au contenu vide ou une conversation sans demande sont écartés', () => {
    const empty = synthetic({ n: 2, content: '   \n' });
    expect(parseExampleLine(line(empty))).toEqual({ ok: false, reason: 'appel d’outil non conforme : write_file au contenu vide', id: empty.id });
    const noUser = { ...synthetic({ n: 3 }), messages: [{ role: 'system', content: 'x' }] };
    expect(parseExampleLine(JSON.stringify(noUser))).toEqual({ ok: false, reason: 'ligne illisible', id: noUser.id });
    expect(parseExampleLine('{"id":"x"}')).toEqual({ ok: false, reason: 'ligne illisible', id: 'x' });
  });

  it('applique la même règle que l’entraînement Python : un appel non conforme ou un catalogue absent écarte l’exemple entier', () => {
    const good = synthetic({ n: 13 });
    const call = good.messages[2].tool_calls[0]!;
    const withOther: LabTrainingExample = {
      ...good,
      messages: [good.messages[0], good.messages[1], { role: 'assistant', content: '', tool_calls: [call, { type: 'function', function: { name: 'run_command', arguments: { path: 'x', content: 'npm test' } } }] }],
    };
    expect(parseExampleLine(line(withOther))).toEqual({ ok: false, reason: 'appel d’outil non conforme : run_command au lieu de write_file', id: good.id });
    const badArgs = { ...good, messages: [good.messages[0], good.messages[1], { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'write_file', arguments: { path: 'x' } } }] }] };
    expect(parseExampleLine(JSON.stringify(badArgs))).toEqual({ ok: false, reason: 'appel d’outil non conforme : write_file attend path et content en chaînes', id: good.id });
    const noTools = { ...good, tools: [] };
    expect(parseExampleLine(JSON.stringify(noTools))).toEqual({ ok: false, reason: 'sans catalogue tools', id: good.id });
    const result = prepareTrainingData({ exampleLines: [line(withOther), JSON.stringify(noTools), ...corpus(120)] });
    expect(result.summary.setAside.byReason).toEqual({ 'appel d’outil non conforme': 1, 'sans catalogue tools': 1 });
  });

  it('la clé de doublon ignore les métadonnées et voit un contenu différent', () => {
    const a = synthetic({ n: 4 });
    expect(exactKey(a)).toBe(exactKey({ ...a, id: 'autre', meta: { ...a.meta, model: 'autre' } }));
    expect(exactKey(a)).not.toBe(exactKey(synthetic({ n: 4, content: 'export const autre = 1;\n' })));
  });

  it('applique le plafond de longueur en jetons estimés, réglable', () => {
    const long = synthetic({ n: 5, content: `export const texte = '${'a'.repeat(12_000)}';\n` });
    const tokens = estimateTokens(long);
    expect(tokens).toBeGreaterThan(PREP_DEFAULTS.maxTokens);
    const refused = prepareTrainingData({ exampleLines: [line(long), ...corpus(120)] });
    expect(refused.setAside).toEqual([{ line: 1, id: long.id, reason: `trop long (${tokens} jetons estimés, plafond ${PREP_DEFAULTS.maxTokens})` }]);
    const raised = prepareTrainingData({ exampleLines: [line(long), ...corpus(120)], options: { maxTokens: tokens } });
    expect(raised.setAside).toEqual([]);
    expect(raised.summary.tokens.max).toBe(tokens);
    expect(raised.summary.tokens.cap).toBe(tokens);
  });

  it('refuse de préparer avec moins de 100 exemples gardés, sans rien découper', () => {
    const result = prepareTrainingData({ exampleLines: corpus(99) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('refus attendu');
    expect(result.reason).toBe(refusalMessage(99, 100));
    expect(result.reason).toContain('il faut encore des nuits de génération');
    expect(result.summary.train).toBe(0);
    expect(result.summary.kept).toBe(99);
    const lowered = prepareTrainingData({ exampleLines: corpus(99), options: { minKept: 50 } });
    expect(lowered.ok).toBe(true);
  });

  it('prend le niveau et le thème dans exercices.jsonl quand l’exercice y est', () => {
    const example = synthetic({ n: 6, level: 1 });
    const exercises = [exerciseLine(example.meta.mission, 3, 'aquarium', 'Objectif synthétique de test numéro 6.')];
    const info = readExerciseInfo([...exercises, 'pas du json', JSON.stringify({ mission: { id: 'sans-niveau' } })]);
    expect(info.get(example.meta.mission)).toEqual({ level: 3, category: 'logic', theme: 'aquarium', goal: 'Objectif synthétique de test numéro 6.' });
    expect(info.size).toBe(1);
    const result = prepareTrainingData({ exampleLines: [line(example), ...corpus(120)], exerciseLines: exercises });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('préparation attendue');
    const kept = [...result.train, ...result.validation].find((item) => item.id === example.id)!;
    expect(kept.level).toBe(3);
    expect(kept.theme).toBe('aquarium');
    expect(result.summary.source.exercises).toBe(1);
  });
});

describe('préparation des données : contamination de l’examen', () => {
  const exam = evalCatalog();
  const median = exam.find((entry) => entry.mission.id === 'e2-median')!;

  it('écarte un exemple qui reprend l’objectif d’une mission d’évaluation', () => {
    const copycat = synthetic({ n: 7, goal: median.mission.goal, mission: 'g2-copie-objectif' });
    expect(examContamination(copycat, [{ path: 'src/x.mjs', content: 'export const x = 1;\n' }], undefined)).toMatch(/trop proche/);
    const result = prepareTrainingData({ exampleLines: [line(copycat), ...corpus(120)] });
    expect(result.setAside).toHaveLength(1);
    expect(result.setAside[0]).toMatchObject({ line: 1, id: copycat.id });
    expect(result.setAside[0]!.reason).toMatch(/^suspect de contamination de l’examen : /);
    expect(result.summary.setAside.byReason).toEqual({ 'suspect de contamination de l’examen': 1 });
  });

  it('écarte un exemple dont l’identifiant est celui d’une mission d’évaluation', () => {
    const sameId = synthetic({ n: 8, mission: median.mission.id });
    expect(examContamination(sameId, [{ path: 'src/x.mjs', content: 'export const x = 1;\n' }], undefined)).toMatch(/déjà servi|a déjà/);
  });

  it('écarte un exemple dont le fichier exporte un nom de l’évaluation', () => {
    const solution = median.solution[0]!;
    const name = /export\s+function\s+(\w+)/.exec(solution.content)![1]!;
    const sameName = synthetic({ n: 9, content: `export function ${name}(a) {\n  return a;\n}\n` });
    expect(examContamination(sameName, [{ path: 'src/x.mjs', content: `export function ${name}(a) {\n  return a;\n}\n` }], undefined)).toBe(
      `nom ${name} déjà utilisé par l’évaluation`,
    );
  });

  it('écarte un exemple dont la solution est identique à une solution de référence', () => {
    const solution = median.solution[0]!;
    const info = { level: median.mission.level, goal: 'Objectif synthétique sans rapport avec la mission reprise.' };
    const identical = synthetic({ n: 11, goal: info.goal });
    expect(examContamination(identical, [{ path: solution.path, content: `${solution.content}\n` }], info)).toBe(
      `solution identique à celle de l’évaluation (${median.mission.id})`,
    );
    // Même corps sous un autre nom : ni le nom ni le texte ne correspondent, le contrôle laisse passer (limite connue).
    const renamed = solution.content.replace(/export\s+function\s+\w+/, 'export function autreNomSynthetique');
    expect(examContamination(synthetic({ n: 10 }), [{ path: 'src/x.mjs', content: renamed }], undefined)).toBeNull();
  });

  it('écarte les 29 missions de l’examen passées en exemples : énoncé repris, noms repris, solution reformatée', () => {
    // Trois déguisements par mission d'évaluation (construits en mémoire, jamais écrits dans un cahier) :
    // (a) l'objectif de la mission mot pour mot, avec une solution quelconque ;
    // (b) un objectif sans rapport, mais la solution de référence reformatée (indentation, lignes vides) : mêmes noms exportés ;
    // (c) un objectif sans rapport et la solution de référence telle quelle.
    const reformat = (content: string) => content.replace(/\n/g, '\n\n').replace(/ {2}/g, '\t');
    const disguised = exam.flatMap((entry, index) => {
      const solution = entry.solution[0]!;
      const unrelated = `Exemple synthétique de test sans rapport numéro ${index} : additionner deux nombres.`;
      return [
        synthetic({ n: 1000 + index, level: entry.mission.level, goal: entry.mission.goal, mission: `g${entry.mission.level}-deguisement-a-${index}` }),
        synthetic({ n: 2000 + index, level: entry.mission.level, goal: unrelated, path: solution.path, content: reformat(solution.content), mission: `g${entry.mission.level}-deguisement-b-${index}` }),
        synthetic({ n: 3000 + index, level: entry.mission.level, goal: unrelated, path: solution.path, content: solution.content, mission: `g${entry.mission.level}-deguisement-c-${index}` }),
      ];
    });
    expect(exam).toHaveLength(29);
    expect(disguised).toHaveLength(87);
    const result = prepareTrainingData({ exampleLines: [...disguised.map(line), ...corpus(120)] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('préparation attendue');
    const keptIds = new Set([...result.train, ...result.validation].map((item) => item.id));
    for (const example of disguised) expect(keptIds.has(example.id), example.meta.mission).toBe(false);
    expect(result.setAside).toHaveLength(87);
    for (const item of result.setAside) expect(item.reason).toMatch(/^suspect de contamination de l’examen : /);
    expect(result.summary.setAside.byReason).toEqual({ 'suspect de contamination de l’examen': 87 });
    expect(result.summary.kept).toBe(120);
  });

  it('l’empreinte du catalogue d’évaluation est écrite dans resume.json et training/examen-empreinte.json la reprend', () => {
    const fingerprint = examFingerprint();
    expect(fingerprint.missions).toBe(29);
    expect(fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(examFingerprint()).toEqual(fingerprint);
    const files = preparationFiles(prepareTrainingData({ exampleLines: corpus(120) }));
    expect(JSON.parse(files['resume.json']!).examCatalog).toEqual(fingerprint);
    // Le fichier lu par train_lora.py : s'il diffère, l'examen a changé → le mettre à jour ici et relancer lab:prepare.
    const reference = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../training/examen-empreinte.json'), 'utf8'));
    expect({ missions: reference.missions, sha256: reference.sha256 }).toEqual(fingerprint);
  });

  it('l’objectif vient de l’exercice s’il est connu, sinon du premier paragraphe de la demande', () => {
    const example = synthetic({ n: 12 });
    const info = { level: 1 as const, goal: median.mission.goal };
    expect(examContamination(example, [{ path: 'src/x.mjs', content: 'export const x = 1;\n' }], info)).toMatch(/trop proche/);
    expect(examContamination(example, [{ path: 'src/x.mjs', content: 'export const x = 1;\n' }], undefined)).toBeNull();
  });
});

describe('préparation des données : découpe', () => {
  it('découpe 90 / 10 par niveau, déterministe, indépendante de l’ordre des lignes', () => {
    const lines = corpus(150);
    const first = prepareTrainingData({ exampleLines: lines });
    const second = prepareTrainingData({ exampleLines: lines });
    const shuffled = prepareTrainingData({ exampleLines: [...lines].reverse() });
    expect(first.ok && second.ok && shuffled.ok).toBe(true);
    if (!first.ok || !second.ok || !shuffled.ok) throw new Error('préparation attendue');
    const ids = (items: { id: string }[]) => items.map((item) => item.id).sort();
    expect(ids(first.validation)).toEqual(ids(second.validation));
    expect(ids(first.validation)).toEqual(ids(shuffled.validation));
    expect(ids(first.train)).toEqual(ids(shuffled.train));
    expect(first.summary.levels.kept).toEqual({ 1: 50, 2: 50, 3: 50 });
    expect(first.summary.levels.validation).toEqual({ 1: 5, 2: 5, 3: 5 });
    expect(first.summary.levels.train).toEqual({ 1: 45, 2: 45, 3: 45 });
    expect(new Set([...ids(first.train), ...ids(first.validation)]).size).toBe(150);
  });

  it('une autre graine ou une autre part change la découpe, jamais le total', () => {
    const lines = corpus(150);
    const a = prepareTrainingData({ exampleLines: lines });
    const b = prepareTrainingData({ exampleLines: lines, options: { seed: 7 } });
    const c = prepareTrainingData({ exampleLines: lines, options: { validationShare: 0.2 } });
    if (!a.ok || !b.ok || !c.ok) throw new Error('préparation attendue');
    expect(a.validation.map((item) => item.id).sort()).not.toEqual(b.validation.map((item) => item.id).sort());
    expect(b.train.length + b.validation.length).toBe(150);
    expect(c.summary.levels.validation).toEqual({ 1: 10, 2: 10, 3: 10 });
  });

  it('ne met jamais tout un niveau en validation', () => {
    expect(validationCount(1, 0.5)).toBe(0);
    expect(validationCount(2, 0.5)).toBe(1);
    expect(validationCount(3, 0.1)).toBe(0);
    expect(validationCount(5, 0.1)).toBe(1);
    const items = [{ id: 'b', level: 2 as const }, { id: 'a', level: 2 as const }];
    const split = splitByLevel(items, 0.9, 1);
    expect(split.validation).toHaveLength(1);
    expect(split.train).toHaveLength(1);
  });
});

describe('préparation des données : fichiers écrits', () => {
  it('réécrit les lignes gardées à l’identique et décrit les écarts et le résumé', () => {
    const lines = ['pas du json', ...corpus(120)];
    const result = prepareTrainingData({ exampleLines: lines });
    const files = preparationFiles(result, new Date('2026-11-02T00:00:00Z'));
    expect(Object.keys(files).sort()).toEqual(['ecartes.jsonl', 'resume.json', 'train.jsonl', 'validation.jsonl']);
    const written = [...files['train.jsonl']!.split('\n'), ...files['validation.jsonl']!.split('\n')].filter(Boolean).sort();
    expect(written).toEqual(lines.slice(1).sort());
    expect(files['ecartes.jsonl']).toBe('{"line":1,"id":null,"reason":"ligne illisible"}\n');
    const summary = JSON.parse(files['resume.json']!);
    expect(summary).toMatchObject({ at: '2026-11-02T00:00:00.000Z', ok: true, kept: 120, train: 108, validation: 12, setAside: { total: 1 } });
    expect(summary.options).toEqual({ maxTokens: 3072, validationShare: 0.1, seed: 5065, minKept: 100 });
  });

  it('un refus n’écrit ni train ni validation, seulement les écarts et le résumé avec la raison', () => {
    const files = preparationFiles(prepareTrainingData({ exampleLines: corpus(10) }));
    expect(Object.keys(files).sort()).toEqual(['ecartes.jsonl', 'resume.json']);
    expect(JSON.parse(files['resume.json']!)).toMatchObject({ ok: false, reason: refusalMessage(10, 100), kept: 10 });
  });
});
