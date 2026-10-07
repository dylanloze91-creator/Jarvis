import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planLocalLearningTrain } from '@jarvis/core';
import { LocalLearningStore } from './store.js';
import { dryRunTrain } from './trainer.js';

describe('local learning trainer', () => {
  it('dry-run produit un modèle personnel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-learn-'));
    const store = new LocalLearningStore(() => root);
    const plan = planLocalLearningTrain('qwen2.5:3b');
    const examples = Array.from({ length: 6 }, (_, i) => ({
      id: `ex-${i}`,
      at: Date.now(),
      user: `demande ${i}`,
      assistant: `réponse ${i}`,
      toolsOk: [],
      conversationId: 'c1',
    }));
    const out = await dryRunTrain(store, plan, examples);
    expect(out.ok).toBe(true);
    expect(out.ollamaModel).toBe('jarvis-local-personal');
    await rm(root, { recursive: true, force: true });
  });
});
