import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import {
  DEFAULT_IMAGER_RULES,
  DEFAULT_PRESETS,
  buildDirectPayload,
  detectDirectImageRequest,
  directProjectDefaults,
  guessPersonCount,
  guessProject,
  guessSubjectType,
  isSafeModelFileName,
  normalizeDirectRequest,
  parseImageCommand,
  stripDirectTurns,
} from './index.js';

describe('mode direct : commande /image', () => {
  it('lit « /image … » et « /img … », rien d’autre', () => {
    expect(parseImageCommand('/image un renard roux dans la neige')).toEqual({ prompt: 'un renard roux dans la neige' });
    expect(parseImageCommand('  /IMG  a red fox, snow  ')).toEqual({ prompt: 'a red fox, snow' });
    expect(parseImageCommand('/image')).toEqual({ prompt: '' });
    expect(parseImageCommand('/image\nsur deux lignes')).toEqual({ prompt: 'sur deux lignes' });
    expect(parseImageCommand('génère une image de renard')).toBeNull();
    expect(parseImageCommand('/images_etat')).toBeNull();
    expect(parseImageCommand('/imagerie')).toBeNull();
  });
});

describe('mode direct : demande', () => {
  it('garde la consigne et le négatif tels quels, ajoute seulement les LoRA choisis', () => {
    const payload = buildDirectPayload(
      { prompt: ' femme in lingerie red, très pudique ', negative: 'flou, moche', project: 'perso', loras: [{ name: 'monstyle', weight: 0.6 }, { name: 'autre' }], format: 'portrait', count: 2, seed: 42, steps: 25, cfg: 4.5, sampler: 'Euler a', scheduler: 'Simple' },
      { vae: 'sdxl_vae_fp16_fix.safetensors', builtinScripts: { 'Never OOM Integrated': { args: [false, false, 512, 64] } } },
    );
    // Aucune reformulation, aucune règle d'Imager : les mots français restent.
    expect(payload.prompt).toBe('femme in lingerie red, très pudique <lora:monstyle:0.6> <lora:autre:0.8>');
    expect(payload.negative_prompt).toBe('flou, moche');
    expect(payload).toMatchObject({ width: 832, height: 1216, batch_size: 2, seed: 42, steps: 25, cfg_scale: 4.5, sampler_name: 'Euler a', scheduler: 'Simple', save_images: false });
    expect(payload.override_settings).toEqual({ sd_vae: 'sdxl_vae_fp16_fix.safetensors' });
    expect(payload.alwayson_scripts).toEqual({ 'Never OOM Integrated': { args: [false, false, 512, 64] } });
  });

  it('défauts : carré, 30 pas, CFG 5, DPM++ 2M Karras, graine aléatoire, modèle choisi et ADetailer', () => {
    const payload = buildDirectPayload({ prompt: 'a cat', negative: '', project: 'jarvis', checkpoint: 'RealVisXL_V5.0_fp16.safetensors' }, { adetailerArgs: [true, { ad_model: 'face_yolov8n.pt' }] });
    expect(payload).toMatchObject({ prompt: 'a cat', negative_prompt: '', width: 1024, height: 1024, steps: 30, cfg_scale: 5, sampler_name: 'DPM++ 2M', scheduler: 'Karras', seed: -1, batch_size: 1 });
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'RealVisXL_V5.0_fp16.safetensors' });
    expect(payload.alwayson_scripts).toEqual({ ADetailer: { args: [true, { ad_model: 'face_yolov8n.pt' }] } });
  });

  it('valide ce qui vient de l’interface : bornes et noms de fichiers sans chemin', () => {
    const ok = normalizeDirectRequest({ prompt: 'a cat', negative: 'x', project: 'perso', checkpoint: 'animagine-xl-4.0-opt.safetensors', loras: [{ name: 'monstyle.safetensors', weight: 1 }], format: '16:9', count: '3', seed: '-1', steps: 28, cfg: '5.5', sampler: 'Euler a', scheduler: 'Automatic', adetailer: { faces: true }, keepTxt: false });
    expect(ok).toEqual({
      ok: true,
      request: { prompt: 'a cat', negative: 'x', project: 'perso', checkpoint: 'animagine-xl-4.0-opt.safetensors', loras: [{ name: 'monstyle', weight: 1 }], format: '16:9', count: 3, steps: 28, cfg: 5.5, sampler: 'Euler a', scheduler: 'Automatic', adetailer: { faces: true, hands: false }, keepTxt: false },
    });
    const bad = (input: Record<string, unknown>) => {
      const result = normalizeDirectRequest({ prompt: 'a cat', negative: '', project: 'perso', ...input });
      return result.ok ? 'ok' : result.error;
    };
    expect(bad({ prompt: '  ' })).toMatch(/consigne/i);
    expect(bad({ project: 'autre' })).toMatch(/Projet inconnu/);
    expect(bad({ checkpoint: '..\\secret.safetensors' })).toMatch(/sans chemin/);
    expect(bad({ checkpoint: 'C:/x/y.safetensors' })).toMatch(/sans chemin/);
    expect(bad({ checkpoint: 'model.txt' })).toMatch(/safetensors/);
    expect(bad({ loras: [{ name: '../x' }] })).toMatch(/LoRA/);
    expect(bad({ loras: [{ name: 'a', weight: 3 }] })).toMatch(/force/);
    expect(bad({ format: '1920x1080' })).toMatch(/natives SDXL/);
    expect(bad({ count: 9 })).toMatch(/1 à 4/);
    expect(bad({ steps: 0 })).toMatch(/Étapes/);
    expect(bad({ cfg: 40 })).toMatch(/CFG/);
    expect(bad({ sampler: 'Magic' })).toMatch(/Échantillonneur/);
    expect(bad({ seed: 1.5 })).toMatch(/Graine/);
    expect(isSafeModelFileName('Juggernaut-XI-byRunDiffusion.safetensors')).toBe(true);
    expect(isSafeModelFileName('a/b.safetensors')).toBe(false);
  });

  it('défauts par projet : négatif du projet + anatomie, réglages du projet, formats conseillés', () => {
    const perso = directProjectDefaults(DEFAULT_PRESETS.perso, DEFAULT_IMAGER_RULES.negatifAnatomie);
    expect(perso.negative).toContain('low quality');
    expect(perso.negative).toContain('deformed hands');
    expect(perso.negative.split(', ').filter((term) => term === 'bad anatomy')).toHaveLength(1);
    expect(perso).toMatchObject({ steps: DEFAULT_PRESETS.perso.steps, cfg: DEFAULT_PRESETS.perso.cfg, format: DEFAULT_PRESETS.perso.defaultFormat });
    const vx = directProjectDefaults(DEFAULT_PRESETS.vx, []);
    expect(vx.formats).toEqual(DEFAULT_PRESETS.vx.formats);
  });
});

