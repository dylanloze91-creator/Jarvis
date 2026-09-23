import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolManager, defineTool } from './manager.js';
import type { ToolContext } from './types.js';

const allow: ToolContext = { requestConfirmation: async () => true };
const refuse: ToolContext = { requestConfirmation: async () => false };

const readTool = defineTool({
  name: 'read_value',
  description: 'Retourne une valeur de test.',
  risk: 'safe',
  schema: z.object({ key: z.string() }),
  execute: async ({ key }) => ({ ok: true, content: `valeur de ${key}` }),
});

const writeTool = defineTool({
  name: 'write_value',
  description: 'Écrit une valeur de test.',
  risk: 'confirm',
  schema: z.object({ key: z.string(), value: z.string() }),
  summarize: ({ key }) => `Écrire dans ${key}`,
  execute: async () => ({ ok: true, content: 'écrit' }),
});

const bannedTool = defineTool({
  name: 'format_disk',
  description: 'Outil désactivé.',
  risk: 'denied',
  schema: z.object({}),
  execute: async () => ({ ok: true, content: 'jamais' }),
});

function manager(): ToolManager {
  return new ToolManager().registerAll([readTool, writeTool, bannedTool]);
}

describe('ToolManager', () => {
  it('expose au modèle tous les outils sauf ceux qui sont interdits', () => {
    const names = manager()
      .schemas()
      .map((schema) => schema.name);
    expect(names).toEqual(['read_value', 'write_value']);
  });

  it('génère un schéma JSON exploitable par les providers', () => {
    const schema = manager().schemas()[0];
    expect(schema?.parameters).toMatchObject({
      type: 'object',
      properties: { key: { type: 'string' } },
    });
  });

  it('exécute un outil sûr sans demander de confirmation', async () => {
    const requestConfirmation = vi.fn(async () => true);
    const outcome = await manager().execute(
      { id: '1', name: 'read_value', arguments: { key: 'cpu' } },
      { requestConfirmation },
    );

    expect(outcome.status).toBe('ok');
    expect(outcome.content).toBe('valeur de cpu');
    expect(requestConfirmation).not.toHaveBeenCalled();
  });

  it('demande confirmation avant une action sensible', async () => {
    const requestConfirmation = vi.fn(async () => true);
    const outcome = await manager().execute(
      { id: '2', name: 'write_value', arguments: { key: 'a', value: 'b' } },
      { requestConfirmation },
    );

    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(requestConfirmation.mock.calls[0]?.[0]).toMatchObject({ details: 'Écrire dans a' });
    expect(outcome.status).toBe('ok');
  });

  it("n'exécute rien quand l'utilisateur refuse", async () => {
    const execute = vi.fn(async () => ({ ok: true, content: 'écrit' }));
    const guarded = new ToolManager().register(
      defineTool({
        name: 'write_value',
        description: 'Écrit une valeur de test.',
        risk: 'confirm',
        schema: z.object({ key: z.string() }),
        execute,
      }),
    );

    const outcome = await guarded.execute(
      { id: '3', name: 'write_value', arguments: { key: 'a' } },
      refuse,
    );

    expect(outcome.status).toBe('denied');
    expect(execute).not.toHaveBeenCalled();
  });

  it('bloque un outil interdit même si le modèle le demande', async () => {
    const outcome = await manager().execute(
      { id: '4', name: 'format_disk', arguments: {} },
      allow,
    );
    expect(outcome.status).toBe('denied');
  });

  it('rejette un outil inconnu au lieu de le laisser passer', async () => {
    const outcome = await manager().execute({ id: '5', name: 'rm_rf', arguments: {} }, allow);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('Outil inconnu');
  });

  it('refuse des arguments qui ne respectent pas le schéma', async () => {
    const outcome = await manager().execute(
      { id: '6', name: 'read_value', arguments: { key: 42 } },
      allow,
    );
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('Arguments invalides');
  });

  it('transforme une exception en résultat exploitable par le modèle', async () => {
    const exploding = new ToolManager().register(
      defineTool({
        name: 'boom',
        description: 'Échoue toujours.',
        risk: 'safe',
        schema: z.object({}),
        execute: async () => {
          throw new Error('disque injoignable');
        },
      }),
    );

    const outcome = await exploding.execute({ id: '7', name: 'boom', arguments: {} }, allow);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('disque injoignable');
  });
});
