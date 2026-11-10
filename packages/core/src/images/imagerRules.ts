/**
 * Jarvis Imager : règles d'écriture des consignes, modèles SDXL connus et retouches.
 *
 * Fichier pur. Les défauts vivent ici ; le fichier `imager_rules.yaml` (copie de référence
 * dans `config/`, copie vivante dans le dossier des images) peut en remplacer une partie.
 * Il se lit avec le même lecteur que `images_presets.yaml` : des sections à deux niveaux
 * (`general`, `qualite`, `type-personne`, `checkpoint-realvisxl`…), chaque clé une valeur,
 * une liste `[a, b]` ou `- a`, ou un texte replié `>`.
 */

import type { ImagePreset, ImageProject } from './presets.js';

/** Ce que représente l'image : décide des mots ajoutés, du négatif et des retouches. */
export const IMAGE_SUBJECT_TYPES = ['personne', 'objet', 'paysage', 'logo-sticker', 'scene', 'autre'] as const;
export type ImageSubjectType = (typeof IMAGE_SUBJECT_TYPES)[number];

export interface SubjectTypeRule {
  /** Mots ajoutés au prompt pour ce type. */
  positif: readonly string[];
  /** Défauts ajoutés au prompt négatif pour ce type. */
  negatif: readonly string[];
  /** Repasser sur les visages et les mains (ADetailer) quand l'extension est là. */
  adetailer: boolean;
  /**
   * Passe « mains » en plus des visages. Coupée pour les scènes à plusieurs personnes : mesuré le
   * 10 novembre, deux passes sur une image 1216×832 faisaient planter Forge (6 Go) ; visages seuls : ok.
   */
  adetailerMains: boolean;
}

export interface CheckpointProfile {
  /** Nom de fichier dans `models/Stable-diffusion`. */
  fichier: string;
  label: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  /** VAE séparé à forcer ; vide = celui du modèle (intégré). */
  vae: string;
  /** Négatif recommandé par l'auteur du modèle. */
  negatif: readonly string[];
}

export interface ImagerRules {
  general: {
    /** `auto` = premier modèle présent dans l'ordre `priorite` ; sinon l'identifiant d'un profil. */
    checkpoint: string;
    priorite: readonly string[];
    adetailer: boolean;
    /** Agrandisseur Forge utilisé quand l'utilisateur veut plus grand (« agrandir »). */
    upscaler: string;
    facteurAgrandissement: number;
  };
  qualite: readonly string[];
  negatifAnatomie: readonly string[];
  types: Record<ImageSubjectType, SubjectTypeRule>;
  checkpoints: Record<string, CheckpointProfile>;
}

