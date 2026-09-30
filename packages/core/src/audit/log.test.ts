import { describe, expect, it } from 'vitest';
import type { ToolCallOutcome } from '../types.js';
import { buildAuditEntry, InMemoryAuditLogStore } from './log.js';

function outcome(overrides: Partial<ToolCallOutcome> = {}): ToolCallOutcome {
  return {
    callId: 'c1',
    name: 'run_command',
    status: 'ok',
    content: 'sortie de la commande',
    arguments: { command: 'ls' },
    decision: 'approved',
    durationMs: 12,
    category: 'shell',
    ...overrides,
  };
}

describe('buildAuditEntry', () => {
  it('reprend les champs du résultat d’exécution', () => {
    const entry = buildAuditEntry(outcome());
    expect(entry).toMatchObject({
      toolName: 'run_command',
      category: 'shell',
      arguments: { command: 'ls' },
      decision: 'approved',
      status: 'ok',
      durationMs: 12,
    });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('retire un secret des arguments et du résumé', () => {
    const entry = buildAuditEntry(
      outcome({
        content: 'Authorization: Bearer BQC-spotify-token-secret-value',
        arguments: { apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz', query: 'ok' },
        technicalDetail: 'refresh_token=spotify-refresh-very-long-secret',
      }),
    );
    expect(JSON.stringify(entry)).not.toContain('BQC-spotify-token-secret-value');
    expect(JSON.stringify(entry)).not.toContain('sk-live-abcdefghijklmnopqrstuvwxyz');
    expect(JSON.stringify(entry)).not.toContain('spotify-refresh-very-long-secret');
    expect(entry.arguments).toMatchObject({ apiKey: '[REDACTED]', query: 'ok' });
  });

  it('tronque un résultat trop long en une seule ligne', () => {
    const long = 'x'.repeat(1000);
    const entry = buildAuditEntry(outcome({ content: long }));
    expect(entry.resultSummary.length).toBeLessThanOrEqual(400);
    expect(entry.resultSummary.endsWith('…')).toBe(true);
  });

  it('aplati les retours à la ligne du résultat', () => {
    const entry = buildAuditEntry(outcome({ content: 'ligne 1\nligne 2\n\nligne 3' }));
    expect(entry.resultSummary).toBe('ligne 1 ligne 2 ligne 3');
  });
});

describe('InMemoryAuditLogStore', () => {
  it('liste les entrées du plus récent au plus ancien', async () => {
    const store = new InMemoryAuditLogStore();
    await store.append(buildAuditEntry(outcome({ callId: '1', durationMs: 1 })));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.append(buildAuditEntry(outcome({ callId: '2', durationMs: 2 })));

    const entries = await store.list();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.arguments).toEqual({ command: 'ls' });
    expect(entries[0]?.timestamp).toBeGreaterThanOrEqual(entries[1]?.timestamp ?? 0);
  });

  it('respecte la limite demandée', async () => {
    const store = new InMemoryAuditLogStore();
    for (let i = 0; i < 5; i += 1) {
      await store.append(buildAuditEntry(outcome({ callId: String(i) })));
    }
    expect(await store.list(2)).toHaveLength(2);
  });

  it('purge les entrées les plus anciennes au-delà de la capacité', async () => {
    const store = new InMemoryAuditLogStore(3);
    for (let i = 0; i < 5; i += 1) {
      await store.append(buildAuditEntry(outcome({ callId: String(i) })));
    }
    expect(await store.list()).toHaveLength(3);
  });

  it('se vide sur demande', async () => {
    const store = new InMemoryAuditLogStore();
    await store.append(buildAuditEntry(outcome()));
    await store.clear();
    expect(await store.list()).toHaveLength(0);
  });
});
