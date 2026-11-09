import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { ImagesService, describeImagesResult, pickBrainModel } from './ImagesService.js';
import { encodeRgbaPng } from './png.js';

/**
 * Faux Forge et faux Ollama derrière un `fetch` simulé : vérifie l'ordre imposé
 * (prévenir → décharger Ollama → lancer Forge → générer → enregistrer → libérer Forge →
 * recharger le modèle), même quand Forge échoue. Aucun vrai processus n'est lancé.
 */
const root = mkdtempSync(join(tmpdir(), 'jarvis-images-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill(): boolean {
    this.exitCode = 0;
    return true;
  }
}

function pngBase64(): string {
  // 2×2 : noir, blanc, rouge, transparent.
  const rgba = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
  return encodeRgbaPng(2, 2, rgba, 4).toString('base64');
}

interface World {
  forgeUp: boolean;
  loaded: string[];
  calls: string[];
  txt2imgPayloads: unknown[];
  failTxt2img?: boolean;
}

function fakeFetch(world: World): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes(':11434/api/ps')) {
      world.calls.push('ollama:ps');
      return json({ models: world.loaded.map((name) => ({ name, size_vram: 5_000_000_000 })) });
    }
    if (url.includes(':11434/api/generate')) {
      const keep = body.keep_alive;
      world.calls.push(`ollama:${body.model}:${String(keep)}`);
      if (keep === 0) world.loaded = world.loaded.filter((name) => name !== body.model);
      else if (!world.loaded.includes(String(body.model))) world.loaded.push(String(body.model));
      return json({ done: true });
    }
    if (!world.forgeUp) throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' });
    if (url.includes('/sdapi/v1/progress')) return json({ progress: 0 });
    if (url.includes('/sdapi/v1/loras')) return json([{ name: 'monstyle' }]);
    if (url.includes('/sdapi/v1/unload-checkpoint')) {
      world.calls.push('forge:unload');
      return json({});
    }
    if (url.includes('/sdapi/v1/txt2img')) {
      world.calls.push('forge:txt2img');
      world.txt2imgPayloads.push(body);
      if (world.failTxt2img) return new Response('boom', { status: 500 });
      const count = Number(body.batch_size ?? 1);
      return json({ images: Array.from({ length: count }, () => pngBase64()), info: JSON.stringify({ seed: 7, all_seeds: Array.from({ length: count }, (_, i) => 7 + i), sd_model_name: 'sd_xl_base_1.0' }) });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function service(world: World, overrides: Record<string, unknown> = {}, forgeDir = join(root, 'Forge')) {
  mkdirSync(join(forgeDir, 'models', 'Stable-diffusion'), { recursive: true });
  mkdirSync(join(forgeDir, 'models', 'VAE'), { recursive: true });
  writeFileSync(join(forgeDir, 'lancer_forge.bat'), '@echo off');
  writeFileSync(join(forgeDir, 'models', 'Stable-diffusion', 'sd_xl_base_1.0.safetensors'), '');
  writeFileSync(join(forgeDir, 'models', 'VAE', 'sdxl_vae_fp16_fix.safetensors'), '');
  const outputRoot = join(root, `images-${Math.random().toString(36).slice(2, 8)}`);
  const settings = parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    orchestra: { enabled: true, brain: 'qwen2.5:7b' },
    images: { enabled: true, forgeDir, outputRoot, ...overrides },
  });
  const spawned: FakeChild[] = [];
  const killed: number[] = [];
  const svc = new ImagesService({
    getSettings: () => settings,
    fetchImpl: fakeFetch(world),
    now: () => new Date(2026, 10, 9, 21, 30, 0),
    processDeps: {
      spawnImpl: () => {
        const child = new FakeChild();
        spawned.push(child);
        world.calls.push('forge:spawn');
        // Forge « démarre » : l'API répond au prochain ping.
        setTimeout(() => {
          world.forgeUp = true;
        }, 5);
        return child as unknown as ChildProcess;
      },
      killTreeImpl: async (pid) => {
        killed.push(pid);
        world.calls.push('forge:kill');
        world.forgeUp = false;
        for (const child of spawned) child.exitCode = 0;
      },
      // Un vrai (petit) délai : la boucle d'attente doit laisser passer le minuteur du faux démarrage.
      sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    },
  });
  return { svc, settings, outputRoot, spawned, killed };
}