export const DEFAULT_IMAGER_RULES: ImagerRules = {
  general: {
    checkpoint: 'auto',
    priorite: ['realvisxl', 'juggernaut', 'sdxl-base'],
    adetailer: true,
    upscaler: 'R-ESRGAN 4x+',
    facteurAgrandissement: 2,
  },
  qualite: ['highly detailed', 'sharp focus', 'professional quality'],
  negatifAnatomie: [
    'extra arms',
    'extra legs',
    'extra limbs',
    'extra fingers',
    'missing fingers',
    'fused fingers',
    'deformed hands',
    'bad hands',
    'malformed limbs',
    'deformed face',
    'asymmetric eyes',
    'cross-eyed',
    'long neck',
    'bad anatomy',
    'bad proportions',
    'mutated',
    'disfigured',
  ],
  types: {
    personne: {
      positif: ['natural proportions', 'detailed face', 'detailed hands with five fingers'],
      negatif: ['duplicate person', 'clone', 'extra heads'],
      adetailer: true,
      adetailerMains: true,
    },
    scene: {
      positif: ['coherent scene', 'natural proportions', 'detailed faces'],
      negatif: ['duplicate person', 'extra heads', 'floating objects'],
      adetailer: true,
      adetailerMains: false,
    },
    objet: {
      positif: ['centered subject', 'detailed materials and textures', 'accurate shape'],
      negatif: ['melted', 'warped', 'deformed shape', 'floating parts'],
      adetailer: false,
      adetailerMains: false,
    },
    paysage: {
      positif: ['wide shot', 'atmospheric depth', 'coherent perspective'],
      negatif: ['warped perspective', 'tilted horizon', 'duplicate sun'],
      adetailer: false,
      adetailerMains: false,
    },
    'logo-sticker': {
      positif: ['vector illustration', 'flat colors', 'clean bold outlines', 'centered', 'simple shapes'],
      negatif: ['photo', 'photorealistic', 'gradients', 'text', 'letters', 'words', 'complex background', 'noise'],
      adetailer: false,
      adetailerMains: false,
    },
    autre: { positif: [], negatif: [], adetailer: false, adetailerMains: false },
  },
  checkpoints: {
    realvisxl: {
      fichier: 'RealVisXL_V5.0_fp16.safetensors',
      label: 'RealVisXL V5.0',
      sampler: 'DPM++ SDE',
      scheduler: 'Karras',
      steps: 30,
      cfg: 5,
      vae: '',
      negatif: ['bad hands', 'bad anatomy', 'ugly', 'deformed', 'face asymmetry', 'eyes asymmetry', 'deformed eyes', 'deformed mouth', 'open mouth'],
    },
    juggernaut: {
      fichier: 'Juggernaut-XI-byRunDiffusion.safetensors',
      label: 'Juggernaut XI',
      sampler: 'DPM++ 2M',
      scheduler: 'Karras',
      steps: 35,
      cfg: 5,
      vae: '',
      negatif: [],
    },
    'sdxl-base': {
      fichier: 'sd_xl_base_1.0.safetensors',
      label: 'SDXL base 1.0',
      sampler: 'DPM++ 2M',
      scheduler: 'Karras',
      steps: 28,
      cfg: 6,
      vae: 'sdxl_vae_fp16_fix.safetensors',
      negatif: [],
    },
  },
};

export function isImageSubjectType(value: string): value is ImageSubjectType {
  return (IMAGE_SUBJECT_TYPES as readonly string[]).includes(value);
}