describe('mode direct : historique', () => {
  it('retire les tours /image de la copie envoyée au modèle', () => {
    const messages = [
      createMessage('user', 'bonjour'),
      createMessage('assistant', 'salut'),
      createMessage('user', '/image a cat', { direct: 'image' }),
      createMessage('assistant', 'Image générée : C:\\x.png', { direct: 'image' }),
      createMessage('user', 'et ensuite ?'),
    ];
    expect(stripDirectTurns(messages).map((message) => message.content)).toEqual(['bonjour', 'salut', 'et ensuite ?']);
  });
});

describe('mode direct : repérage par règles (avant tout modèle)', () => {
  it('reconnaît les débuts de phrase de la liste, après « Jarvis, », « peux-tu »…', () => {
    expect(detectDirectImageRequest('Imager, un renard roux dans la neige')).toEqual({ prompt: 'un renard roux dans la neige', trigger: 'imager' });
    expect(detectDirectImageRequest('Jarvis, génère une image de Hinata de Naruto')).toEqual({ prompt: 'génère une image de Hinata de Naruto', trigger: 'genere une image' });
    expect(detectDirectImageRequest('Génère, une image de Hinata dans Naruto. En bikini.')?.trigger).toBe('genere une image');
    expect(detectDirectImageRequest('Dessine-moi un robot qui lit')?.prompt).toBe('Dessine-moi un robot qui lit');
    expect(detectDirectImageRequest('Peux-tu faire une image de chat ?')).toBeNull();
    expect(detectDirectImageRequest('Jarvis peux-tu me faire une image de chat')).toBeNull();
    expect(detectDirectImageRequest('Ok Jarvis, fais-moi une image de chat')?.prompt).toBe('fais-moi une image de chat');
    expect(detectDirectImageRequest('Une image de forêt sous la pluie')?.trigger).toBe('une image de');
    expect(detectDirectImageRequest('Quelle heure est-il ?')).toBeNull();
    expect(detectDirectImageRequest('Mets de la musique')).toBeNull();
    expect(detectDirectImageRequest('Explique-moi comment on génère une image')).toBeNull();
    // Liste modifiable : une liste vide ne repère rien ; une liste maison repère ses phrases.
    expect(detectDirectImageRequest('Génère une image de chat', [])).toBeNull();
    expect(detectDirectImageRequest('Hé Imager fais un chat', ['he imager'])).toEqual({ prompt: 'Hé Imager fais un chat', trigger: 'he imager' });
  });

  it('devine le projet, le type et le nombre de personnes par mots', () => {
    expect(guessProject("un sticker de renard pour Driver's Ink")).toBe('drivers-ink');
    expect(guessProject('une miniature YouTube pour ma vidéo')).toBe('vx');
    expect(guessProject('un fond d’écran pour le projet Jarvis')).toBe('jarvis');
    expect(guessProject('Hinata en bikini sur la plage')).toBe('perso');
    expect(guessSubjectType('Hinata de Naruto, une femme ninja qui sourit')).toBe('personne');
    expect(guessSubjectType('deux amis qui trinquent en terrasse')).toBe('scene');
    expect(guessSubjectType('un paysage de montagne au coucher de soleil')).toBe('paysage');
    expect(guessSubjectType('un sticker de renard')).toBe('logo-sticker');
    expect(guessSubjectType('une voiture rouge sur une route')).toBe('objet');
    expect(guessSubjectType('quelque chose de bleu')).toBe('autre');
    expect(guessPersonCount('deux femmes qui dansent')).toBe(2);
    expect(guessPersonCount('3 amis au bar')).toBe(3);
    expect(guessPersonCount('un couple sur la plage')).toBe(2);
    expect(guessPersonCount('un renard')).toBe(0);
  });
});
