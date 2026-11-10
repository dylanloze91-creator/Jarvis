import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { ImagesService, describeDirectResult, describeImagesResult, pickBrainModel } from './ImagesService.js';
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
  /** Réponse du faux modèle à la reformulation ; `'erreur'` = HTTP 500 ; absent = JSON plausible. */
  refineReply?: string;
  /** `false` : Forge tourne sans l'extension ADetailer chargée. */
  adetailerLoaded?: boolean;
  /** Réglage `auto_launch_browser` de Forge avant le tour (défaut de Forge : `'Local'`). */
  browserLaunch?: string;
  /** Dernier corps envoyé à `/sdapi/v1/options`. */
  forgeOptions?: Record<string, unknown>;
  /** Messages (système + utilisateur) reçus par le faux modèle à chaque reformulation. */
  refinePrompts?: string[];
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
    if (url.includes(':11434/api/chat')) {
      world.calls.push(`ollama:refine:${body.model}`);
      const user = String((body.messages as { content: string }[])[1]?.content ?? '');
      (world.refinePrompts ??= []).push(...(body.messages as { content: string }[]).map((message) => message.content));
      if (world.refineReply === 'erreur') return new Response('boom', { status: 500 });
      const content =
        world.refineReply ??
        JSON.stringify({ prompt: `refined: ${/Request: (.*)/.exec(user)?.[1] ?? ''} in english, detailed, studio lighting, centered`, negative: 'blurry, duplicate' });
      return json({ message: { role: 'assistant', content } });
    }
    if (url.includes(':11434/api/generate')) {
      const keep = body.keep_alive;
      world.calls.push(`ollama:${body.model}:${String(keep)}`);
      if (keep === 0) world.loaded = world.loaded.filter((name) => name !== body.model);
      else if (!world.loaded.includes(String(body.model))) world.loaded.push(String(body.model));
      return json({ done: true });
    }
    if (!world.forgeUp) throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' });
    if (url.includes('/sdapi/v1/progress')) return json({ progress: 0.5, eta_relative: 12 });
    if (url.includes('/sdapi/v1/options')) {
      if (init?.method === 'POST') {
        world.calls.push('forge:options');
        world.forgeOptions = body;
        return json({});
      }
      return json({ auto_launch_browser: world.browserLaunch ?? 'Local' });
    }
    if (url.includes('/sdapi/v1/loras')) return json([{ name: 'monstyle' }]);
    if (url.includes('/sdapi/v1/scripts')) {
      world.calls.push('forge:scripts');
      return json({ txt2img: world.adetailerLoaded === false ? ['xyz'] : ['adetailer', 'xyz'] });
    }
    if (url.includes('/sdapi/v1/upscalers')) return json([{ name: 'None' }, { name: 'Lanczos' }, { name: 'ESRGAN' }]);
    if (url.includes('/sdapi/v1/extra-single-image')) {
      world.calls.push(`forge:upscale:${body.upscaler_1}:${body.upscaling_resize}`);
      return json({ image: pngBase64() });
    }
    if (url.includes('/sdapi/v1/unload-checkpoint')) {
      world.calls.push('forge:unload');
      return json({});
    }
    if (url.includes('/sdapi/v1/txt2img') || url.includes('/sdapi/v1/img2img')) {
      world.calls.push(url.includes('img2img') ? 'forge:img2img' : 'forge:txt2img');
      world.txt2imgPayloads.push(body);
      if (world.failTxt2img) return new Response('boom', { status: 500 });
      const count = Number(body.batch_size ?? 1);
      return json({ images: Array.from({ length: count }, () => pngBase64()), info: JSON.stringify({ seed: 7, all_seeds: Array.from({ length: count }, (_, i) => 7 + i), sd_model_name: 'sd_xl_base_1.0' }) });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function service(world: World, overrides: Record<string, unknown> = {}, forgeDir = join(root, 'Forge'), extras: { realvis?: boolean; adetailer?: boolean; animagine?: boolean } = {}) {
  mkdirSync(join(forgeDir, 'models', 'Stable-diffusion'), { recursive: true });
  mkdirSync(join(forgeDir, 'models', 'VAE'), { recursive: true });
  writeFileSync(join(forgeDir, 'lancer_forge.bat'), '@echo off');
  writeFileSync(join(forgeDir, 'models', 'Stable-diffusion', 'sd_xl_base_1.0.safetensors'), '');
  writeFileSync(join(forgeDir, 'models', 'VAE', 'sdxl_vae_fp16_fix.safetensors'), '');
  if (extras.realvis) writeFileSync(join(forgeDir, 'models', 'Stable-diffusion', 'RealVisXL_V5.0_fp16.safetensors'), '');
  if (extras.animagine) writeFileSync(join(forgeDir, 'models', 'Stable-diffusion', 'animagine-xl-4.0-opt.safetensors'), '');
  if (extras.adetailer) mkdirSync(join(forgeDir, 'extensions', 'adetailer', 'scripts'), { recursive: true });
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
    forgeRetryDelayMs: 0,
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

describe('ImagesService — mode direct (sans le modèle de langage)', () => {
  it('consigne telle quelle : aucun appel au modèle, décharge → Forge → génère → arrête → recharge ; .txt « envoyée telle quelle »', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [] };
    const { svc, outputRoot, killed } = service(world, {}, join(root, 'Forge-direct'), { realvis: true });
    const progress: string[] = [];
    const values: number[] = [];
    const result = await svc.generateDirect(
      { prompt: ' femme in lingerie red, très pudique ', negative: 'flou', project: 'perso', improve: false, checkpoint: 'RealVisXL_V5.0_fp16.safetensors', format: '16:9', steps: 12, cfg: 3, sampler: 'Euler a', scheduler: 'Simple', seed: 5, loras: [{ name: 'monstyle', weight: 0.6 }] },
      { onProgress: (m) => progress.push(m), onProgressValue: (v) => values.push(v) },
    );
    // Jamais /api/chat : ni reformulation, ni jugement.
    expect(world.calls.filter((call) => call.startsWith('ollama:refine'))).toEqual([]);
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'forge:spawn', 'forge:options', 'forge:txt2img', 'forge:kill', 'ollama:qwen2.5:7b:30m']);
    const payload = world.txt2imgPayloads[0] as Record<string, unknown>;
    expect(payload.prompt).toBe('femme in lingerie red, très pudique <lora:monstyle:0.6>');
    expect(payload.negative_prompt).toBe('flou');
    expect(payload).toMatchObject({ width: 1344, height: 768, steps: 12, cfg_scale: 3, sampler_name: 'Euler a', scheduler: 'Simple', seed: 5, batch_size: 1 });
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'RealVisXL_V5.0_fp16.safetensors', sd_vae: 'sdxl_vae_fp16_fix.safetensors' });
    expect(payload.alwayson_scripts).toEqual({ 'Never OOM Integrated': { args: [false, false, 512, 64] } });
    expect(result.improved).toBe(false);
    expect(result.finalPrompt).toBe(String(payload.prompt));
    expect(result.brainReloaded).toBe('qwen2.5:7b');
    expect(result.forgeHeld).toBe(false);
    expect(killed).toEqual([4242]);
    expect(result.folder).toBe(join(outputRoot, 'perso', '2026-11-09'));
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.preview.startsWith('data:image/png;base64,')).toBe(true);
    expect(existsSync(result.files[0]!.png)).toBe(true);
    expect(readFileSync(result.files[0]!.txt!, 'utf8')).toContain('Mode direct (sans le modèle de langage) : consigne envoyée telle quelle');
    expect(progress.some((m) => m.includes('telle quelle'))).toBe(true);
    // L'avancement de Forge est relayé (faux Forge : 50 %).
    expect(values.length === 0 || values[0] === 0.5).toBe(true);
    expect(describeDirectResult(result)).toContain('consigne envoyée telle quelle');
  });

  it('« améliorer » : règles d’Imager seules (type deviné, négatif d’anatomie, qualité du modèle, portrait pour une personne), traduction par dictionnaire, toujours sans modèle', async () => {
    const world: World = { forgeUp: true, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [] };
    const { svc } = service(world, {}, join(root, 'Forge-direct-2'), { realvis: true, adetailer: true });
    const result = await svc.generateDirect({ prompt: 'portrait d’une femme rousse qui sourit', negative: '', project: 'perso' });
    expect(world.calls.filter((call) => call.includes('refine') || call.includes('chat'))).toEqual([]);
    const payload = world.txt2imgPayloads[0] as Record<string, unknown>;
    // Traduit par le dictionnaire local (mots connus), pas par un modèle ; règles de type « personne ».
    expect(String(payload.prompt)).toContain('portrait');
    expect(String(payload.prompt)).toContain('woman');
    expect(String(payload.prompt)).not.toContain('femme');
    expect(String(payload.prompt)).toContain('detailed hands with five fingers');
    expect(String(payload.negative_prompt)).toContain('deformed hands');
    expect(payload).toMatchObject({ width: 832, height: 1216, sampler_name: 'DPM++ SDE', scheduler: 'Karras', steps: 30, cfg_scale: 5 });
    expect(payload.override_settings).toMatchObject({ sd_model_checkpoint: 'RealVisXL_V5.0_fp16.safetensors' });
    expect(payload.alwayson_scripts).toHaveProperty('ADetailer');
    expect(result).toMatchObject({ improved: true, translatedBy: 'dictionnaire local', subjectType: 'personne', adetailer: true, checkpoint: { id: 'realvisxl' } });
    expect(readFileSync(result.files[0]!.txt!, 'utf8')).toContain('complétée par Imager (règles seules, traduite par le dictionnaire local)');
  });

  it('panneau ouvert + option : Forge reste chargé et le modèle n’est pas rechargé ; à la fermeture, Forge est libéré et le modèle revient', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [] };
    const { svc, killed } = service(world, { directHoldForge: true }, join(root, 'Forge-direct-3'));
    await svc.setDirectPanelOpen(true);
    const first = await svc.generateDirect({ prompt: 'a cat', negative: '', project: 'perso', improve: false });
    expect(first.forgeHeld).toBe(true);
    expect(first.brainReloaded).toBeNull();
    // Sans modèle choisi : celui d'Imager (ici SDXL de base), jamais « le modèle courant de Forge ».
    expect((world.txt2imgPayloads[0] as Record<string, unknown>).override_settings).toMatchObject({ sd_model_checkpoint: 'sd_xl_base_1.0.safetensors' });
    expect(first.checkpoint).toEqual({ id: 'sdxl-base', label: 'SDXL base 1.0' });
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'forge:spawn', 'forge:options', 'forge:txt2img']);
    world.calls.length = 0;
    // Seconde image : Forge déjà là, pas de nouveau démarrage.
    const second = await svc.generateDirect({ prompt: 'a dog', negative: '', project: 'perso', improve: false });
    expect(second.forgeHeld).toBe(true);
    expect(world.calls).toEqual(['ollama:ps', 'forge:txt2img']);
    world.calls.length = 0;
    await svc.setDirectPanelOpen(false);
    expect(world.calls).toEqual(['forge:kill', 'ollama:qwen2.5:7b:30m']);
    expect(killed).toEqual([4242]);
  });

  it('projet perso sans .txt (réglage) ; catalogue : modèles et LoRA du disque, défauts par projet', async () => {
    const world: World = { forgeUp: true, loaded: [], calls: [], txt2imgPayloads: [] };
    const forgeDir = join(root, 'Forge-direct-4');
    const { svc } = service(world, { directNoTxtPerso: true }, forgeDir, { realvis: true, animagine: true });
    mkdirSync(join(forgeDir, 'models', 'Lora'), { recursive: true });
    writeFileSync(join(forgeDir, 'models', 'Lora', 'monstyle.safetensors'), '');
    const result = await svc.generateDirect({ prompt: 'a cat', negative: '', project: 'perso', improve: false });
    expect(result.files[0]!.txt).toBeUndefined();
    expect(existsSync(result.files[0]!.png)).toBe(true);
    const catalog = await svc.directCatalog();
    expect(catalog.enabled).toBe(true);
    expect(catalog.checkpoints.map((c) => c.label)).toEqual(['Animagine XL 4.0 Opt', 'RealVisXL V5.0', 'SDXL base 1.0']);
    expect(catalog.loras).toEqual(['monstyle']);
    expect(catalog.formats).toHaveLength(7);
    expect(catalog.projects.perso.negative).toContain('deformed hands');
    expect(catalog.projects.vx.formats).toEqual(['16:9', '9:16']);
    expect(catalog).toMatchObject({ improve: true, holdForge: false, keepTxtPerso: false, busy: false });
  });

  it('échec de Forge en mode direct : le modèle est quand même rechargé, Forge libéré', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [], failTxt2img: true };
    const { svc } = service(world, {}, join(root, 'Forge-direct-5'));
    await expect(svc.generateDirect({ prompt: 'a cat', negative: '', project: 'perso', improve: false })).rejects.toThrow(/500/);
    expect(world.calls.at(-1)).toBe('ollama:qwen2.5:7b:30m');
    expect(world.calls).toContain('forge:kill');
  });
});

