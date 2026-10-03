import { describe, expect, it } from 'vitest';
import type { ToolCallOutcome } from '../types.js';
import { InMemoryAuditLogStore, buildAuditEntry } from './log.js';

const outcome: ToolCallOutcome = {
  callId: 'c1',
  name: 'dev_read_file',
  status: 'ok',
  content: 'Fichier lu.',
  arguments: { path: 'src/index.ts' },
  decision: 'auto',
  durationMs: 3,
  outcome: 'success',
};

describe('rattachement facultatif des entrées du journal (projet, mission, rôle)', () => {
  it('sans rattachement : aucune des trois clés, comme avant', () => {
    const entry = buildAuditEntry(outcome);
    expect(Object.keys(entry).sort()).toEqual(
      [
        'arguments',
        'category',
        'decision',
        'durationMs',
        'id',
        'outcome',
        'resultSummary',
        'status',
        'technicalDetail',
        'timestamp',
        'toolName',
      ].sort(),
    );
    expect(JSON.parse(JSON.stringify(entry))).not.toHaveProperty('projectId');
  });

  it('un rattachement vide ou blanc n’ajoute rien', () => {
    const entry = buildAuditEntry(outcome, { projectId: '  ', missionId: '', role: undefined });
    expect(entry).not.toHaveProperty('projectId');
    expect(entry).not.toHaveProperty('missionId');
    expect(entry).not.toHaveProperty('role');
  });

  it('projet, mission et rôle enregistrés, gardés par le journal', async () => {
    const store = new InMemoryAuditLogStore();
    await store.append(
      buildAuditEntry(outcome, { projectId: 'jarvis', missionId: 'm-42', role: 'REVIEWER' }),
    );
    const [saved] = await store.list();
    expect(saved).toMatchObject({ projectId: 'jarvis', missionId: 'm-42', role: 'REVIEWER' });
  });

  it('borné et masqué comme le reste de l’entrée', () => {
    const entry = buildAuditEntry(outcome, {
      projectId: 'p'.repeat(500),
      missionId: 'apiKey=sk-abcdefghijklmnopqrstuvwxyz0123456789',
    });
    expect(entry.projectId!.length).toBeLessThanOrEqual(120);
    expect(entry.missionId).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
