import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalCatalog, trainCatalog, trainable, type CatalogEntry } from './labCatalog.js';
import { LAB_SYSTEM_PROMPT, labFirstPrompt, labTrainingExample, runLabMission, type LabModel } from './labRunner.js';

let parent = '';
beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'jarvis-training-'));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** Modèle scripté : écrit la solution de référence, ou un code faux. */
function scripted(entry: CatalogEntry, correct: boolean): LabModel {
  return {
    name: 'scripte',
    digest: 'scripte000000',
    async complete({ messages }) {
      if (messages.at(-1)?.role === 'tool') return { text: 'Fait.', toolCalls: [] };
      return {
        text: '',
        toolCalls: entry.solution.map((item, index) => ({
          id: `c${index}`,
          name: 'write_file',
          arguments: { path: item.path, content: correct ? item.content : 'export const faux = 1;\n' },
        })),
      };
    },
  };
}

async function run(entry: CatalogEntry, correct: boolean) {
  return runLabMission({
    mission: entry.mission,
    model: scripted(entry, correct),
    arm: 'alone',
    workRoot: join(parent, `${entry.mission.id}-${correct}`),
    maxAttempts: 1,
  });
}

describe('exemples d’entraînement du laboratoire', () => {
  const train = trainCatalog().find((entry) => entry.mission.id === 't3-cart-total')!;
  const evaluation = evalCatalog().find((entry) => entry.mission.id === 'e2-median')!;

  it('une mission d’entraînement réussie donne un exemple : demande du premier essai, write_file du fichier vérifié', async () => {
    const result = await run(train, true);
    // Mécanique du format seulement : une mission du catalogue n'est pas entraînable (5.0.56).
    const example = labTrainingExample(train.mission, result, { trainable: true, model: 'scripte' });
    expect(labTrainingExample(train.mission, result, { trainable: trainable(train.mission), model: 'scripte' })).toBeNull();
    expect(example).not.toBeNull();
    expect(example!.messages[0]).toEqual({ role: 'system', content: LAB_SYSTEM_PROMPT });
    expect(example!.messages[1]).toEqual({ role: 'user', content: labFirstPrompt(train.mission) });
    expect(example!.messages[2].tool_calls).toEqual([
      { type: 'function', function: { name: 'write_file', arguments: { path: 'src/cart.mjs', content: train.solution[0]!.content } } },
    ]);
    expect(example!.tools.map((tool) => tool.function.name)).toEqual(['list_files', 'read_file', 'write_file']);
    expect(example!.meta).toMatchObject({ mission: 't3-cart-total', level: 3, firstTry: true, source: 'lab' });
  });

  it('un échec ne donne jamais d’exemple', async () => {
    const result = await run(train, false);
    expect(labTrainingExample(train.mission, result, { trainable: true, model: 'scripte' })).toBeNull();
  });

  it('une mission d’évaluation réussie ne donne jamais d’exemple', async () => {
    const result = await run(evaluation, true);
    expect(result.attempts.at(-1)?.exitCode).toBe(0);
    expect(labTrainingExample(evaluation.mission, result, { trainable: trainable(evaluation.mission), model: 'scripte' })).toBeNull();
    expect(labTrainingExample(evaluation.mission, result, { trainable: true, model: 'scripte' })).toBeNull();
  });
});
