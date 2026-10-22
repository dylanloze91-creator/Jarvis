import { describe, expect, it } from 'vitest';
import { formatLearningContext, relevantRecords, type LearningRecord } from './continuous.js';
import { coderLearningPrompt, selectInjection } from './injection.js';
import { settleSkill, skillFromObservation } from './skills.js';

function experience(id: string, from: string, to: string, language = 'typescript'): LearningRecord {
  return {
    id,
    type: 'experience',
    content: 'add multiplie',
    origin: 'mission',
    createdAt: 1,
    lastCheckedAt: 1,
    confidence: 0.8,
    confidenceReason: 'mission',
    status: 'validated',
    sources: [],
    links: [],
    errorSignature: 'les tests add',
    fix: '',
    hint: { from, to, language, steps: [{ from, to, role: 'source' }] },
    trace: {
      problem: 'atelier',
      context: 'atelier',
      firstTry: '',
      observedErrors: '',
      appliedFix: 'ligne',
      testsRun: [],
      finalResult: 'vert',
      limits: 'ce fichier',
      language,
      problemType: 'expérience',
      runtimeVersion: process.version,
      outcome: 'passed',
    },
  };
}

function preference(): LearningRecord {
  return {
    id: 'regle',
    type: 'preference',
    content: 'Commence par OK sur une seule ligne',
    origin: 'user',
    createdAt: 1,
    lastCheckedAt: 1,
    confidence: 0.9,
    confidenceReason: 'utilisateur',
    status: 'validated',
    sources: [],
    links: [],
  };
}

const SOURCE = `export function total(a: number, b: number): number {\n  return a * b;\n}\n`;
const QUERY = 'Les tests de ce fichier échouent vraiment';

function lastSkill(): LearningRecord {
  const created = skillFromObservation({
    id: 'skill-last',
    now: 1,
    ok: true,
    language: 'typescript',
    request: 'prendre le dernier élément',
    beforeSource: 'return items[items.length];',
    afterSource: 'return items[items.length - 1];',
    tests: '',
    originLabel: 'atelier',
    runtimeVersion: process.version,
  });
  if (!created) throw new Error('compétence absente');
  return settleSkill(created, { ok: true, context: 'autre-projet', now: 2 });
}

describe('injection sélective', () => {
  it('n’injecte rien sans fichier, même si des mots se recoupent', () => {
    const card = experience('somme', 'return a * b;', 'return a + b;');
    const decision = selectInjection([card], { query: QUERY, memory: true, skills: true });
    expect(decision.experience).toBeNull();
    expect(decision.skill).toBeNull();
    expect(decision.prompt).toBe('');
    expect(relevantRecords([card], QUERY).map((item) => item.id)).toEqual(['somme']);
    expect(coderLearningPrompt([card], { query: QUERY, memory: true, skills: true })).toBe('');
  });

  it('injecte un seul indice si la ligne est dans ce fichier, sans en faire une règle', () => {
    const card = experience('somme', 'return a * b;', 'return a + b;');
    const decision = selectInjection([card], {
      query: QUERY,
      source: SOURCE,
      language: 'typescript',
      version: process.version,
      memory: true,
      skills: false,
    });
    expect(decision.experience?.id).toBe('somme');
    expect(decision.prompt).toContain('return a + b');
    expect(decision.prompt).toContain('Ce n’est pas une règle');
    expect(decision.prompt).toMatch(/sans recopier/);
    expect(decision.prompt).not.toMatch(/Applique-les/);
    expect(decision.prompt).not.toMatch(/remplacer/);
    expect(formatLearningContext([card])).not.toMatch(/Applique-les/);
    expect(formatLearningContext([card])).toContain('return a + b');
    expect(formatLearningContext([card])).toMatch(/sans recopier/);
  });

  it('n’injecte pas une ligne absente, un autre langage, ou deux cibles contradictoires', () => {
    const card = experience('somme', 'return a * b;', 'return a + b;');
    const absent = selectInjection([card], {
      query: QUERY,
      source: 'export function gap(left: number, right: number) {\n  return left - right;\n}\n',
      language: 'typescript',
      memory: true,
      skills: false,
    });
    expect(absent.prompt).toBe('');
    const other = selectInjection([card], {
      query: QUERY,
      source: SOURCE,
      language: 'python',
      memory: true,
      skills: false,
    });
    expect(other.prompt).toBe('');
    const clash = selectInjection(
      [card, experience('produit', 'return a * b;', 'return a / b;')],
      { query: QUERY, source: SOURCE, language: 'typescript', memory: true, skills: false },
    );
    expect(clash.experience).toBeNull();
    expect(clash.skipped).toContain('indices contradictoires');
  });

  it('laisse le modèle seul quand la récupération ou la bibliothèque est coupée', () => {
    const card = experience('somme', 'return a * b;', 'return a + b;');
    const off = selectInjection([card, lastSkill()], {
      query: 'dernier élément',
      source: 'export function final(cells: string[]) {\n  return cells[cells.length];\n}\n',
      tests: "assert.equal(final(['a', 'z']), 'z');",
      language: 'typescript',
      version: process.version,
      memory: false,
      skills: false,
    });
    expect(off.prompt).toBe('');
    expect(off.experience).toBeNull();
    expect(off.skill).toBeNull();
  });

  it('n’injecte pas une compétence qui ne convient pas aux tests de ce fichier', () => {
    const skill = lastSkill();
    expect(skill.status).toBe('validated');
    const first = selectInjection([skill], {
      query: 'premier élément',
      source: 'export function final(cells: string[]) {\n  return cells[cells.length];\n}\n',
      tests: "assert.equal(final(['a', 'z']), 'a');",
      language: 'typescript',
      version: process.version,
      memory: false,
      skills: true,
    });
    expect(first.skill).toBeNull();
    expect(first.prompt).toBe('');
    expect(first.prompt).not.toContain('return a + b');
  });

  it('injecte la compétence qui convient, sans la ligne d’un autre atelier', () => {
    const skill = lastSkill();
    const card = experience('somme', 'return a * b;', 'return a + b;');
    const decision = selectInjection([skill, card], {
      query: 'dernier élément',
      source: 'export function final(cells: string[]) {\n  return cells[cells.length];\n}\n',
      tests: "assert.equal(final(['a', 'z']), 'z');\nassert.equal(final(['seul']), 'seul');",
      language: 'typescript',
      version: process.version,
      memory: true,
      skills: true,
    });
    expect(decision.skill?.id).toBe('skill-last');
    expect(decision.experience).toBeNull();
    expect(decision.prompt).toContain(skill.skill?.name ?? 'absent');
    expect(decision.prompt).not.toContain('return a + b');
    expect(decision.prompt).not.toContain('cells[cells.length - 1]');
  });

  it('garde les règles et retire l’indice du prompt tant que la ligne n’est pas là', () => {
    const card = experience('somme', 'return a * b;', 'return a + b;');
    const prompt = coderLearningPrompt([preference(), card], {
      query: 'plateformes',
      memory: true,
      skills: true,
    });
    expect(prompt).toMatch(/Applique-les/);
    expect(prompt).toContain('OK');
    expect(prompt).not.toContain('return a + b');
  });
});
