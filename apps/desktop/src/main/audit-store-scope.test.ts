import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '@jarvis/core';

const userDataDir = await mkdtemp(join(tmpdir(), 'jarvis-audit-scope-'));
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }));

const { FileAuditLogStore } = await import('./audit-store.js');

const base: AuditEntry = {
  id: 'ancienne',
  timestamp: 1_000,
  toolName: 'get_system_info',
  arguments: {},
  decision: 'auto',
  status: 'ok',
  resultSummary: '',
  durationMs: 1,
};

describe('journal sur disque : projet, mission et rôle facultatifs', () => {
  afterAll(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  it('une entrée rattachée et une entrée d’avant cohabitent dans le même fichier', async () => {
    const store = new FileAuditLogStore();
    await store.append(base);
    await store.append({
      ...base,
      id: 'rattachee',
      timestamp: 2_000,
      projectId: 'jarvis',
      missionId: 'm-1',
      role: 'CODER',
    });

    const [recent, old] = await store.list();
    expect(recent).toMatchObject({
      id: 'rattachee',
      projectId: 'jarvis',
      missionId: 'm-1',
      role: 'CODER',
    });
    expect(old).toEqual(base);

    const raw = JSON.parse(
      await readFile(join(userDataDir, 'audit-log.json'), 'utf8'),
    ) as AuditEntry[];
    expect(raw[0]).not.toHaveProperty('projectId');
  });
});