describe('ImagesService', () => {
  it('décharge le 7B, lance Forge, génère, range PNG + txt (+ noir et blanc pour drivers-ink), arrête Forge, recharge le 7B', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [] };
    const { svc, outputRoot, killed } = service(world);
    const progress: string[] = [];
    const result = await svc.generate({ prompt: 'a red fox sticker', project: 'drivers-ink', count: 2, format: 'portrait' }, { onProgress: (m) => progress.push(m) });

    expect(progress[0]).toMatch(/consigne pour Stable Diffusion/);
    expect(progress[1]).toMatch(/Jarvis Imager prend la main/);
    expect(world.calls).toEqual(['ollama:ps', 'ollama:refine:qwen2.5:7b', 'ollama:ps', 'ollama:qwen2.5:7b:0', 'forge:spawn', 'forge:options', 'forge:txt2img', 'forge:kill', 'ollama:qwen2.5:7b:30m']);
    // Forge ouvrait son interface dans le navigateur à chaque lancement : coupé une fois, par l'API.
    expect(world.forgeOptions).toEqual({ auto_launch_browser: 'Disable' });
    expect(result.refined).toMatchObject({ used: true, model: 'qwen2.5:7b' });
    expect(result.finalPrompt).toContain('refined: a red fox sticker in english');
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
    expect(payload).toMatchObject({ width: 832, height: 1216, batch_size: 2, save_images: false, sampler_name: 'DPM++ 2M', steps: 28, cfg_scale: 6 });
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'sd_xl_base_1.0.safetensors', sd_vae: 'sdxl_vae_fp16_fix.safetensors' });
    // Never OOM toujours explicite (sinon Forge se trompe d'arguments avec ADetailer installé) ; pas d'ADetailer pour un sujet « autre ».
    expect(payload.alwayson_scripts).toEqual({ 'Never OOM Integrated': { args: [false, false, 512, 64] } });
    expect(result.checkpoint).toEqual({ id: 'sdxl-base', label: 'SDXL base 1.0' });
    expect(result.subjectType).toBe('autre');
    expect(existsSync(join(outputRoot, 'imager_rules.yaml'))).toBe(true);
    expect(String(payload.negative_prompt)).toContain('brand logos');
    // Le négatif de la reformulation s'ajoute, sans doublon (« blurry » est déjà dans la règle du projet).
    expect(String(payload.negative_prompt)).toContain('duplicate');
    expect(String(payload.negative_prompt).split(', ').filter((term) => term === 'blurry')).toHaveLength(1);
    expect(readFileSync(result.files[0]!.txt, 'utf8')).toContain('Consigne reformulée pour SDXL par qwen2.5:7b');
    // Le fichier de réglages a été créé avec les défauts, prêt à être modifié.
    expect(existsSync(join(outputRoot, 'images_presets.yaml'))).toBe(true);
    expect(describeImagesResult(result)).toContain('2 images générées');
  });

  it('Forge déjà allumé par l’utilisateur : pas de lancement, pas d’arrêt, modèle déchargé de Forge, 7B rechargé ; reformulation coupée', async () => {
    const world: World = { forgeUp: true, loaded: ['qwen2.5:7b', 'qwen2.5:3b'], calls: [], txt2imgPayloads: [] };
    const { svc, killed } = service(world, { refinePrompts: false });
    const result = await svc.generate({ prompt: 'a cat on a roof, photo', project: 'perso' });
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'ollama:qwen2.5:3b:0', 'forge:txt2img', 'forge:unload', 'ollama:qwen2.5:7b:30m']);
    expect(result.refined).toBeNull();
    expect(result.finalPrompt).toContain('a cat on a roof, photo');
    expect(killed).toEqual([]);
    expect(result.forgeStartedByJarvis).toBe(false);
    expect(result.files[0]!.blackAndWhite).toBeUndefined();
  });

  it('reformulation en échec ou douteuse : la consigne d’origine part telle quelle, avec la raison', async () => {
    const world: World = { forgeUp: true, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [], refineReply: 'erreur' };
    const { svc } = service(world);
    const failed = await svc.generate({ prompt: 'a lighthouse at night, long exposure', project: 'perso' });
    expect(failed.refined).toMatchObject({ used: false, model: 'qwen2.5:7b', reason: 'Ollama a répondu 500' });
    expect(failed.finalPrompt).toContain('a lighthouse at night, long exposure');
    world.refineReply = JSON.stringify({ prompt: 'un phare la nuit avec une longue pose et des étoiles' });
    const french = await svc.generate({ prompt: 'a lighthouse at night', project: 'perso' });
    // Réponse française deux fois de suite : second essai demandé, puis consigne d'origine.
    expect(world.calls.filter((call) => call.startsWith('ollama:refine:'))).toHaveLength(3);
    expect(french.refined).toMatchObject({ used: false, reason: expect.stringContaining('après deux essais') });
    expect(french.finalPrompt).toContain('a lighthouse at night');
    expect(describeImagesResult(french)).toContain('sujet gardé tel quel');
  });

  it('Forge échoue : erreur rendue, Forge libéré et 7B rechargé quand même', async () => {
    const world: World = { forgeUp: false, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [], failTxt2img: true };
    const { svc } = service(world, { refinePrompts: false });
    await expect(svc.generate({ prompt: 'anything', project: 'jarvis' })).rejects.toMatchObject({ kind: 'http' });
    // Un 500 est retenté une fois ; le second échec est rendu tel quel, Forge libéré, 7B rechargé.
    expect(world.calls).toEqual(['ollama:ps', 'ollama:qwen2.5:7b:0', 'forge:spawn', 'forge:options', 'forge:txt2img', 'forge:txt2img', 'forge:kill', 'ollama:qwen2.5:7b:30m']);
    expect(world.loaded).toEqual(['qwen2.5:7b']);
  });

  it('réglage « laisser Forge allumé » : Forge n’est pas arrêté, le modèle de Forge est déchargé ; navigateur déjà coupé = rien n’est réécrit', async () => {
    const world: World = { forgeUp: false, loaded: [], calls: [], txt2imgPayloads: [], browserLaunch: 'Disable' };
    const { svc } = service(world, { keepForgeRunning: true });
    const result = await svc.generate({ prompt: 'logo', project: 'vx' });
    // Rien n'était chargé : le cerveau de l'orchestre est quand même consulté pour la consigne (il se charge).
    expect(world.calls).toEqual(['ollama:ps', 'ollama:refine:qwen2.5:7b', 'ollama:ps', 'forge:spawn', 'forge:txt2img', 'forge:unload', 'ollama:qwen2.5:7b:30m']);
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

  it('photo jointe : enregistrée sous _references, puis image vers image avec le format de la photo et la copie à côté', async () => {
    const world: World = { forgeUp: true, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [] };
    const { svc, outputRoot } = service(world);
    // Une « photo » 1920×1080 (PNG minuscule mais avec les bonnes dimensions dans l'en-tête).
    const photo = encodeRgbaPng(4, 2, Buffer.alloc(4 * 2 * 4, 200), 4);
    photo.writeUInt32BE(1920, 16);
    photo.writeUInt32BE(1080, 20);
    const saved = await svc.saveReference({ name: 'Ma Photo.PNG', mime: 'image/png', data: photo });
    expect(saved.kind).toBe('image');
    expect(saved.path.replace(/\\/g, '/')).toMatch(/\/_references\/2026-11-09\/213000-ma-photo\.png$/);
    expect(existsSync(saved.path)).toBe(true);
    await expect(svc.saveReference({ name: 'doc.pdf', mime: 'application/pdf', data: photo })).rejects.toThrow(/PNG, JPEG ou WebP/);

    const result = await svc.generate({ prompt: 'sticker of this', project: 'drivers-ink', initImage: { path: saved.path, fidelity: 0.7 } });
    const payload = world.txt2imgPayloads[0] as Record<string, unknown>;
    expect(world.calls).toContain('forge:img2img');
    expect(result.refined?.used).toBe(true);
    expect(payload.init_images).toEqual([photo.toString('base64')]);
    expect(payload.denoising_strength).toBe(0.3);
    expect([payload.width, payload.height]).toEqual([1344, 768]);
    expect(result.files[0]!.source).toMatch(/-source\.png$/);
    expect(existsSync(result.files[0]!.source!)).toBe(true);
    expect(readFileSync(result.files[0]!.txt, 'utf8')).toContain('Photo de départ');
    expect(describeImagesResult(result)).toContain('à partir de ta photo');
    expect(result.folder.startsWith(join(outputRoot, 'drivers-ink'))).toBe(true);
    await expect(svc.generate({ prompt: 'x', project: 'perso', initImage: { path: join(outputRoot, 'absente.jpg') } })).rejects.toThrow(/introuvable/);
  });

  it('Jarvis Imager : personne → RealVisXL (réglages de l’auteur), consigne par règles, ADetailer visages et mains, agrandissement après coup', async () => {
    const world: World = { forgeUp: true, loaded: ['qwen2.5:7b'], calls: [], txt2imgPayloads: [], refineReply: JSON.stringify({ prompt: 'a smiling woman waving at the camera, city street, golden hour, medium shot', negative: 'neon signs' }) };
    const { svc, outputRoot } = service(world, {}, join(root, 'Forge-imager'), { realvis: true, adetailer: true });
    const result = await svc.generate({ prompt: 'une femme qui fait coucou', project: 'perso', subjectType: 'personne', personCount: 1, upscale: true });
    const payload = world.txt2imgPayloads[0] as Record<string, unknown>;
    expect(result.checkpoint).toEqual({ id: 'realvisxl', label: 'RealVisXL V5.0' });
    expect(payload).toMatchObject({ sampler_name: 'DPM++ SDE', scheduler: 'Karras', steps: 30, cfg_scale: 5 });
    // Personne sans format demandé : portrait (règle du type), pas le carré du projet.
    expect([payload.width, payload.height]).toEqual([832, 1216]);
    // VAE : celui du modèle est intégré, mais le VAE fp16 présent est gardé contre les images noires.
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'RealVisXL_V5.0_fp16.safetensors', sd_vae: 'sdxl_vae_fp16_fix.safetensors' });
    expect(String(payload.prompt).startsWith('a smiling woman waving at the camera')).toBe(true);
    expect(String(payload.prompt)).toContain('solo, one person only');
    expect(String(payload.prompt)).toContain('detailed hands with five fingers');
    expect(String(payload.negative_prompt)).toContain('extra arms');
    expect(String(payload.negative_prompt)).toContain('face asymmetry');
    expect(String(payload.negative_prompt)).toContain('neon signs');
    const scripts = (payload.alwayson_scripts as { ADetailer: { args: unknown[] } }).ADetailer.args;
    expect(scripts[2]).toMatchObject({ ad_model: 'face_yolov8n.pt' });
    expect(scripts[3]).toMatchObject({ ad_model: 'hand_yolov8n.pt' });
    expect(result.adetailer).toBe(true);
    expect(world.calls).toContain('forge:scripts');
    // Agrandisseur demandé par les règles absent : Lanczos pris à la place, et dit.
    expect(world.calls).toContain('forge:upscale:Lanczos:2');
    expect(result.upscaled).toEqual({ factor: 2, upscaler: 'Lanczos' });
    expect(result.files[0]!.upscaled).toMatch(/-grand\.png$/);
    expect(existsSync(result.files[0]!.upscaled!)).toBe(true);
    expect(result.warnings.join(' ')).toContain('R-ESRGAN 4x+');
    const txt = readFileSync(result.files[0]!.txt, 'utf8');
    expect(txt).toContain('Jarvis Imager : sujet « personne », 1 personne(s), modèle RealVisXL V5.0, retouche visages/mains : oui');
    expect(describeImagesResult(result)).toContain('Jarvis Imager : modèle RealVisXL V5.0');
    expect(result.folder.startsWith(outputRoot)).toBe(true);
  });

  it('rendu anime (mots de la demande) : Animagine avec ses réglages et ses étiquettes de qualité, négatif « photo », noms gardés, ligne « rendu anime »', async () => {
    const world: World = {
      forgeUp: true,
      loaded: ['qwen2.5:7b'],
      calls: [],
      txt2imgPayloads: [],
      refineReply: JSON.stringify({ prompt: '1girl, hyuuga hinata, naruto (series), long hair, smile, looking at viewer, outdoors, night', negative: 'très pudique, extra tails' }),
    };
    const { svc } = service(world, {}, join(root, 'Forge-anime'), { realvis: true, adetailer: true, animagine: true });
    const result = await svc.generate({ prompt: 'Hinata dans Naruto, style anime', project: 'perso', subjectType: 'personne', personCount: 1 });
    const payload = world.txt2imgPayloads[0] as Record<string, unknown>;
    expect(result.render).toBe('anime');
    expect(result.renderHonored).toBe(true);
    expect(result.checkpoint).toEqual({ id: 'animagine', label: 'Animagine XL 4.0 Opt' });
    expect(payload).toMatchObject({ sampler_name: 'Euler a', scheduler: 'Automatic', steps: 28, cfg_scale: 5, width: 832, height: 1216 });
    expect(String(payload.prompt).startsWith('1girl, hyuuga hinata, naruto (series)')).toBe(true);
    expect(String(payload.prompt)).toContain('masterpiece, high score, great score, absurdres');
    expect(String(payload.prompt)).not.toContain('professional quality');
    expect(String(payload.negative_prompt)).toContain('photorealistic');
    expect(String(payload.negative_prompt)).toContain('low score');
    expect(String(payload.negative_prompt)).toContain('extra arms');
    // Le négatif reformulé contenait du français : écarté seul, la consigne est gardée.
    expect(String(payload.negative_prompt)).not.toContain('pudique');
    expect(String(payload.negative_prompt)).not.toContain('extra tails');
    // La reformulation a reçu la consigne « anime » (étiquettes Danbooru, noms gardés).
    expect(world.refinePrompts?.some((text) => text.includes('Danbooru') && text.includes('hyuuga hinata'))).toBe(true);
    const scripts = (payload.alwayson_scripts as { ADetailer: { args: unknown[] } }).ADetailer.args;
    expect(scripts[2]).toMatchObject({ ad_model: 'face_yolov8n.pt', ad_prompt: expect.stringContaining('anime face') });
    const txt = readFileSync(result.files[0]!.txt, 'utf8');
    expect(txt).toContain('Jarvis Imager : sujet « personne », 1 personne(s), rendu anime, modèle Animagine XL 4.0 Opt, retouche visages/mains : oui');
    expect(describeImagesResult(result)).toContain('rendu anime');
    // Une demande sans mot de rendu garde le modèle photo, sans négatif de rendu.
    world.txt2imgPayloads = [];
    const plain = await svc.generate({ prompt: 'une femme qui sourit', project: 'perso', subjectType: 'personne' });
    expect(plain.render).toBe('auto');
    expect(plain.checkpoint?.id).toBe('realvisxl');
    expect(String((world.txt2imgPayloads[0] as Record<string, unknown>).negative_prompt)).not.toContain('photorealistic');
  });

  it('rendu anime demandé sans modèle anime sur le disque : SDXL de base, prévenu dans la réponse et le .txt', async () => {
    const world: World = { forgeUp: true, loaded: [], calls: [], txt2imgPayloads: [] };
    const { svc } = service(world, { refinePrompts: false }, join(root, 'Forge-sans-anime'), { realvis: true });
    const result = await svc.generate({ prompt: 'un renard', project: 'perso', render: 'anime' });
    expect(result.render).toBe('anime');
    expect(result.renderHonored).toBe(false);
    // L'ordre du rendu anime continue avec SDXL de base (plus polyvalent que les modèles photo).
    expect(result.checkpoint?.id).toBe('sdxl-base');
    expect(result.warnings.join(' ')).toContain('aucun modèle anime');
    expect(result.warnings.join(' ')).toContain('animagine-xl-4.0-opt.safetensors');
    expect(describeImagesResult(result)).toContain('rendu anime demandé mais aucun modèle de ce rendu');
    expect(readFileSync(result.files[0]!.txt, 'utf8')).toContain('rendu anime demandé, modèle realiste');
  });

  it('ADetailer installé mais non chargé par Forge : image faite sans retouche, et dit', async () => {
    const world: World = { forgeUp: true, loaded: [], calls: [], txt2imgPayloads: [], adetailerLoaded: false };
    const { svc } = service(world, { refinePrompts: false }, join(root, 'Forge-sans-ad'), { adetailer: true });
    const result = await svc.generate({ prompt: 'a man running', project: 'perso', subjectType: 'personne' });
    expect(result.adetailer).toBe(false);
    expect((world.txt2imgPayloads[0] as Record<string, unknown>).alwayson_scripts).toEqual({ 'Never OOM Integrated': { args: [false, false, 512, 64] } });
    expect(result.warnings.join(' ')).toContain('ADetailer');
  });

  it('pickBrainModel : le cerveau de l’orchestre, sinon le modèle qui tournait, sinon celui du chat', () => {
    expect(pickBrainModel(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', orchestra: { enabled: true, brain: 'qwen2.5:7b' } }), [])).toBe('qwen2.5:7b');
    expect(pickBrainModel(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' }), ['jarvis-coder'])).toBe('jarvis-coder');
    expect(pickBrainModel(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' }), [])).toBe('qwen2.5:3b');
    expect(pickBrainModel(parseSettings({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test' }), [])).toBeNull();
  });
});
