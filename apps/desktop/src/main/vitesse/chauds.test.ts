import { describe, expect, it } from 'vitest';
import { InMemoryConversationStore, isOllamaLoadOnly, newConversation, parseSettings, type TurnLogEntry } from '@jarvis/core';
import { ModelWarmer } from './chauds.js';
import { mostUsedTeamOf } from './usage.js';

const ORCHESTRA = {
  enabled: true,
  brain: 'modele-cerveau',
  teams: { musique: { model: 'modele-petit', place: 'processeur' as const } },
};

interface Seen {
  url: string;
  body?: Record<string, unknown>;
}

/** Faux Ollama : note les requêtes, répond aux chargements et à la liste des modèles chargés. */
function fauxOllama(loaded: string[], fail = false) {
  const seen: Seen[] = [];
  const fake = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    seen.push({ url, ...(body ? { body } : {}) });
    if (fail) throw new Error('connexion refusée');
    if (url.endsWith('/api/ps')) return new Response(JSON.stringify({ models: loaded.map((name) => ({ name })) }));
    return new Response(JSON.stringify({ done: true }));
  }) as typeof fetch;
  return { fake, seen };
}

function reglages(orchestra: unknown = ORCHESTRA) {
  const settings = parseSettings({ provider: 'ollama', model: 'modele-chat', orchestra });
  return () => settings;
}

describe('ModelWarmer', () => {
  it('préchauffage : charge le cerveau puis l’équipe la plus utilisée, sans rien générer', async () => {
    const { fake, seen } = fauxOllama([]);
    const warmer = new ModelWarmer({ getSettings: reglages(), mostUsedTeam: async () => 'musique', fetch: fake });
    const report = await warmer.prewarm();
    expect(report.done.map((item) => item.model)).toEqual(['modele-cerveau', 'modele-petit']);
    expect(seen.map((item) => item.url)).toEqual([
      'http://127.0.0.1:11434/api/generate',
      'http://127.0.0.1:11434/api/generate',
    ]);
    for (const item of seen) expect(isOllamaLoadOnly(item.body)).toBe(true);
    expect(seen[0]?.body).toMatchObject({ model: 'modele-cerveau', keep_alive: '30m', options: { num_ctx: 8192 } });
    expect(seen[1]?.body).toMatchObject({ model: 'modele-petit', options: { num_ctx: 8192, num_gpu: 0 } });
  });

  it('orchestre coupé : aucune requête', async () => {
    const { fake, seen } = fauxOllama([]);
    const warmer = new ModelWarmer({ getSettings: reglages({ ...ORCHESTRA, enabled: false }), fetch: fake });
    expect(await warmer.prewarm()).toEqual({ done: [], skipped: [] });
    expect(await warmer.beat()).toEqual({ done: [], skipped: [] });
    expect(seen.filter((item) => item.url.endsWith('/api/generate'))).toEqual([]);
  });

  it('carte occupée (image, mission, entraînement) : rien n’est chargé ni prolongé', async () => {
    const { fake, seen } = fauxOllama(['modele-cerveau']);
    const warmer = new ModelWarmer({ getSettings: reglages(), busy: () => true, fetch: fake });
    expect((await warmer.prewarm()).skipped).toEqual([{ model: 'modele-cerveau', reason: 'carte occupée' }]);
    expect((await warmer.beat()).done).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('au repos (modèles libérés après usage) : rien n’est prolongé, Ollama n’est même pas interrogé', async () => {
    const { fake, seen } = fauxOllama(['modele-cerveau']);
    let repos = true;
    const warmer = new ModelWarmer({ getSettings: reglages(), idle: () => repos, fetch: fake });
    expect(await warmer.beat()).toEqual({ done: [], skipped: [] });
    expect(seen).toEqual([]);
    // Jarvis vient de servir : la prolongation reprend.
    repos = false;
    expect((await warmer.beat()).done.map((item) => item.model)).toEqual(['modele-cerveau']);
  });

  it('prolongation : un modèle déchargé exprès n’est jamais rechargé', async () => {
    const dechargé = fauxOllama([]);
    const warmer = new ModelWarmer({ getSettings: reglages(), mostUsedTeam: async () => 'musique', fetch: dechargé.fake });
    const report = await warmer.beat();
    expect(report.done).toEqual([]);
    expect(report.skipped.map((item) => item.reason)).toEqual(['pas chargé', 'pas chargé']);
    expect(dechargé.seen.map((item) => item.url)).toEqual(['http://127.0.0.1:11434/api/ps']);

    const partiel = fauxOllama(['modele-petit:latest', 'un-autre:latest']);
    const second = new ModelWarmer({ getSettings: reglages(), mostUsedTeam: async () => 'musique', fetch: partiel.fake });
    expect((await second.beat()).done.map((item) => item.model)).toEqual(['modele-petit']);
    expect(partiel.seen.filter((item) => item.url.endsWith('/api/generate')).map((item) => item.body?.model)).toEqual([
      'modele-petit',
    ]);
  });

  it('Ollama arrêté : pas d’erreur levée, rien de fait', async () => {
    const { fake } = fauxOllama([], true);
    const warmer = new ModelWarmer({ getSettings: reglages(), fetch: fake });
    const report = await warmer.prewarm();
    expect(report.done).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    await expect(warmer.beat()).resolves.toEqual({ done: [], skipped: [] });
  });

  it('suit l’adresse d’Ollama des réglages', async () => {
    const { fake, seen } = fauxOllama([]);
    const settings = parseSettings({ provider: 'ollama', model: 'm', baseUrl: 'http://127.0.0.1:9999/', orchestra: ORCHESTRA });
    await new ModelWarmer({ getSettings: () => settings, fetch: fake }).prewarm();
    expect(seen[0]?.url).toBe('http://127.0.0.1:9999/api/generate');
  });
});

describe('équipe la plus utilisée', () => {
  function ligne(team: string | null, model: string | null): TurnLogEntry {
    return {
      userMessageId: 'u',
      assistantMessageIds: [],
      team,
      how: null,
      provider: model ? 'ollama' : 'aucun',
      model,
      place: null,
      source: 'texte',
      tools: [],
      durationMs: 1,
      at: 1,
    };
  }

  it('lit les journaux de tour des conversations, pas les messages', async () => {
    const store = new InMemoryConversationStore();
    expect(await mostUsedTeamOf(store)).toBeNull();
    await store.save({ ...newConversation(), turnLog: [ligne('web', 'm'), ligne('pc', 'm')] });
    await store.save({ ...newConversation(), turnLog: [ligne('pc', 'm'), ligne('horloge', null)] });
    await store.save(newConversation());
    expect(await mostUsedTeamOf(store)).toBe('pc');
  });
});
