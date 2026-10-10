import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  invalidateProjectInventory,
  projectInventoryContext,
} from './projectInventoryCache.js';

describe('projectInventoryCache', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'jarvis-inv-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { test: 'vitest run' } }),
      'utf8',
    );
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('réutilise le cache puis se réactualise après invalidation', () => {
    const a = projectInventoryContext(root);
    const b = projectInventoryContext(root);
    expect(a).toBe(b);
    invalidateProjectInventory(root);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo2', scripts: { test: 'vitest run' } }),
      'utf8',
    );
    const c = projectInventoryContext(root);
    expect(c).toContain('demo2');
    expect(c).not.toBe(a);
  });
});
