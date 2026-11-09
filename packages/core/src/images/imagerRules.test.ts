import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGER_RULES,
  DEFAULT_PRESETS,
  FORMAT_SIZES,
  NATIVE_SDXL_SIZES,
  adetailerArgs,
  applyImagerRules,
  buildImagerPrompt,
  buildTxt2ImgPayload,
  chooseCheckpoint,
  defaultImagerRulesYaml,
  forgeBuiltinScriptArgs,
  nearestNativeFormat,
  parsePresetsYaml,
  personCountPhrase,
  resolveSize,
  resolveSubjectType,
  wantsAdetailer,
} from './index.js';

describe('Jarvis Imager — tailles natives', () => {
  it('sept tailles natives SDXL, et toute autre taille est ramenée à la plus proche', () => {
    expect(NATIVE_SDXL_SIZES).toHaveLength(7);
    for (const size of NATIVE_SDXL_SIZES) {
      expect(size.width % 64).toBe(0);
      expect(size.height % 64).toBe(0);
      expect(size.width * size.height).toBeGreaterThanOrEqual(1_000_000);
      expect(size.width * size.height).toBeLessThanOrEqual(1_050_000);
    }
    expect(nearestNativeFormat(1920, 1080)).toBe('16:9');
    expect(nearestNativeFormat(4000, 3000)).toBe('paysage-doux');
    expect(nearestNativeFormat(3000, 2000)).toBe('paysage');
    expect(nearestNativeFormat(1080, 1350)).toBe('portrait-doux');
    expect(resolveSize('1000x700', DEFAULT_PRESETS.perso)).toMatchObject({ ...FORMAT_SIZES.paysage, format: 'paysage' });
    expect(resolveSize('1200x1000', DEFAULT_PRESETS.perso)).toMatchObject({ ...FORMAT_SIZES['paysage-doux'], format: 'paysage-doux' });
    expect(resolveSize('4000x4000', DEFAULT_PRESETS.perso)).toMatchObject({ width: 1024, height: 1024 });
    expect(resolveSize('4:3', DEFAULT_PRESETS.perso).format).toBe('paysage-doux');
    const payload = buildTxt2ImgPayload({ prompt: 'x', project: 'perso', format: '1920x1080' }, DEFAULT_PRESETS.perso);
    expect([payload.width, payload.height]).toEqual([1344, 768]);
  });
});

