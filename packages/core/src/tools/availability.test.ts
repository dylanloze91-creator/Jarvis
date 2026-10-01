import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolManager, defineTool } from './manager.js';

function gated(available: () => boolean, message?: string | (() => string)) {
  const execute = vi.fn(async () => ({ ok: true, content: 'fait' }));
  const tool = defineTool({
    name: 'google_thing',
    description: 'Outil qui dépend d’un compte.',
    risk: 'confirm',
    forceConfirm: true,
    schema: z.object({}),
    isAvailable: available,
    unavailableMessage: message,
    execute,
  });
  return { tool, execute };
}

const plain = defineTool({
  name: 'plain',
  description: 'Toujours là.',
  risk: 'safe',
  schema: z.object({}),
  execute: async () => ({ ok: true, content: 'ok' }),
});

describe('disponibilité des outils', () => {
  it('un outil sans isAvailable garde exactement la forme d’avant', () => {
    expect('isAvailable' in plain).toBe(false);
    expect('unavailableMessage' in plain).toBe(false);
  });

  it('retire un outil indisponible du catalogue du modèle, et le remet quand il revient', () => {
    let connected = false;
    const { tool } = gated(() => connected);
    const manager = new ToolManager().registerAll([plain, tool]);
    expect(manager.schemas().map((schema) => schema.name)).toEqual(['plain']);
    connected = true;
    expect(manager.schemas().map((schema) => schema.name)).toEqual(['plain', 'google_thing']);
  });

  it('un appel à un outil indisponible renvoie le message, sans confirmation ni exécution', async () => {
    const { tool, execute } = gated(() => false, "Google n'est pas connecté.");
    const requestConfirmation = vi.fn(async () => true);
    const outcome = await new ToolManager()
      .register(tool)
      .execute({ id: '1', name: 'google_thing', arguments: {} }, { requestConfirmation });
    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(outcome.status).toBe('error');
    expect(outcome.decision).toBe('blocked');
    expect(outcome.outcome).toBe('missing_dependency');
    expect(outcome.content).toBe("Google n'est pas connecté.");
  });

  it('accepte un message calculé et retombe sur une phrase générique', async () => {
    const dynamic = gated(() => false, () => 'Lecture seule.');
    const outcome = await new ToolManager()
      .register(dynamic.tool)
      .execute({ id: '1', name: 'google_thing', arguments: {} }, { requestConfirmation: async () => true });
    expect(outcome.content).toBe('Lecture seule.');

    const fallback = gated(() => false);
    const second = await new ToolManager()
      .register(fallback.tool)
      .execute({ id: '2', name: 'google_thing', arguments: {} }, { requestConfirmation: async () => true });
    expect(second.content).toMatch(/n'est pas disponible/);
  });

  it('un isAvailable qui lève vaut indisponible', () => {
    const { tool } = gated(() => {
      throw new Error('boom');
    });
    expect(new ToolManager().register(tool).schemas()).toEqual([]);
  });

  it('disponible : la confirmation forcée reste demandée', async () => {
    const { tool, execute } = gated(() => true);
    const requestConfirmation = vi.fn(async () => true);
    const outcome = await new ToolManager()
      .register(tool)
      .execute({ id: '1', name: 'google_thing', arguments: {} }, { requestConfirmation });
    expect(requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({ forced: true }));
    expect(execute).toHaveBeenCalled();
    expect(outcome.status).toBe('ok');
  });
});
