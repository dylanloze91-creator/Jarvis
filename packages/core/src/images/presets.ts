/**
 * Module images (Forge + SDXL) : réglages par projet.
 *
 * Fichier pur : ni Electron, ni réseau. Les valeurs par défaut vivent ici ; le fichier
 * `images_presets.yaml` (dossier des images, copie de référence dans `config/`) peut
 * en remplacer une partie (`applyPresetOverrides`).
 */

export const IMAGE_PROJECTS = ['jarvis', 'vx', 'drivers-ink', 'perso'] as const;
export type ImageProject = (typeof IMAGE_PROJECTS)[number];

/** Formats acceptés dans une demande. `WxH` libre est accepté aussi (multiples de 64). */
export const IMAGE_FORMATS = ['carre', 'paysage', 'portrait', '16:9', '9:16'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** Tailles SDXL natives (environ 1 mégapixel), multiples de 64 : ce que le modèle sait faire. */
export const FORMAT_SIZES: Record<ImageFormat, { width: number; height: number }> = {
  carre: { width: 1024, height: 1024 },
  paysage: { width: 1216, height: 832 },
  portrait: { width: 832, height: 1216 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
};

export interface ImagePreset {
  /** Nom affiché. */
  label: string;
  /** À quoi sert ce projet (lu par l'utilisateur et par le modèle). */
  description: string;
  /** Texte ajouté devant la demande de l'utilisateur (style imposé). Vide = rien. */
  positivePrefix: string;
  /** Texte ajouté derrière la demande (qualité, rendu). Vide = rien. */
  positiveSuffix: string;
  /** Prompt négatif complet. */
  negative: string;
  /** Format par défaut si la demande n'en donne pas. */
  defaultFormat: ImageFormat;
  /** Formats conseillés pour ce projet (le premier est le défaut si `defaultFormat` manque). */
  formats: readonly ImageFormat[];
  /** Pas de diffusion (20 à 40 pour SDXL). */
  steps: number;
  /** Fidélité au texte (CFG, 4 à 9). */
  cfg: number;
  /** Échantillonneur Forge / A1111. */
  sampler: string;
  /** Planificateur (Forge ≥ 2024 ; `Automatic` laisse Forge choisir). */
  scheduler: string;
  /** Produire aussi une version noir et blanc (seuil) à côté de chaque image. */
  blackAndWhite: boolean;
}

/** Prompt négatif commun : défauts de rendu classiques de SDXL. */
export const BASE_NEGATIVE =
  'low quality, worst quality, blurry, jpeg artifacts, deformed, disfigured, bad anatomy, extra limbs, extra fingers, watermark, signature, text, cropped, out of frame';

export const DEFAULT_PRESETS: Record<ImageProject, ImagePreset> = {
  jarvis: {
    label: 'Jarvis',
    description: 'Images pour Jarvis lui-même (icônes, fonds, illustrations de l’assistant). Libre.',
    positivePrefix: '',
    positiveSuffix: 'high quality, detailed',
    negative: BASE_NEGATIVE,
    defaultFormat: 'carre',
    formats: ['carre', 'paysage', 'portrait'],
    steps: 28,
    cfg: 6,
    sampler: 'DPM++ 2M',
    scheduler: 'Karras',
    blackAndWhite: false,
  },
  vx: {
    label: 'VX (montage vidéo)',
    description: 'Miniatures et visuels pour les vidéos : 16:9 (YouTube) et 9:16 (shorts, TikTok).',
    positivePrefix: '',
    positiveSuffix: 'cinematic lighting, high contrast, sharp focus, high quality, detailed',
    negative: BASE_NEGATIVE,
    defaultFormat: '16:9',
    formats: ['16:9', '9:16'],
    steps: 28,
    cfg: 6,
    sampler: 'DPM++ 2M',
    scheduler: 'Karras',
    blackAndWhite: false,
  },
  'drivers-ink': {
    label: 'Drivers Ink (stickers vinyle)',
    description:
      'Stickers en vinyle découpé : fond blanc uni, dessin net à contours francs, peu de couleurs. Une version noir et blanc est produite à côté.',
    positivePrefix: 'sticker design, vector illustration, flat colors, bold clean black outlines, limited color palette, high contrast, centered subject, plain solid white background,',
    positiveSuffix: 'simple shapes, die-cut sticker, no gradients, no shading, high quality',
    negative: `${BASE_NEGATIVE}, brand logos, trademarks, text, letters, words, typography, real person face, celebrity, photorealistic, photo, gradients, soft shading, complex background, shadows, noise, texture`,
    defaultFormat: 'carre',
    formats: ['carre', 'portrait', 'paysage'],
    steps: 30,
    cfg: 7,
    sampler: 'DPM++ 2M',
    scheduler: 'Karras',
    blackAndWhite: true,
  },
  perso: {
    label: 'Perso',
    description: 'Images personnelles, sans règle imposée.',
    positivePrefix: '',
    positiveSuffix: 'high quality, detailed',
    negative: BASE_NEGATIVE,
    defaultFormat: 'carre',
    formats: ['carre', 'paysage', 'portrait', '16:9', '9:16'],
    steps: 28,
    cfg: 6,
    sampler: 'DPM++ 2M',
    scheduler: 'Karras',
    blackAndWhite: false,
  },
};

export function isImageProject(value: string): value is ImageProject {
  return (IMAGE_PROJECTS as readonly string[]).includes(value);
}

/** Projet d'après un mot libre : « drivers ink », « Drivers-Ink », « stickers », « vx », « vidéo »… */
export function resolveImageProject(value: string | undefined | null): ImageProject | null {
  const text = (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
  if (!text) return null;
  if (isImageProject(text)) return text;
  if (/drivers?[\s_-]*ink|sticker|vinyle|autocollant/.test(text)) return 'drivers-ink';
  if (/^vx$|montage|video|miniature|thumbnail|youtube|short|tiktok/.test(text)) return 'vx';
  if (/jarvis|assistant/.test(text)) return 'jarvis';
  if (/perso|personnel|moi/.test(text)) return 'perso';
  return null;
}

/** Une surcharge partielle venue du fichier YAML. Les clés inconnues sont ignorées. */
export type PresetOverride = Partial<ImagePreset>;

const STRING_KEYS = ['label', 'description', 'positivePrefix', 'positiveSuffix', 'negative', 'sampler', 'scheduler'] as const;
const NUMBER_KEYS = ['steps', 'cfg'] as const;

/**
 * Applique les surcharges d'un fichier de réglages aux défauts. Une valeur invalide
 * (format inconnu, nombre hors bornes) est ignorée et signalée dans `warnings`.
 */
export function applyPresetOverrides(
  overrides: Partial<Record<string, Record<string, unknown>>>,
): { presets: Record<ImageProject, ImagePreset>; warnings: string[] } {
  const warnings: string[] = [];
  const presets = { ...DEFAULT_PRESETS } as Record<ImageProject, ImagePreset>;
  for (const [rawProject, values] of Object.entries(overrides)) {
    if (!values) continue;
    const project = resolveImageProject(rawProject);
    if (!project) {
      warnings.push(`Projet inconnu dans les réglages : « ${rawProject} » (ignoré).`);
      continue;
    }
    const next: ImagePreset = { ...presets[project] };
    for (const key of STRING_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') warnings.push(`${project}.${key} : texte attendu (ignoré).`);
      else next[key] = value.trim();
    }
    for (const key of NUMBER_KEYS) {
      const value = values[key];
      if (value === undefined) continue;
      const number = typeof value === 'number' ? value : Number(value);
      const max = key === 'steps' ? 80 : 20;
      if (!Number.isFinite(number) || number <= 0 || number > max) {
        warnings.push(`${project}.${key} : nombre entre 1 et ${max} attendu (ignoré).`);
      } else next[key] = key === 'steps' ? Math.round(number) : number;
    }
    if (values.blackAndWhite !== undefined) {
      if (typeof values.blackAndWhite === 'boolean') next.blackAndWhite = values.blackAndWhite;
      else warnings.push(`${project}.blackAndWhite : true ou false attendu (ignoré).`);
    }
    if (values.formats !== undefined) {
      const list = Array.isArray(values.formats) ? values.formats : [values.formats];
      const formats = list.filter((item): item is ImageFormat => typeof item === 'string' && isImageFormat(item));
      if (formats.length) next.formats = formats;
      else warnings.push(`${project}.formats : aucun format connu (${IMAGE_FORMATS.join(', ')}) (ignoré).`);
    }
    if (values.defaultFormat !== undefined) {
      if (typeof values.defaultFormat === 'string' && isImageFormat(values.defaultFormat)) {
        next.defaultFormat = values.defaultFormat;
      } else warnings.push(`${project}.defaultFormat : format inconnu (ignoré).`);
    }
    presets[project] = next;
  }
  return { presets, warnings };
}

export function isImageFormat(value: string): value is ImageFormat {
  return (IMAGE_FORMATS as readonly string[]).includes(value);
}