describe('Jarvis Imager — règles', () => {
  it('le fichier de règles par défaut se relit à l’identique', () => {
    const parsed = parsePresetsYaml(defaultImagerRulesYaml());
    expect(parsed.errors).toEqual([]);
    const { rules, warnings } = applyImagerRules(parsed.values);
    expect(warnings).toEqual([]);
    expect(rules).toEqual(DEFAULT_IMAGER_RULES);
  });

  it('une surcharge change une clé ; une valeur fausse ou une section inconnue est signalée', () => {
    const parsed = parsePresetsYaml(['general:', '  checkpoint: juggernaut', '  facteurAgrandissement: 9', 'type-personne:', '  adetailer: false', 'type-robot:', '  positif: [x]', 'checkpoint-maison:', '  fichier: mon.safetensors', '  steps: 25'].join('\n'));
    const { rules, warnings } = applyImagerRules(parsed.values);
    expect(rules.general.checkpoint).toBe('juggernaut');
    expect(rules.general.facteurAgrandissement).toBe(2);
    expect(rules.types.personne.adetailer).toBe(false);
    expect(rules.types.objet).toEqual(DEFAULT_IMAGER_RULES.types.objet);
    expect(rules.checkpoints.maison).toMatchObject({ fichier: 'mon.safetensors', steps: 25, label: 'maison' });
    expect(warnings.join(' ')).toContain('facteurAgrandissement');
    expect(warnings.join(' ')).toContain('robot');
  });

  it('choix du modèle : réglage explicite présent, sinon le premier présent dans l’ordre de priorité', () => {
    const present = (files: string[]) => (f: string) => files.includes(f);
    expect(chooseCheckpoint(DEFAULT_IMAGER_RULES, present(['sd_xl_base_1.0.safetensors', 'RealVisXL_V5.0_fp16.safetensors']))?.id).toBe('realvisxl');
    expect(chooseCheckpoint(DEFAULT_IMAGER_RULES, present(['sd_xl_base_1.0.safetensors']))?.id).toBe('sdxl-base');
    const forced = { ...DEFAULT_IMAGER_RULES, general: { ...DEFAULT_IMAGER_RULES.general, checkpoint: 'juggernaut' } };
    expect(chooseCheckpoint(forced, present(['Juggernaut-XI-byRunDiffusion.safetensors', 'RealVisXL_V5.0_fp16.safetensors']))?.id).toBe('juggernaut');
    // Modèle demandé absent : on retombe sur la priorité.
    expect(chooseCheckpoint(forced, present(['RealVisXL_V5.0_fp16.safetensors']))?.id).toBe('realvisxl');
    expect(chooseCheckpoint(DEFAULT_IMAGER_RULES, present([]))).toBeNull();
  });

  it('type d’après un mot libre', () => {
    expect(resolveSubjectType('portrait')).toBe('personne');
    expect(resolveSubjectType('deux amis')).toBe('autre');
    expect(resolveSubjectType('couple')).toBe('scene');
    expect(resolveSubjectType('sticker')).toBe('logo-sticker');
    expect(resolveSubjectType('montagne')).toBe('paysage');
    expect(resolveSubjectType('voiture')).toBe('objet');
    expect(resolveSubjectType(undefined)).toBe('autre');
  });

  it('consigne finale : projet, sujet, nombre de personnes, type, qualité ; négatif anatomie pour une personne, rien en double', () => {
    const out = buildImagerPrompt(
      {
        subject: 'a young woman with red hair waving, city street at dusk, photo, soft light, medium shot',
        type: 'personne',
        personCount: 1,
        project: 'perso',
        preset: DEFAULT_PRESETS.perso,
        extraNegative: ['neon text', 'blurry'],
        checkpoint: DEFAULT_IMAGER_RULES.checkpoints.realvisxl,
        lora: { name: 'monstyle', weight: 0.9 },
      },
      DEFAULT_IMAGER_RULES,
    );
    expect(out.prompt.startsWith('a young woman with red hair waving')).toBe(true);
    expect(out.prompt).toContain('solo, one person only');
    expect(out.prompt).toContain('detailed hands with five fingers');
    expect(out.prompt).toContain('sharp focus');
    expect(out.prompt.endsWith('<lora:monstyle:0.9>')).toBe(true);
    expect(out.negative).toContain('extra arms');
    expect(out.negative).toContain('fused fingers');
    expect(out.negative).toContain('face asymmetry');
    expect(out.negative).toContain('neon text');
    // « blurry » et « bad hands » viennent déjà d'ailleurs : une seule fois.
    expect(out.negative.split(', ').filter((term) => term === 'blurry')).toHaveLength(1);
    expect(out.negative.split(', ').filter((term) => term === 'bad hands')).toHaveLength(1);
    expect(personCountPhrase(2)).toEqual(['exactly two people', 'each person complete']);
    expect(personCountPhrase(undefined)).toEqual([]);
  });

  it('sticker : règles du projet drivers-ink et du type, pas de négatif anatomie, pas d’ADetailer', () => {
    const out = buildImagerPrompt({ subject: 'a red fox head', type: 'logo-sticker', project: 'drivers-ink', preset: DEFAULT_PRESETS['drivers-ink'] }, DEFAULT_IMAGER_RULES);
    expect(out.prompt).toContain('plain solid white background');
    expect(out.prompt).toContain('clean bold outlines');
    expect(out.negative).toContain('gradients');
    expect(out.negative).not.toContain('extra arms');
    expect(wantsAdetailer(DEFAULT_IMAGER_RULES, 'logo-sticker', true)).toBe(false);
    expect(wantsAdetailer(DEFAULT_IMAGER_RULES, 'personne', true)).toBe(true);
    expect(wantsAdetailer(DEFAULT_IMAGER_RULES, 'personne', false)).toBe(false);
    expect(forgeBuiltinScriptArgs()).toEqual({ 'Never OOM Integrated': { args: [false, false, 512, 64] } });
    const args = adetailerArgs();
    expect(args[0]).toBe(true);
    expect(args[2]).toMatchObject({ ad_model: 'face_yolov8n.pt' });
    expect(args[3]).toMatchObject({ ad_model: 'hand_yolov8n.pt' });
  });

  it('les réglages du modèle priment sur ceux du projet dans la requête', () => {
    const profile = DEFAULT_IMAGER_RULES.checkpoints.realvisxl;
    const payload = buildTxt2ImgPayload({ prompt: 'x', project: 'perso' }, DEFAULT_PRESETS.perso, {
      checkpoint: profile.fichier,
      finalPrompt: 'final prompt',
      finalNegative: 'final negative',
      sampling: { sampler: profile.sampler, scheduler: profile.scheduler, steps: profile.steps, cfg: profile.cfg },
      alwaysonScripts: { ADetailer: { args: adetailerArgs() } },
    });
    expect(payload).toMatchObject({ prompt: 'final prompt', negative_prompt: 'final negative', sampler_name: 'DPM++ SDE', scheduler: 'Karras', steps: 30, cfg_scale: 5 });
    expect(payload.override_settings).toEqual({ sd_model_checkpoint: 'RealVisXL_V5.0_fp16.safetensors' });
    expect(payload.alwayson_scripts?.ADetailer?.args).toHaveLength(4);
  });
});
