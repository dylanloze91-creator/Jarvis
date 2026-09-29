import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '@jarvis/core';

const userDataDir = await mkdtemp(join(tmpdir(), 'jarvis-audit-'));
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }));

const { FileAuditLogStore } = await import('./audit-store.js');

function entry(index: number): AuditEntry {
  return {
    id: `e${index}`,
    timestamp: 1_000 + index,
    toolName: 'get_system_info',
    arguments: {},
    decision: 'auto',
    status: 'ok',
    resultSummary: '',
    durationMs: 1,
  };
}

describe('journal d’audit sur disque', () => {
  afterAll(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  it('garde chaque entrée quand plusieurs outils finissent en même temps', async () => {
    const store = new FileAuditLogStore();
    await Promise.all(Array.from({ length: 8 }, (_, index) => store.append(entry(index))));

    const listed = await store.list();
    expect(listed.map((item) => item.id).sort()).toEqual(
      ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'],
    );
  });

  it('vide puis réécrit dans l’ordre des demandes', async () => {
    const store = new FileAuditLogStore();
    void store.append(entry(20));
    void store.clear();
    void store.append(entry(21));
    expect((await store.list()).map((item) => item.id)).toEqual(['e21']);
  });
});
