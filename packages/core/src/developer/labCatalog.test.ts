import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { labBrief, labContamination, validateLabMission, type LabFile } from './lab.js';
import { catalogEntries, evalCatalog, trainCatalog, trainable, type CatalogEntry } from './labCatalog.js';
import { executeHiddenTests, labFirstPrompt } from './labRunner.js';

let parent = '';
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'jarvis-catalog-'));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function writeTree(root: string, files: readonly LabFile[]): Promise<void> {
  await rm(root, { recursive: true, force: true });
  for (const item of files) {
    const dest = join(root, item.path);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, item.content);
  }
}

/** Départ, puis départ remplacé par la solution : rouge puis vert. */
async function screen(entry: CatalogEntry): Promise<{ starter: number | null; solved: number | null; output: string }> {
  const root = join(parent, entry.mission.id, 'work');
  await writeTree(root, entry.mission.starterFiles);
  const starter = await executeHiddenTests(root, entry.mission);
  const solved = new Map(entry.mission.starterFiles.map((item) => [item.path, item]));
  for (const item of entry.solution) solved.set(item.path, item);
  await writeTree(root, [...solved.values()]);
  const after = await executeHiddenTests(root, entry.mission);
  return { starter: starter.exitCode, solved: after.exitCode, output: after.output };
}

describe('catalogue du laboratoire', () => {
  const all = catalogEntries('all');

  it('identifiants uniques, jeux d’entraînement et d’évaluation disjoints', () => {
    const ids = all.map((entry) => entry.mission.id);
    expect(new Set(ids).size).toBe(ids.length);
    const evalIds = new Set(evalCatalog().map((entry) => entry.mission.id));
    expect(trainCatalog().filter((entry) => evalIds.has(entry.mission.id))).toEqual([]);
    expect(evalCatalog().every((entry) => entry.mission.split === 'validation')).toBe(true);
    expect(trainCatalog().every((entry) => entry.mission.split === 'development')).toBe(true);
    // 5.0.56 : le catalogue (écrit avec Claude) sert à mesurer, jamais à entraîner.
    expect(all.some((entry) => trainable(entry.mission))).toBe(false);
    expect(trainCatalog().length).toBeGreaterThanOrEqual(90);
    expect(evalCatalog().length).toBeGreaterThanOrEqual(25);
  });

  it('chaque mission a une forme valide et une solution qui ne touche que ses fichiers', () => {
    for (const entry of all) {
      expect(validateLabMission(entry.mission), entry.mission.id).toEqual({ ok: true });
      expect(entry.solution.length, entry.mission.id).toBeGreaterThan(0);
      const starters = new Set(entry.mission.starterFiles.map((item) => item.path));
      expect(entry.solution.every((item) => starters.has(item.path)), entry.mission.id).toBe(true);
    }
  });

  it('aucune mission n’est une variante d’une autre (sinon le banc l’écarte comme contaminée)', () => {
    for (let i = 0; i < all.length; i += 1) {
      const earlier = all.slice(0, i).map((entry) => ({ goal: entry.mission.goal, missionId: 'autre' }));
      expect(labContamination({ id: all[i]!.mission.id, goal: all[i]!.mission.goal }, earlier), all[i]!.mission.id).toBeNull();
    }
  });

  it('la demande montrée au modèle ne contient ni les tests cachés ni la solution', () => {
    for (const entry of all) {
      const prompt = labFirstPrompt(entry.mission);
      for (const hidden of entry.mission.hiddenTests) expect(prompt.includes(hidden.content.trim()), entry.mission.id).toBe(false);
      const starters = new Map(entry.mission.starterFiles.map((item) => [item.path, item.content]));
      for (const solved of entry.solution) {
        if (starters.get(solved.path) === solved.content) continue;
        expect(prompt.includes(solved.content.trim()), entry.mission.id).toBe(false);
      }
      expect(labBrief(entry.mission).files.length).toBe(entry.mission.starterFiles.length);
    }
  });

  it('tests rouges sur le départ, verts avec la solution de référence', { timeout: 600_000 }, async () => {
    const broken: string[] = [];
    for (const entry of all) {
      const result = await screen(entry);
      if (result.starter === 0) broken.push(`${entry.mission.id} : déjà vert au départ`);
      if (result.starter === null) broken.push(`${entry.mission.id} : départ sans code de sortie`);
      if (result.solved !== 0) broken.push(`${entry.mission.id} : solution rouge\n${result.output.slice(0, 600)}`);
    }
    expect(broken).toEqual([]);
  });
});
