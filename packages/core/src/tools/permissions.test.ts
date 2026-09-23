import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './manager.js';
import { defaultCategoryPolicies, requiresConfirmation } from './permissions.js';
import type { CategoryPolicies } from './types.js';

const openApp = defineTool({
  name: 'open_application',
  description: 'Ouvre une application.',
  risk: 'confirm',
  category: 'apps',
  isDestructive: false,
  schema: z.object({ name: z.string() }),
  execute: async () => ({ ok: true, content: 'ouvert' }),
});

const closeApp = defineTool({
  name: 'close_application',
  description: 'Ferme une application.',
  risk: 'confirm',
  category: 'apps',
  isDestructive: (input: { forceKill?: boolean }) => Boolean(input.forceKill),
  schema: z.object({ name: z.string(), forceKill: z.boolean().default(false) }),
  execute: async () => ({ ok: true, content: 'fermé' }),
});

const deleteFile = defineTool({
  name: 'delete_file',
  description: 'Supprime un fichier (corbeille).',
  risk: 'confirm',
  category: 'files',
  forceConfirm: true,
  isDestructive: true,
  schema: z.object({ path: z.string() }),
  execute: async () => ({ ok: true, content: 'supprimé' }),
});

const runCommand = defineTool({
  name: 'run_command',
  description: 'Exécute une commande.',
  risk: 'confirm',
  category: 'shell',
  forceConfirm: true,
  isDestructive: true,
  schema: z.object({ command: z.string() }),
  execute: async () => ({ ok: true, content: 'exécuté' }),
});

const noCategory = defineTool({
  name: 'legacy_tool',
  description: 'Outil de test sans catégorie déclarée.',
  risk: 'confirm',
  schema: z.object({}),
  execute: async () => ({ ok: true, content: 'ok' }),
});

function policies(overrides: Partial<CategoryPolicies> = {}): CategoryPolicies {
  return { ...defaultCategoryPolicies, ...overrides };
}

describe('requiresConfirmation', () => {
  it('confirme toujours par défaut (politique « always »)', () => {
    expect(requiresConfirmation(openApp, { name: 'Chrome' }, policies())).toBe(true);
  });

  it('ne confirme jamais quand la politique de la catégorie est « never »', () => {
    expect(requiresConfirmation(openApp, { name: 'Chrome' }, policies({ apps: 'never' }))).toBe(
      false,
    );
  });

  it('en mode « destructive-only », laisse passer une action non destructrice', () => {
    const relaxed = policies({ apps: 'destructive-only' });
    expect(requiresConfirmation(closeApp, { name: 'Chrome', forceKill: false }, relaxed)).toBe(
      false,
    );
  });

  it('en mode « destructive-only », confirme quand même une action destructrice', () => {
    const relaxed = policies({ apps: 'destructive-only' });
    expect(requiresConfirmation(closeApp, { name: 'Chrome', forceKill: true }, relaxed)).toBe(true);
  });

  it('ignore totalement la politique pour un outil incompressible (suppression)', () => {
    const permissive = policies({ files: 'never' });
    expect(requiresConfirmation(deleteFile, { path: '/tmp/a' }, permissive)).toBe(true);
  });

  it('ignore totalement la politique pour un outil incompressible (commande arbitraire)', () => {
    const permissive = policies({ shell: 'never' });
    expect(requiresConfirmation(runCommand, { command: 'ls' }, permissive)).toBe(true);
  });

  it('retombe sur « toujours confirmer » quand aucune catégorie n’est déclarée', () => {
    const permissive = policies();
    expect(requiresConfirmation(noCategory, {}, permissive)).toBe(true);
  });

  it('utilise la politique par défaut quand aucune politique n’est fournie', () => {
    expect(requiresConfirmation(openApp, { name: 'Chrome' })).toBe(true);
  });
});
