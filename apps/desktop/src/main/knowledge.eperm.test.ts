import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let lockAttempts = 0;
let alwaysEperm = false;
let lockStatFails = false;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    stat: async (...args: unknown[]) => {
      if (lockStatFails && String(args[0]).endsWith('knowledge-index.json.lock')) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return (actual.stat as unknown as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    open: async (...args: unknown[]) => {
      const [path, flags] = args;
      if (String(path).endsWith('knowledge-index.json.lock') && flags === 'wx') {
        lockAttempts += 1;
        if (alwaysEperm || lockAttempts === 1) {
          const err = new Error('EPERM') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
      }
      return (actual.open as unknown as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

import { KnowledgeStore, LOCK_WAIT_MS, setLockWaitMsForTests } from './knowledge.js';

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

  it('abandonne avec l’erreur EPERM quand elle dure, sans boucler sans fin', async () => {
    lockAttempts = 0;
    alwaysEperm = true;
    const before = LOCK_WAIT_MS;
    setLockWaitMsForTests(300);
    try {
      const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-eperm-'));
      const store = new KnowledgeStore({
        getUserDataPath: () => dir,
        fetchImpl: async () => new Response('nope', { status: 404 }),
      });
      const { noteToRecord } = await import('@jarvis/core');
      const startedAt = Date.now();
      await expect(
        store.applyLearning(noteToRecord({ id: 'y', text: 'Retiens beta', now: 1 })),
      ).rejects.toMatchObject({ code: 'EPERM' });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      // Des essais espacés (25 ms), pas une boucle serrée : quelques dizaines au plus.
      expect(lockAttempts).toBeGreaterThanOrEqual(2);
      expect(lockAttempts).toBeLessThan(100);
    } finally {
      alwaysEperm = false;
      setLockWaitMsForTests(before);
    }
  });

  it('ne retire jamais un verrou qu’il n’a pas vu vieux (pas de vol de verrou)', async () => {
    lockAttempts = 0;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-learning-steal-'));
    const lock = join(dir, 'knowledge-index.json.lock');
    // Un autre magasin tient le verrou ; sa date ne peut pas être lue (EPERM sous Windows).
    await writeFile(lock, 'autre');
    lockStatFails = true;
    try {
      const store = new KnowledgeStore({
        getUserDataPath: () => dir,
        fetchImpl: async () => new Response('nope', { status: 404 }),
      });
      const { noteToRecord } = await import('@jarvis/core');
      const pending = store.applyLearning(noteToRecord({ id: 'z', text: 'Retiens gamma', now: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await readFile(lock, 'utf8')).toBe('autre');
      // L'autre magasin libère son verrou : celui-ci passe.
      lockStatFails = false;
      await rm(lock);
      await pending;
      expect((await store.listLearning()).map((item) => item.id)).toEqual(['z']);
    } finally {
      lockStatFails = false;
    }
  });
});
