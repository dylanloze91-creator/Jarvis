import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import { availableTeams, expressTeam, parseSettings, teamHasTool, ORCHESTRA_TEAMS, TEAM_SPECS, defaultSettings } from '../index.js';
import {
  DEFAULT_PRESETS,
  applyPresetOverrides,
  buildTxt2ImgPayload,
  clampCount,
  defaultPresetsYaml,
  imageFileNames,
  imagesTurnPrompt,
  isImageToolName,
  looksLikeImageIntent,
  parsePresetsYaml,
  parseTxt2ImgInfo,
  recentlyUsedImageTools,
  resolveImageProject,
  resolveSize,
  sidecarText,
  imageSlug,
} from './index.js';

describe('module images — réglages par projet', () => {
  it('le fichier YAML par défaut se relit à l’identique', () => {
    const text = defaultPresetsYaml();
    const parsed = parsePresetsYaml(text);
    expect(parsed.errors).toEqual([]);
    const { presets, warnings } = applyPresetOverrides(parsed.values);
    expect(warnings).toEqual([]);
    expect(presets).toEqual(DEFAULT_PRESETS);
  });

  it('une surcharge partielle change une seule clé, une valeur fausse est signalée et ignorée', () => {
    const parsed = parsePresetsYaml(['drivers-ink:', '  steps: 35', '  cfg: 99', '  formats: [portrait, inconnu]', 'bidule:', '  steps: 1'].join('\n'));
    const { presets, warnings } = applyPresetOverrides(parsed.values);
    expect(presets['drivers-ink'].steps).toBe(35);
    expect(presets['drivers-ink'].cfg).toBe(DEFAULT_PRESETS['drivers-ink'].cfg);
    expect(presets['drivers-ink'].formats).toEqual(['portrait']);
    expect(presets.vx).toEqual(DEFAULT_PRESETS.vx);
    expect(warnings.join(' ')).toContain('cfg');
    expect(warnings.join(' ')).toContain('bidule');
  });

  it('lit un texte replié, une liste en tirets, des commentaires et des guillemets', () => {
    const text = [
      '# un commentaire',
      'vx:',
      '  negative: >',
      '    pas de texte,',
      '    pas de logo  # encore un commentaire',
      '  formats:',
      '    - 16:9',
      '    - 9:16',
      '  label: "VX : vidéos"',
      '  blackAndWhite: oui',
    ].join('\n');
    const parsed = parsePresetsYaml(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.values.vx).toEqual({ negative: 'pas de texte, pas de logo', formats: ['16:9', '9:16'], label: 'VX : vidéos', blackAndWhite: true });
  });

  it('drivers-ink : fond blanc, contours nets, noir et blanc, et aucun logo, texte ni visage réel', () => {
    const preset = DEFAULT_PRESETS['drivers-ink'];
    expect(preset.positivePrefix).toMatch(/white background/);
    expect(preset.positivePrefix).toMatch(/outlines/);
    expect(preset.blackAndWhite).toBe(true);
    for (const banned of ['brand logos', 'text', 'real person face']) expect(preset.negative).toContain(banned);
    expect(DEFAULT_PRESETS.vx.formats).toEqual(['16:9', '9:16']);
  });

  it('reconnaît le projet d’après un mot libre', () => {
    expect(resolveImageProject('Drivers Ink')).toBe('drivers-ink');
    expect(resolveImageProject('sticker')).toBe('drivers-ink');
    expect(resolveImageProject('miniature youtube')).toBe('vx');
    expect(resolveImageProject('perso')).toBe('perso');
    expect(resolveImageProject('jarvis')).toBe('jarvis');
    expect(resolveImageProject('cuisine')).toBeNull();
  });
});

