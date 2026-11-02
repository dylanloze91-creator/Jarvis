import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let lockAttempts = 0;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    open: async (...args: unknown[]) => {
      const [path, flags] = args;
      if (String(path).endsWith('knowledge-index.json.lock') && flags === 'wx') {
        lockAttempts += 1;
        if (lockAttempts === 1) {
          const err = new Error('EPERM') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
      }
      return (actual as { open: (...a: unknown[]) => Promise<unknown> }).open(...args);
    },
  };
});

import { KnowledgeStore } from './knowledge.js';

describe('KnowledgeStore (verrou EPERM Windows)', () => {
  it('réessaie l’acquisition du verrou quand open renvoie EPERM', async () => {
    lockAttempts = 0;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-eperm-'));
    const store = new KnowledgeStore({
      getUserDataPath: () => dir,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const { noteToRecord } = await import('@jarvis/core');
    await store.applyLearning(noteToRecord({ id: 'x', text: 'Retiens alpha', now: 1 }));
    expect(lockAttempts).toBeGreaterThanOrEqual(2);
    expect((await store.listLearning()).map((item) => item.id)).toEqual(['x']);
  });
});