describe('ImagesService', () => {
  it('décharge le 7B, lance Forge, génère, range PNG + txt (+ noir et blanc pour drivers-ink), arrête Forge, recharge le 7B', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [] };
    const { svc, outputRoot, killed } = service(world);
    const progress: string[] = [];
    const result = await svc.generate({ prompt: 'a red fox sticker', project: 'drivers-ink', count: 2, format: 'portrait' }, { onProgress: (m) => progress.push(m) });

    expect(progress[0]).toMatch(/décharge le modèle de langage/);
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'forge:spawn', 'forge:txt2img', 'forge:kill', 'ollama:qwen2.5:7b:30m']);
    expect(killed).toEqual([4242]);
    expect(result.forgeStartedByJarvis).toBe(true);
    expect(result.brainReloaded).toBe('qwen2.5:7b');
    expect(result.files).toHaveLength(2);
    expect(result.folder).toBe(join(outputRoot, 'drivers-ink', '2026-11-09'));
    for (const file of result.files) {
      expect(existsSync(file.png)).toBe(true);
      expect(existsSync(file.txt)).toBe(true);
      expect(file.blackAndWhite && existsSync(file.blackAndWhite)).toBe(true);
      expect(readFileSync(file.txt, 'utf8')).toContain('Demande : a red fox sticker');
    }
    expect(result.files.map((file) => file.seed)).toEqual([7, 8]);
    const payload = world.txt2imgPayloads[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ width: 832, height: 1216, batch_size: 2, save_images: false });
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'sd_xl_base_1.0.safetensors', sd_vae: 'sdxl_vae_fp16_fix.safetensors' });
    expect(String(payload.negative_prompt)).toContain('brand logos');
    // Le fichier de réglages a été créé avec les défauts, prêt à être modifié.
    expect(existsSync(join(outputRoot, 'images_presets.yaml'))).toBe(true);
    expect(describeImagesResult(result)).toContain('2 images générées');
  });

  it('Forge déjà allumé par l’utilisateur : pas de lancement, pas d’arrêt, modèle déchargé de Forge, 7B rechargé', async () => {
    const world: World = { forgeUp: true, loaded: ['qwen2.5:7b', 'qwen2.5:3b'], calls: [], txt2imgPayloads: [] };
    const { svc, killed } = service(world);
    const result = await svc.generate({ prompt: 'a cat on a roof, photo', project: 'perso' });
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'ollama:qwen2.5:3b:0', 'forge:txt2img', 'forge:unload', 'ollama:qwen2.5:7b:30m']);
    expect(killed).toEqual([]);
    expect(result.forgeStartedByJarvis).toBe(false);
    expect(result.files[0]!.blackAndWhite).toBeUndefined();
  });

  it('Forge échoue : erreur rendue, Forge libéré et 7B rechargé quand même', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [], failTxt2img: true };
    const { svc } = service(world);
    await expect(svc.generate({ prompt: 'anything', project: 'jarvis' })).rejects.toMatchObject({ kind: 'http' });
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'forge:spawn', 'forge:txt2img', 'forge:kill', 'ollama:qwen2.5:7b:30m']);
    expect(world.loaded).toEqual(['qwen2.5:7b']);
  });

  it('réglage « laisser Forge allumé » : Forge n’est pas arrêté, le modèle de Forge est déchargé', async () => {
    const world: World = { forgeUp: false, loaded: [], calls: [], txt2imgPayloads: [] };
    const { svc } = service(world, { keepForgeRunning: true });
    const result = await svc.generate({ prompt: 'logo', project: 'vx' });
    expect(world.calls).toEqual(['ollama:ps', 'forge:spawn', 'forge:txt2img', 'forge:unload', 'ollama:qwen2.5:7b:30m']);
    expect(result.width).toBe(1344);
    await svc.shutdown();
    expect(world.calls.at(-1)).toBe('forge:kill');
  });

  it('module coupé ou Forge absent : messages clairs, rien n’est lancé', async () => {
    const world: World = { forgeUp: false, loaded: [], calls: [], txt2imgPayloads: [] };
    const off = new ImagesService({ getSettings: () => parseSettings({ images: { enabled: false } }), fetchImpl: fakeFetch(world) });
    expect(off.isEnabled()).toBe(false);
    await expect(off.generate({ prompt: 'x', project: 'perso' })).rejects.toThrow(/coupé/);
    const missingDir = join(root, 'pas-de-forge');
    const { svc } = service(world, {}, missingDir);
    rmSync(join(missingDir, 'lancer_forge.bat'));
    await expect(svc.generate({ prompt: 'x', project: 'perso' })).rejects.toThrow(/introuvable/);
    expect(world.calls.filter((call) => call.startsWith('forge:'))).toEqual([]);
    const status = await svc.status();
    expect(status).toMatchObject({ enabled: true, launcherFound: false, checkpointFound: true, forgeRunning: false });
  });

  it('pickBrainModel : le cerveau de l’orchestre, sinon le modèle qui tournait, sinon celui du chat', () => {
    expect(pickBrainModel(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', orchestra: { enabled: true, brain: 'qwen2.5:7b' } }), [])).toBe('qwen2.5:7b');
    expect(pickBrainModel(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' }), ['jarvis-coder'])).toBe('jarvis-coder');
    expect(pickBrainModel(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' }), [])).toBe('qwen2.5:3b');
    expect(pickBrainModel(parseSettings({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' }), [])).toBeNull();
  });
});
