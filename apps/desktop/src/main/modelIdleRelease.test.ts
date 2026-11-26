/**
 * Ces essais simulent Ollama (liste des modèles chargés, déchargement). Aucun vrai modèle.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_IDLE_RELEASE_MS, parseSettings } from '@jarvis/core';
import { ModelIdleRelease } from './modelIdleRelease.js';

const settings = parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', orchestra: { enabled: true, brain: 'qwen2.5:7b' } });

function fauxOllama(charges: string[]) {
  const appels: string[] = [];
  const faux = (async (url: string | URL | Request, init?: RequestInit) => {
    const adresse = String(url);
    if (adresse.endsWith('/api/ps')) {
      appels.push('liste');
      return new Response(JSON.stringify({ models: charges.map((name) => ({ name })) }));
    }
    const corps = JSON.parse(String(init?.body)) as { model: string; keep_alive: number };
    appels.push(`décharge ${corps.model} (${corps.keep_alive})`);
    const i = charges.indexOf(corps.model);
    if (i >= 0) charges.splice(i, 1);
    return new Response('{}');
  }) as typeof fetch;
  return { faux, appels };
}

function monter(charges: string[], options: { busy?: () => boolean } = {}) {
  let maintenant = 1_000_000;
  const ollama = fauxOllama(charges);
  const lignes: string[] = [];
  const repos = new ModelIdleRelease({
    getSettings: () => settings,
    busy: options.busy ?? (() => false),
    fetch: ollama.faux,
    now: () => maintenant,
    log: (ligne) => lignes.push(ligne),
  });
  return { repos, appels: ollama.appels, lignes, avancer: (ms: number) => (maintenant += ms) };
}

describe('modèles libérés après usage (Ollama simulé)', () => {
  it('avant dix minutes sans usage : rien n’est demandé à Ollama', async () => {
    const { repos, appels, avancer } = monter(['qwen2.5:7b']);
    avancer(MODEL_IDLE_RELEASE_MS - 1_000);
    expect(await repos.check()).toEqual([]);
    expect(appels).toEqual([]);
  });

  it('après dix minutes : le modèle de la discussion est déchargé, pas celui d’un autre', async () => {
    const charges = ['qwen2.5:7b', 'qwen2.5vl:3b'];
    const { repos, appels, lignes, avancer } = monter(charges);
    avancer(MODEL_IDLE_RELEASE_MS);
    expect(await repos.check()).toEqual(['qwen2.5:7b']);
    expect(appels).toEqual(['liste', 'décharge qwen2.5:7b (0)']);
    expect(charges).toEqual(['qwen2.5vl:3b']);
    expect(lignes.join(' ')).toMatch(/qwen2\.5:7b libéré/);
  });

  it('une fois libéré, plus rien n’est demandé jusqu’au prochain usage', async () => {
    const { repos, appels, avancer } = monter(['qwen2.5:7b']);
    avancer(MODEL_IDLE_RELEASE_MS);
    await repos.check();
    avancer(60_000);
    await repos.check();
    await repos.check();
    expect(appels).toEqual(['liste', 'décharge qwen2.5:7b (0)']);
  });

  it('un usage remet le compteur à zéro', async () => {
    const charges = ['qwen2.5:7b'];
    const { repos, appels, avancer } = monter(charges);
    avancer(MODEL_IDLE_RELEASE_MS - 60_000);
    repos.noteUse();
    avancer(MODEL_IDLE_RELEASE_MS - 60_000);
    expect(await repos.check()).toEqual([]);
    expect(appels).toEqual([]);
    avancer(60_000);
    expect(await repos.check()).toEqual(['qwen2.5:7b']);
  });

  it('pendant un tour, une mission ou une image : jamais de déchargement', async () => {
    let occupe = true;
    const { repos, appels, avancer } = monter(['qwen2.5:7b'], { busy: () => occupe });
    avancer(3 * MODEL_IDLE_RELEASE_MS);
    expect(await repos.check()).toEqual([]);
    expect(repos.idle()).toBe(false);
    expect(appels).toEqual([]);
    occupe = false;
    expect(await repos.check()).toEqual(['qwen2.5:7b']);
  });

  it('à la fermeture de Jarvis : libérés tout de suite, sans attendre dix minutes', async () => {
    const charges = ['qwen2.5:7b'];
    const { repos, appels } = monter(charges);
    expect(await repos.releaseNow()).toEqual(['qwen2.5:7b']);
    expect(appels).toEqual(['liste', 'décharge qwen2.5:7b (0)']);
  });

  it('Ollama arrêté : pas d’erreur, et un nouvel essai au contrôle suivant', async () => {
    let maintenant = 0;
    let panne = true;
    const repos = new ModelIdleRelease({
      getSettings: () => settings,
      busy: () => false,
      now: () => maintenant,
      fetch: (async () => {
        if (panne) throw new Error('ECONNREFUSED');
        return new Response(JSON.stringify({ models: [] }));
      }) as typeof fetch,
    });
    maintenant = MODEL_IDLE_RELEASE_MS;
    expect(await repos.check()).toEqual([]);
    panne = false;
    expect(await repos.check()).toEqual([]);
  });
});
