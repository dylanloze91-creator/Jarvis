import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolManager, defineTool } from './manager.js';
import { buildAuditEntry } from '../audit/log.js';

const visible = defineTool({
  name: 'visible',
  description: 'v',
  risk: 'safe',
  schema: z.object({}),
  execute: async () => ({ ok: true, content: 'v' }),
});

const hidden = defineTool({
  name: 'hidden',
  description: 'h',
  risk: 'safe',
  internal: true,
  schema: z.object({ q: z.string() }),
  execute: async ({ q }) => ({ ok: true, content: `h:${q}`, data: { sources: [q] } }),
});

describe('outil interne', () => {
  it('absent du catalogue du modèle, exécutable et audité comme les autres', async () => {
    const manager = new ToolManager().registerAll([visible, hidden]);
    expect(manager.schemas().map((tool) => tool.name)).toEqual(['visible']);
    const outcome = await manager.execute(
      { id: '1', name: 'hidden', arguments: { q: 'x' } },
      { requestConfirmation: async () => true },
    );
    expect(outcome).toMatchObject({ status: 'ok', content: 'h:x', decision: 'auto', data: { sources: ['x'] } });
    const audit = buildAuditEntry(outcome);
    expect(audit.toolName).toBe('hidden');
    expect(JSON.stringify(audit)).not.toContain('sources');
  });

  it('un outil sans données n’a pas de champ data', async () => {
    const outcome = await new ToolManager()
      .register(visible)
      .execute({ id: '1', name: 'visible', arguments: {} }, { requestConfirmation: async () => true });
    expect('data' in outcome).toBe(false);
    expect(visible.internal).toBeUndefined();
  });
});