describe('module images — requête Forge', () => {
  it('construit le prompt (préfixe, demande, style, suffixe, LoRA) et la taille du format', () => {
    const payload = buildTxt2ImgPayload(
      { prompt: 'a cat on a roof', project: 'drivers-ink', format: '9:16', count: 9, lora: { name: 'monstyle.safetensors', weight: 3 }, seed: 42, style: 'pixel art' },
      DEFAULT_PRESETS['drivers-ink'],
      { checkpoint: 'sd_xl_base_1.0.safetensors', vae: 'sdxl_vae_fp16_fix.safetensors' },
    );
    expect(payload.prompt.startsWith(DEFAULT_PRESETS['drivers-ink'].positivePrefix.replace(/,$/, ''))).toBe(true);
    expect(payload.prompt).toContain('a cat on a roof, pixel art');
    expect(payload.prompt.endsWith('<lora:monstyle:1.5>')).toBe(true);
    expect(payload.negative_prompt).toBe(DEFAULT_PRESETS['drivers-ink'].negative);
    expect([payload.width, payload.height]).toEqual([768, 1344]);
    expect(payload.batch_size).toBe(4);
    expect(payload.seed).toBe(42);
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'sd_xl_base_1.0.safetensors', sd_vae: 'sdxl_vae_fp16_fix.safetensors' });
    expect(payload.save_images).toBe(false);
  });

  it('formats : alias, taille libre arrondie aux 64 et bornée, défaut du projet', () => {
    expect(resolveSize('miniature', DEFAULT_PRESETS.vx)).toMatchObject({ width: 1344, height: 768, format: '16:9' });
    // Tailles libres : jamais envoyées telles quelles, ramenées à une taille native SDXL.
    expect(resolveSize('1000x700', DEFAULT_PRESETS.perso)).toMatchObject({ width: 1216, height: 832 });
    expect(resolveSize('100x9000', DEFAULT_PRESETS.perso)).toMatchObject({ width: 768, height: 1344 });
    expect(resolveSize('n’importe quoi', DEFAULT_PRESETS.vx).format).toBe('16:9');
    expect(resolveSize(undefined, DEFAULT_PRESETS.jarvis).format).toBe('carre');
    expect(clampCount(undefined)).toBe(1);
    expect(clampCount(0)).toBe(1);
  });

  it('relit les graines et le modèle dans la réponse de Forge', () => {
    expect(parseTxt2ImgInfo(JSON.stringify({ seed: 10, all_seeds: [10, 11], sd_model_name: 'sd_xl_base_1.0' }), 2)).toEqual({ seeds: [10, 11], checkpoint: 'sd_xl_base_1.0' });
    expect(parseTxt2ImgInfo(JSON.stringify({ seed: 5 }), 2)).toEqual({ seeds: [5, 6] });
    expect(parseTxt2ImgInfo('pas du json', 1)).toEqual({ seeds: [-1] });
  });
});

describe('module images — intention', () => {
  it('reconnaît une demande d’image', () => {
    for (const text of [
      'Génère une image d’un chat sur un toit, photo',
      'Fais-moi un sticker de renard pour Drivers Ink',
      'Crée 3 miniatures YouTube pour ma vidéo sur les montres',
      'Dessine-moi un robot qui lit un livre',
      'Une illustration de forêt sous la pluie',
      'Jarvis, peux-tu créer une image de montagne au lever du soleil ?',
      'Génère une nouvelle image avec Stable Diffusion',
      'Je veux un logo pour ma chaîne, fais une image',
      // « Génère-moi » entendu « Générement » par Whisper (enceinte, 10 novembre).
      'Générement une image de Inata Tenauto',
    ]) {
      expect(looksLikeImageIntent(text), text).toBe(true);
    }
  });

  it('ne prend pas pour une génération une image déjà faite, un fichier ou une image disque', () => {
    for (const text of [
      'Ouvre l’image que tu as faite hier',
      'Cherche les images dans mon dossier Photos',
      'Crée une image disque de mon SSD',
      'Quelle heure est-il ?',
      'Mets de la musique',
      'Explique-moi comment fonctionne un dessin vectoriel',
      'Supprime cette image',
    ]) {
      expect(looksLikeImageIntent(text), text).toBe(false);
    }
  });

  it('garde les outils sur un suivi après une génération', () => {
    const history = [
      createMessage('user', 'Génère une image de chat'),
      createMessage('assistant', '', { toolCalls: [{ id: '1', name: 'generer_image', arguments: {} }] }),
      createMessage('tool', 'ok', { toolCallId: '1', toolName: 'generer_image' }),
      createMessage('assistant', 'Voilà.'),
      createMessage('user', 'La même en 16:9'),
    ];
    expect(recentlyUsedImageTools(history)).toBe(true);
    expect(recentlyUsedImageTools([createMessage('user', 'Salut')])).toBe(false);
    expect(isImageToolName('generer_image')).toBe(true);
    expect(isImageToolName('image_disque')).toBe(false);
    expect(imagesTurnPrompt()).toContain('generer_image');
  });
});

