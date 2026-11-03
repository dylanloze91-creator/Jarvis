import { describe, expect, it, vi } from 'vitest';

const rmCalls: Array<{ path: string; options: unknown }> = [];

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    rm: async (path: string, options: unknown) => {
      rmCalls.push({ path, options });
      const err = new Error('EBUSY: resource busy or locked, rmdir') as Error & { code: string };
      err.code = 'EBUSY';
      throw err;
    },
  };
});

import { removeLabDir } from './labRunner.js';

describe('removeLabDir (dossier encore tenu sous Windows)', () => {
  it('réessaie la suppression et ne casse pas la nuit si le dossier reste tenu', async () => {
    rmCalls.length = 0;
    await expect(removeLabDir('/tmp/jarvis-gen-x/verify-a-1-1')).resolves.toBeUndefined();
    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0]!.options).toMatchObject({
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  });

  it('reste bloquant avant de réécrire un dossier (fatal)', async () => {
    await expect(removeLabDir('/tmp/jarvis-gen-x/work', { fatal: true })).rejects.toMatchObject({
      code: 'EBUSY',
    });
  });
});