/** Type d'après un mot libre : « portrait », « personnage » → personne ; « sticker » → logo-sticker… */
export function resolveSubjectType(value: string | undefined | null): ImageSubjectType {
  const text = (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  if (!text) return 'autre';
  if (isImageSubjectType(text)) return text;
  if (/person|portrait|visage|femme|homme|fille|garcon|enfant|humain|people|character|personnage|corps/.test(text)) return 'personne';
  if (/scene|groupe|foule|couple|famille/.test(text)) return 'scene';
  if (/sticker|logo|icone|icon|embleme|badge|vector|vectoriel/.test(text)) return 'logo-sticker';
  if (/paysage|landscape|ville|city|nature|montagne|mer|ciel|decor|interieur|architecture/.test(text)) return 'paysage';
  if (/objet|object|produit|product|voiture|animal|nourriture|food/.test(text)) return 'objet';
  return 'autre';
}

function asStringList(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return null;
}

/**
 * Applique les sections lues dans `imager_rules.yaml` aux défauts. Une valeur fausse est
 * ignorée et signalée dans `warnings` ; une section inconnue aussi.
 */
export function applyImagerRules(sections: Partial<Record<string, Record<string, unknown>>>): { rules: ImagerRules; warnings: string[] } {
  const warnings: string[] = [];
  const rules: ImagerRules = {
    general: { ...DEFAULT_IMAGER_RULES.general },
    qualite: [...DEFAULT_IMAGER_RULES.qualite],
    negatifAnatomie: [...DEFAULT_IMAGER_RULES.negatifAnatomie],
    types: Object.fromEntries(Object.entries(DEFAULT_IMAGER_RULES.types).map(([key, rule]) => [key, { ...rule }])) as ImagerRules['types'],
    checkpoints: Object.fromEntries(Object.entries(DEFAULT_IMAGER_RULES.checkpoints).map(([key, profile]) => [key, { ...profile }])),
  };
  for (const [section, values] of Object.entries(sections)) {
    if (!values) continue;
    if (section === 'general') {
      if (typeof values.checkpoint === 'string') rules.general.checkpoint = values.checkpoint.trim() || 'auto';
      const priorite = values.priorite !== undefined ? asStringList(values.priorite) : null;
      if (priorite?.length) rules.general.priorite = priorite;
      else if (values.priorite !== undefined) warnings.push('general.priorite : liste attendue (ignorée).');
      if (values.adetailer !== undefined) {
        if (typeof values.adetailer === 'boolean') rules.general.adetailer = values.adetailer;
        else warnings.push('general.adetailer : true ou false attendu (ignoré).');
      }
      if (typeof values.upscaler === 'string' && values.upscaler.trim()) rules.general.upscaler = values.upscaler.trim();
      if (values.facteurAgrandissement !== undefined) {
        const n = Number(values.facteurAgrandissement);
        if (Number.isFinite(n) && n >= 1.5 && n <= 4) rules.general.facteurAgrandissement = n;
        else warnings.push('general.facteurAgrandissement : nombre entre 1.5 et 4 attendu (ignoré).');
      }
      continue;
    }
    if (section === 'qualite') {
      const list = asStringList(values.positif ?? values.liste);
      if (list) rules.qualite = list;
      else warnings.push('qualite : clé positif attendue (ignorée).');
      continue;
    }
    if (section === 'anatomie') {
      const list = asStringList(values.negatif);
      if (list) rules.negatifAnatomie = list;
      else warnings.push('anatomie : clé negatif attendue (ignorée).');
      continue;
    }
    if (section.startsWith('type-')) {
      const type = section.slice(5);
      if (!isImageSubjectType(type)) {
        warnings.push(`Type inconnu : « ${type} » (ignoré ; connus : ${IMAGE_SUBJECT_TYPES.join(', ')}).`);
        continue;
      }
      const current = { ...rules.types[type] };
      const positif = values.positif !== undefined ? asStringList(values.positif) : null;
      const negatif = values.negatif !== undefined ? asStringList(values.negatif) : null;
      if (positif) current.positif = positif;
      if (negatif) current.negatif = negatif;
      if (values.adetailer !== undefined) {
        if (typeof values.adetailer === 'boolean') current.adetailer = values.adetailer;
        else warnings.push(`${section}.adetailer : true ou false attendu (ignoré).`);
      }
      if (values.adetailerMains !== undefined) {
        if (typeof values.adetailerMains === 'boolean') current.adetailerMains = values.adetailerMains;
        else warnings.push(`${section}.adetailerMains : true ou false attendu (ignoré).`);
      }
      rules.types[type] = current;
      continue;
    }
    if (section.startsWith('checkpoint-')) {
      const id = section.slice(11);
      const base = rules.checkpoints[id] ?? { fichier: '', label: id, sampler: 'DPM++ 2M', scheduler: 'Karras', steps: 30, cfg: 5, vae: '', negatif: [] };
      const next: CheckpointProfile = { ...base };
      for (const key of ['fichier', 'label', 'sampler', 'scheduler', 'vae'] as const) {
        if (typeof values[key] === 'string') next[key] = (values[key] as string).trim();
      }
      for (const key of ['steps', 'cfg'] as const) {
        if (values[key] === undefined) continue;
        const n = Number(values[key]);
        const max = key === 'steps' ? 80 : 20;
        if (Number.isFinite(n) && n > 0 && n <= max) next[key] = key === 'steps' ? Math.round(n) : n;
        else warnings.push(`${section}.${key} : nombre entre 1 et ${max} attendu (ignoré).`);
      }
      const negatif = values.negatif !== undefined ? asStringList(values.negatif) : null;
      if (negatif) next.negatif = negatif;
      if (!next.fichier) {
        warnings.push(`${section} : clé fichier manquante (ignoré).`);
        continue;
      }
      rules.checkpoints[id] = next;
      continue;
    }
    warnings.push(`Section inconnue dans les règles : « ${section} » (ignorée).`);
  }
  return { rules, warnings };
}

function yamlList(items: readonly string[]): string {
  return `[${items.map((item) => (/[,:#[\]]/.test(item) ? `"${item.replace(/"/g, '\\"')}"` : item)).join(', ')}]`;
}

