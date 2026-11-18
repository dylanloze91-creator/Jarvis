import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolManager, defineTool } from './manager.js';
import { TOOL_MEMORY_TTL_MS, ToolResultMemory, keptAgeText } from './resultMemory.js';
import type { ToolContext } from './types.js';

function horloge(start = 1_000_000) {
  let now = start;
  return { now: () => now, avance: (ms: number) => (now += ms) };
}

const context: ToolContext = { requestConfirmation: async () => true };

/** Outil de lecture qui compte ses exécutions. */
function outilCompte(name: string, risk: 'safe' | 'confirm' = 'safe', ok = true) {
  const runs: unknown[] = [];
  const tool = defineTool({
    name,
    description: 'Outil de test.',
    risk,
    ...(risk === 'confirm' ? { category: 'apps' as const } : {}),
    schema: z.object({ q: z.string().optional() }),
    execute: async (args) => {
      runs.push(args);
      return { ok, content: `résultat ${runs.length}`, data: { n: runs.length } };
    },
  });
  return { tool, runs };
}

describe('mémoire courte des résultats d’outils', () => {
  it('la table ne contient que des outils de lecture, jamais un outil qui agit', () => {
    const names = Object.keys(TOOL_MEMORY_TTL_MS);
    expect(names.sort()).toEqual(
      ['fetch_page', 'get_stock_quote', 'web_research', 'web_search', 'web_search_current', 'youtube_transcript'].sort(),
    );
    for (const name of names) {
      expect(name).not.toMatch(/^(spotify_|rover_|imprimante_|siteblock_|google_|note_|afficher_|generer_)/);
      expect(TOOL_MEMORY_TTL_MS[name]).toBeGreaterThan(0);
      expect(TOOL_MEMORY_TTL_MS[name]).toBeLessThanOrEqual(30 * 60_000);
    }
    const memory = new ToolResultMemory();
    for (const name of ['spotify_play', 'rover_move', 'delete_file', 'run_command', 'open_application', 'imprimante_lancer']) {
      expect(memory.keeps(name)).toBe(false);
    }
  });

  it('garde un résultat réussi le temps prévu, puis l’oublie', () => {
    const time = horloge();
    const memory = new ToolResultMemory({ outil: 60_000 }, time.now);
    expect(memory.lookup('outil', { q: 'a' })).toBeNull();
    memory.store('outil', { q: 'a' }, null, { ok: true, content: 'un' });
    time.avance(59_000);
    expect(memory.lookup('outil', { q: 'a' })).toEqual({ result: { ok: true, content: 'un' }, ageMs: 59_000 });
    time.avance(1_000);
    expect(memory.lookup('outil', { q: 'a' })).toBeNull();
    expect(memory.size).toBe(0);
  });

  it('même demande : ordre des arguments et espaces en trop ne comptent pas ; la casse compte', () => {
    const memory = new ToolResultMemory({ outil: 60_000 }, horloge().now);
    memory.store('outil', { q: 'météo  Paris ', n: 3 }, null, { ok: true, content: 'un' });
    expect(memory.lookup('outil', { n: 3, q: 'météo Paris' })).not.toBeNull();
    expect(memory.lookup('outil', { n: 3, q: 'météo paris' })).toBeNull();
    expect(memory.lookup('outil', { n: 4, q: 'météo Paris' })).toBeNull();
    expect(memory.lookup('outil', { q: 'météo Paris' })).toBeNull();
  });

  it('ce qui change le résultat sans être dans les arguments fait une autre clé', () => {
    const memory = new ToolResultMemory({ outil: 60_000 }, horloge().now);
    memory.store('outil', { q: 'a' }, 'paris', { ok: true, content: 'paris' });
    expect(memory.lookup('outil', { q: 'a' }, null)).toBeNull();
    expect(memory.lookup('outil', { q: 'a' }, 'paris')?.result.content).toBe('paris');
  });

  it('ne garde ni un échec, ni un résultat à réessayer, ni un outil hors de la table', () => {
    const memory = new ToolResultMemory({ outil: 60_000 }, horloge().now);
    memory.store('outil', {}, null, { ok: false, content: 'raté' });
    memory.store('outil', { q: 'b' }, null, { ok: true, content: 'à moitié', outcome: 'recoverable' });
    memory.store('autre', {}, null, { ok: true, content: 'bon' });
    expect(memory.size).toBe(0);
  });

  it('borne le nombre de résultats : le plus ancien part', () => {
    const memory = new ToolResultMemory({ outil: 60_000 }, horloge().now, 2);
    for (const q of ['a', 'b', 'c']) memory.store('outil', { q }, null, { ok: true, content: q });
    expect(memory.size).toBe(2);
    expect(memory.lookup('outil', { q: 'a' })).toBeNull();
    expect(memory.lookup('outil', { q: 'c' })?.result.content).toBe('c');
    memory.clear();
    expect(memory.size).toBe(0);
  });

  it('dit l’âge en français', () => {
    expect(keptAgeText(400)).toBe('réponse gardée, vieille de 1 s');
    expect(keptAgeText(40_000)).toBe('réponse gardée, vieille de 40 s');
    expect(keptAgeText(170_000)).toBe('réponse gardée, vieille de 3 min');
  });
});