describe('module images — orchestre', () => {
  it('l’équipe Images n’existe que si l’outil est enregistré ; le chemin express la désigne', () => {
    expect(ORCHESTRA_TEAMS).toContain('images');
    expect(TEAM_SPECS.images.tools).toEqual(['generer_image', 'images_etat']);
    expect(teamHasTool('images', 'generer_image')).toBe(true);
    expect(teamHasTool('pc', 'generer_image')).toBe(false);
    // Sans l'outil : la liste d'avant (5.0.60), sans « images ».
    expect(availableTeams(['spotify_play', 'open_application'])).toEqual(['conversation', 'pc', 'musique', 'code']);
    expect(availableTeams(['generer_image'])).toContain('images');
    const text = 'Génère une image d’un chat';
    expect(expressTeam({ text, history: [], available: new Set(['conversation', 'pc', 'images']) })).toBe('images');
    // Module coupé : la demande suit le chemin d'avant (le cerveau décide).
    expect(expressTeam({ text, history: [], available: new Set(['conversation', 'pc', 'web']) })).toBeNull();
  });

  it('réglage `images` absent par défaut, accepté quand il est posé', () => {
    expect(parseSettings({})).not.toHaveProperty('images');
    expect(defaultSettings).not.toHaveProperty('images');
    const settings = parseSettings({ images: { enabled: true, forgeDir: 'C:\\dev\\Forge' } });
    expect(settings.images).toEqual({ enabled: true, forgeDir: 'C:\\dev\\Forge' });
  });
});

describe('module images — fichiers', () => {
  it('nomme les fichiers par projet, date, heure et sujet', () => {
    const now = new Date(2026, 10, 9, 21, 5, 7);
    const names = imageFileNames({ project: 'drivers-ink', prompt: 'Un renard roux, style sticker !', now, index: 1 });
    expect(names.folder).toBe('drivers-ink/2026-11-09');
    expect(names.png).toBe('210507-un-renard-roux-style-sticker-2.png');
    expect(names.txt).toBe('210507-un-renard-roux-style-sticker-2.txt');
    expect(names.pngBw).toBe('210507-un-renard-roux-style-sticker-2-nb.png');
    expect(imageSlug('   ???   ')).toBe('image');
  });

  it('le fichier texte garde le prompt et les réglages', () => {
    const payload = buildTxt2ImgPayload({ prompt: 'a fox', project: 'perso' }, DEFAULT_PRESETS.perso);
    const text = sidecarText({ project: 'perso', userPrompt: 'un renard', payload, seed: 123, createdAt: new Date(2026, 0, 1) });
    expect(text).toContain('Projet : perso');
    expect(text).toContain('Demande : un renard');
    expect(text).toContain('Graine : 123');
    expect(text).toContain(`Prompt : ${payload.prompt}`);
    expect(text).toContain('Taille : 1024x1024');
  });
});
