import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolManager, defineTool } from './manager.js';
import type { CategoryPolicies, ToolContext } from './types.js';

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
    const outcome = await manager().execute({ id: '4', name: 'format_disk', arguments: {} }, allow);
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
    expect(outcome.outcome).toBe('definitive');
  });

  it('traduit un ECONNRESET en phrase française et garde le code dans le détail', async () => {
    const exploding = new ToolManager().register(
      defineTool({
        name: 'boom',
        description: 'Échoue toujours.',
        risk: 'safe',
        schema: z.object({}),
        execute: async () => {
          throw Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
        },
      }),
    );

    const outcome = await exploding.execute({ id: '7b', name: 'boom', arguments: {} }, allow);
    expect(outcome.status).toBe('error');
    expect(outcome.outcome).toBe('recoverable');
    expect(outcome.content).toMatch(/interrompue/);
    expect(outcome.content).not.toMatch(/ECONNRESET/);
    expect(outcome.technicalDetail).toMatch(/ECONNRESET/);
  });

  it('produit un résultat exploitable par le journal d’audit', async () => {
    const outcome = await manager().execute(
      { id: '8', name: 'write_value', arguments: { key: 'a', value: 'b' } },
      allow,
    );

    expect(outcome).toMatchObject({
      arguments: { key: 'a', value: 'b' },
      decision: 'approved',
    });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('marque un outil sûr comme approuvé automatiquement', async () => {
    const outcome = await manager().execute(
      { id: '9', name: 'read_value', arguments: { key: 'cpu' } },
      allow,
    );
    expect(outcome.decision).toBe('auto');
  });

  it('marque un refus utilisateur avec la décision « refused »', async () => {
    const outcome = await manager().execute(
      { id: '10', name: 'write_value', arguments: { key: 'a', value: 'b' } },
      refuse,
    );
    expect(outcome.decision).toBe('refused');
  });

  it('marque un outil interdit avec la décision « blocked »', async () => {
    const outcome = await manager().execute(
      { id: '11', name: 'format_disk', arguments: {} },
      allow,
    );
    expect(outcome.decision).toBe('blocked');
  });

  it('respecte la politique de permissions transmise par le contexte', async () => {
    const requestConfirmation = vi.fn(async () => true);
    const permissive: CategoryPolicies = {
      apps: 'never',
      files: 'never',
      capture: 'never',
      shell: 'always',
    };

    const relaxed = defineTool({
      name: 'open_thing',
      description: 'Ouvre quelque chose.',
      risk: 'confirm',
      category: 'apps',
      isDestructive: false,
      schema: z.object({}),
      execute: async () => ({ ok: true, content: 'ouvert' }),
    });

    const outcome = await new ToolManager()
      .register(relaxed)
      .execute(
        { id: '12', name: 'open_thing', arguments: {} },
        { requestConfirmation, policies: permissive },
      );

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(outcome.decision).toBe('auto');
    expect(outcome.status).toBe('ok');
  });

  it('transmet la commande exacte à la fenêtre de confirmation', async () => {
    const requestConfirmation = vi.fn(async () => true);
    const shellLike = defineTool({
      name: 'run_thing',
      description: 'Exécute quelque chose.',
      risk: 'confirm',
      category: 'shell',
      forceConfirm: true,
      schema: z.object({ command: z.string() }),
      describeCommand: ({ command }) => command,
      execute: async () => ({ ok: true, content: 'fait' }),
    });

    await new ToolManager()
      .register(shellLike)
      .execute(
        { id: '13', name: 'run_thing', arguments: { command: 'rm -rf /tmp/x' } },
        { requestConfirmation },
      );

    expect(requestConfirmation.mock.calls[0]?.[0]).toMatchObject({
      command: 'rm -rf /tmp/x',
      forced: true,
    });
  });

  it('applique les valeurs par défaut avant d’écrire la confirmation', async () => {
    const requestConfirmation = vi.fn(async () => true);
    const capture = defineTool({
      name: 'take_screenshot',
      description: 'Capture.',
      risk: 'confirm',
      category: 'capture',
      schema: z.object({ display: z.number().int().min(0).default(0) }),
      summarize: ({ display }) =>
        `Capturer l'écran ${display === 0 ? 'principal' : `n°${display + 1}`}.`,
      describeCommand: ({ display }) => `écran ${display}`,
      execute: async () => ({ ok: true, content: 'fait' }),
    });

    await new ToolManager()
      .register(capture)
      .execute({ id: '14', name: 'take_screenshot', arguments: {} }, { requestConfirmation });

    expect(requestConfirmation.mock.calls[0]?.[0]).toMatchObject({
      details: "Capturer l'écran principal.",
      command: 'écran 0',
    });
  });

  it('juge le caractère destructeur avec les défauts du schéma', () => {
    const close = defineTool({
      name: 'close_application',
      description: 'Ferme.',
      risk: 'confirm',
      category: 'apps',
      isDestructive: (input: { forceKill: boolean }) => input.forceKill !== false,
      schema: z.object({ name: z.string(), forceKill: z.boolean().default(false) }),
      execute: async () => ({ ok: true, content: 'fait' }),
    });
    expect(close.isDestructive({ name: 'notepad' })).toBe(false);
  });
});