describe('Tool Manager avec la mémoire courte', () => {
  it('sans mémoire branchée : chaque appel refait le travail, et le résultat ne porte pas « kept »', async () => {
    const { tool, runs } = outilCompte('web_search');
    const manager = new ToolManager().register(tool);
    const first = await manager.execute({ id: '1', name: 'web_search', arguments: { q: 'a' } }, context);
    await manager.execute({ id: '2', name: 'web_search', arguments: { q: 'a' } }, context);
    expect(runs).toHaveLength(2);
    expect('kept' in first).toBe(false);
  });

  it('la même demande deux fois : l’outil ne tourne qu’une fois, et le journal le dit', async () => {
    const time = horloge();
    const { tool, runs } = outilCompte('web_search');
    const manager = new ToolManager().register(tool).useResultMemory(new ToolResultMemory(TOOL_MEMORY_TTL_MS, time.now));
    const first = await manager.execute({ id: '1', name: 'web_search', arguments: { q: 'a' } }, context);
    time.avance(170_000);
    const second = await manager.execute({ id: '2', name: 'web_search', arguments: { q: 'a' } }, context);
    expect(runs).toHaveLength(1);
    expect(first.kept).toBeUndefined();
    expect(second).toMatchObject({
      callId: '2',
      status: 'ok',
      content: first.content,
      outcome: 'success',
      kept: { ageMs: 170_000 },
      technicalDetail: 'réponse gardée, vieille de 3 min',
      data: { n: 1 },
    });
    // Une autre demande, ou la même après la durée de garde : l'outil retravaille.
    await manager.execute({ id: '3', name: 'web_search', arguments: { q: 'b' } }, context);
    time.avance(TOOL_MEMORY_TTL_MS.web_search!);
    const late = await manager.execute({ id: '4', name: 'web_search', arguments: { q: 'a' } }, context);
    expect(runs).toHaveLength(3);
    expect(late.kept).toBeUndefined();
  });

  it('un outil qui agit n’est jamais gardé, même avec la mémoire branchée', async () => {
    const { tool, runs } = outilCompte('spotify_play');
    const manager = new ToolManager().register(tool).useResultMemory(new ToolResultMemory());
    await manager.execute({ id: '1', name: 'spotify_play', arguments: {} }, context);
    const second = await manager.execute({ id: '2', name: 'spotify_play', arguments: {} }, context);
    expect(runs).toHaveLength(2);
    expect(second.kept).toBeUndefined();
  });

  it('un outil à confirmer n’est jamais gardé, même s’il était dans la table', async () => {
    const { tool, runs } = outilCompte('outil_a_accord', 'confirm');
    const manager = new ToolManager()
      .register(tool)
      .useResultMemory(new ToolResultMemory({ outil_a_accord: 60_000 }));
    await manager.execute({ id: '1', name: 'outil_a_accord', arguments: {} }, context);
    await manager.execute({ id: '2', name: 'outil_a_accord', arguments: {} }, context);
    expect(runs).toHaveLength(2);
  });

  it('un échec n’est pas gardé : l’appel suivant réessaie', async () => {
    const { tool, runs } = outilCompte('web_search', 'safe', false);
    const manager = new ToolManager().register(tool).useResultMemory(new ToolResultMemory());
    await manager.execute({ id: '1', name: 'web_search', arguments: { q: 'a' } }, context);
    await manager.execute({ id: '2', name: 'web_search', arguments: { q: 'a' } }, context);
    expect(runs).toHaveLength(2);
  });

  it('le chemin bourse express (place préférée) ne partage pas son résultat avec l’appel du modèle', async () => {
    const { tool, runs } = outilCompte('get_stock_quote');
    const manager = new ToolManager().register(tool).useResultMemory(new ToolResultMemory());
    await manager.execute({ id: '1', name: 'get_stock_quote', arguments: { q: 'a' } }, { ...context, stockPrefer: 'paris' });
    await manager.execute({ id: '2', name: 'get_stock_quote', arguments: { q: 'a' } }, context);
    const again = await manager.execute({ id: '3', name: 'get_stock_quote', arguments: { q: 'a' } }, { ...context, stockPrefer: 'paris' });
    expect(runs).toHaveLength(2);
    expect(again.kept).toBeDefined();
  });

  it('un gestionnaire composé pour un tour garde la même mémoire', async () => {
    const { tool, runs } = outilCompte('web_search');
    const manager = new ToolManager().register(tool).useResultMemory(new ToolResultMemory());
    await manager.execute({ id: '1', name: 'web_search', arguments: { q: 'a' } }, context);
    const second = await manager.compose().execute({ id: '2', name: 'web_search', arguments: { q: 'a' } }, context);
    expect(runs).toHaveLength(1);
    expect(second.kept).toBeDefined();
  });

  it('un tour déjà annulé ne reçoit pas un résultat gardé', async () => {
    const { tool } = outilCompte('web_search');
    const manager = new ToolManager().register(tool).useResultMemory(new ToolResultMemory());
    await manager.execute({ id: '1', name: 'web_search', arguments: { q: 'a' } }, context);
    const aborted = new AbortController();
    aborted.abort();
    const outcome = await manager.execute({ id: '2', name: 'web_search', arguments: { q: 'a' } }, { ...context, signal: aborted.signal });
    expect(outcome.status).toBe('error');
    expect(outcome.kept).toBeUndefined();
  });
});