/** Fichier de règles par défaut, commenté en français, prêt à être modifié. */
export function defaultImagerRulesYaml(rules: ImagerRules = DEFAULT_IMAGER_RULES): string {
  const lines = [
    '# Règles de Jarvis Imager (consignes envoyées à Stable Diffusion).',
    '# Modifie puis enregistre : Jarvis relit ce fichier à chaque image. Une clé absente garde sa valeur',
    '# par défaut ; une valeur fausse est ignorée et signalée.',
    '#',
    '# general : checkpoint (auto, ou realvisxl / juggernaut / sdxl-base), priorite (ordre essayé quand auto),',
    '#   adetailer (retouche visages et mains), upscaler et facteurAgrandissement (quand on demande « plus grand »).',
    '# qualite : mots ajoutés à la fin de chaque consigne. anatomie : défauts d’anatomie toujours évités pour les personnes.',
    '# type-<type> : mots ajoutés (positif), défauts évités (negatif), adetailer (retouche visages), adetailerMains (retouche mains en plus) selon ce que représente l’image.',
    '# checkpoint-<id> : fichier, label, sampler, scheduler, steps, cfg, vae (vide = celui du modèle), negatif de l’auteur.',
    '',
    'general:',
    `  checkpoint: ${rules.general.checkpoint}`,
    `  priorite: ${yamlList(rules.general.priorite)}`,
    `  adetailer: ${rules.general.adetailer ? 'true' : 'false'}`,
    `  upscaler: "${rules.general.upscaler}"`,
    `  facteurAgrandissement: ${rules.general.facteurAgrandissement}`,
    '',
    'qualite:',
    `  positif: ${yamlList(rules.qualite)}`,
    '',
    'anatomie:',
    `  negatif: ${yamlList(rules.negatifAnatomie)}`,
    '',
  ];
  for (const type of IMAGE_SUBJECT_TYPES) {
    const rule = rules.types[type];
    lines.push(
      `type-${type}:`,
      `  positif: ${yamlList(rule.positif)}`,
      `  negatif: ${yamlList(rule.negatif)}`,
      `  adetailer: ${rule.adetailer ? 'true' : 'false'}`,
      `  adetailerMains: ${rule.adetailerMains ? 'true' : 'false'}`,
      '',
    );
  }
  for (const [id, profile] of Object.entries(rules.checkpoints)) {
    lines.push(
      `checkpoint-${id}:`,
      `  fichier: ${profile.fichier}`,
      `  label: "${profile.label}"`,
      `  sampler: "${profile.sampler}"`,
      `  scheduler: ${profile.scheduler}`,
      `  steps: ${profile.steps}`,
      `  cfg: ${profile.cfg}`,
      `  vae: "${profile.vae}"`,
      `  negatif: ${yamlList(profile.negatif)}`,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Profil du modèle à utiliser : réglage explicite, sinon le premier présent dans l'ordre de priorité. */
export function chooseCheckpoint(rules: ImagerRules, present: (fichier: string) => boolean): { id: string; profile: CheckpointProfile } | null {
  const wanted = rules.general.checkpoint.trim();
  if (wanted && wanted !== 'auto') {
    const profile = rules.checkpoints[wanted];
    if (profile && present(profile.fichier)) return { id: wanted, profile };
  }
  for (const id of rules.general.priorite) {
    const profile = rules.checkpoints[id];
    if (profile && present(profile.fichier)) return { id, profile };
  }
  for (const [id, profile] of Object.entries(rules.checkpoints)) if (present(profile.fichier)) return { id, profile };
  return null;
}

export interface ImagerPromptInput {
  /** Description du sujet et de la scène, en anglais (venue de la reformulation ou donnée telle quelle). */
  subject: string;
  type: ImageSubjectType;
  /** Nombre de personnes voulu (personne / scène). */
  personCount?: number;
  project: ImageProject;
  preset: ImagePreset;
  style?: string;
  /** Négatif propre à la demande (reformulation) et négatif de l'utilisateur. */
  extraNegative?: readonly string[];
  checkpoint?: CheckpointProfile;
  lora?: { name: string; weight?: number };
}

const splitTerms = (text: string): string[] => text.split(',').map((item) => item.trim()).filter(Boolean);

function dedupeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase().replace(/\s+/g, ' ').replace(/[.]+$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(term.replace(/[.]+$/, ''));
  }
  return result;
}

/** « 1 » → « solo, one person » ; « 2 » → « exactly two people » ; au-delà → chiffre. */
export function personCountPhrase(count: number | undefined): string[] {
  if (!count || count < 1) return [];
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
  if (count === 1) return ['solo', 'one person only'];
  const word = words[count] ?? String(count);
  return [`exactly ${word} people`, 'each person complete'];
}

/**
 * Consigne finale de Jarvis Imager, dans l'ordre que SDXL lit le mieux : règle du projet, sujet,
 * nombre de personnes, style, mots du type, suffixe du projet, qualité, LoRA. Rien en double.
 */
export function buildImagerPrompt(input: ImagerPromptInput, rules: ImagerRules): { prompt: string; negative: string } {
  const typeRule = rules.types[input.type];
  const positive = dedupeTerms([
    ...splitTerms(input.preset.positivePrefix),
    ...splitTerms(input.subject),
    ...personCountPhrase(input.personCount),
    ...splitTerms(input.style ?? ''),
    ...typeRule.positif,
    ...splitTerms(input.preset.positiveSuffix),
    ...rules.qualite,
  ]);
  if (input.lora?.name?.trim()) {
    const name = input.lora.name.trim().replace(/\.safetensors$/i, '');
    const weight = Number.isFinite(input.lora.weight ?? NaN) ? Math.min(1.5, Math.max(0.1, input.lora.weight as number)) : 0.8;
    positive.push(`<lora:${name}:${weight}>`);
  }
  const anatomy = input.type === 'personne' || input.type === 'scene' ? rules.negatifAnatomie : [];
  const negative = dedupeTerms([
    ...splitTerms(input.preset.negative),
    ...typeRule.negatif,
    ...anatomy,
    ...(input.checkpoint?.negatif ?? []),
    ...(input.extraNegative ?? []).flatMap((item) => splitTerms(item)),
  ]);
  return { prompt: positive.join(', '), negative: negative.join(', ') };
}

/** Faut-il repasser sur visages et mains ? Règle générale, type, et présence de l'extension. */
export function wantsAdetailer(rules: ImagerRules, type: ImageSubjectType, extensionAvailable: boolean): boolean {
  return extensionAvailable && rules.general.adetailer && rules.types[type].adetailer;
}

/**
 * Scripts intégrés de Forge dont les arguments doivent toujours être explicites par l'API.
 * Constat du 10 novembre 2026 : avec l'extension ADetailer présente, les arguments par défaut
 * de « Never OOM Integrated » se décalaient (il se croyait activé pour le VAE avec une tuile
 * nulle → `ZeroDivisionError` dans `get_tiled_scale_steps`, HTTP 500 sur chaque image).
 * Les passer explicitement (désactivé, tuile 512, chevauchement 64) rend la requête saine.
 */
export function forgeBuiltinScriptArgs(): Record<string, { args: unknown[] }> {
  return { 'Never OOM Integrated': { args: [false, false, 512, 64] } };
}

/** Arguments ADetailer pour l'API de Forge (`alwayson_scripts.ADetailer.args`) : visages, puis mains si demandé. */
export function adetailerArgs(options: { hands?: boolean } = {}): unknown[] {
  const hands = options.hands !== false;
  return [
    true,
    false,
    {
      ad_model: 'face_yolov8n.pt',
      ad_prompt: 'detailed face, natural skin, symmetric eyes, sharp focus',
      ad_negative_prompt: 'deformed face, asymmetric eyes, cross-eyed, blurry, extra eyes',
      ad_confidence: 0.3,
      ad_dilate_erode: 4,
      ad_mask_blur: 4,
      ad_denoising_strength: 0.35,
      ad_inpaint_only_masked: true,
      ad_inpaint_only_masked_padding: 32,
      // Mesuré le 10 novembre : chaque passe au nombre de pas de l'image doublait le temps total
      // (≈ 240 s contre ≈ 60 s). 16 pas suffisent pour une retouche locale.
      ad_use_steps: true,
      ad_steps: 16,
    },
    ...(hands
      ? [
          {
            ad_model: 'hand_yolov8n.pt',
            ad_prompt: 'detailed hand, five fingers, natural hand anatomy',
            ad_negative_prompt: 'extra fingers, missing fingers, fused fingers, deformed hand, bad hands',
            ad_confidence: 0.3,
            ad_dilate_erode: 4,
            ad_mask_blur: 4,
            ad_denoising_strength: 0.3,
            ad_inpaint_only_masked: true,
            ad_inpaint_only_masked_padding: 32,
            ad_use_steps: true,
            ad_steps: 16,
          },
        ]
      : []),
  ];
}
