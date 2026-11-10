/**
 * Mode direct de Jarvis Imager : la consigne de l'utilisateur part à Forge **telle qu'il l'écrit**,
 * sans passer par le modèle de langage (ni reformulation, ni jugement, ni règles d'Imager).
 * Deux entrées : le panneau « Imager direct » et la commande `/image …` de la discussion.
 *
 * Fichier pur : aucun réseau, aucun Electron. La validation sert aussi de garde pour ce qui
 * arrive de l'interface (IPC) : noms de fichiers sans chemin, bornes sur chaque nombre.
 */

import type { ChatMessage } from '../types.js';
import type { ImageSubjectType } from './imagerRules.js';
import { FORMAT_SIZES, IMAGE_FORMATS, IMAGE_PROJECTS, isImageFormat, type ImageFormat, type ImagePreset, type ImageProject } from './presets.js';
import { DEFAULT_LORA_WEIGHT, MAX_IMAGES_PER_REQUEST, type Txt2ImgPayload } from './request.js';

/* ------------------------------------------------------------------ */
/* Commande `/image` de la discussion                                   */
/* ------------------------------------------------------------------ */

export const IMAGE_COMMAND = '/image';

/**
 * `/image un renard roux dans la neige` → `{ prompt: 'un renard roux dans la neige' }`.
 * `/img` accepté. Pas une commande : `null`. Commande sans texte : `{ prompt: '' }` (l'appelant
 * répond qu'il faut écrire la consigne après `/image`).
 */
export function parseImageCommand(text: string): { prompt: string } | null {
  const match = /^\s*\/(?:image|img)(?:\s+([\s\S]*))?$/iu.exec(text);
  if (!match) return null;
  return { prompt: (match[1] ?? '').trim() };
}

/* ------------------------------------------------------------------ */
/* Demande directe                                                      */
/* ------------------------------------------------------------------ */

/** Échantillonneurs et planificateurs proposés par le panneau (noms exacts de Forge / A1111). */
export const DIRECT_SAMPLERS = ['DPM++ 2M', 'DPM++ SDE', 'DPM++ 2M SDE', 'DPM++ 3M SDE', 'Euler a', 'Euler', 'DDIM', 'UniPC', 'LCM'] as const;
export const DIRECT_SCHEDULERS = ['Automatic', 'Karras', 'Exponential', 'SGM Uniform', 'Simple', 'Normal'] as const;

export const DIRECT_LIMITS = {
  prompt: 4_000,
  negative: 4_000,
  steps: { min: 1, max: 80, default: 30 },
  cfg: { min: 1, max: 20, default: 5 },
  loraWeight: { min: 0.1, max: 1.5 },
  loras: 4,
} as const;

export interface DirectLora {
  /** Nom du fichier sans extension (tel que Forge le liste). */
  name: string;
  /** 0,1 à 1,5 ; absent = 0,8. */
  weight?: number;
}

export interface DirectImageRequest {
  /** Consigne envoyée telle quelle (les LoRA choisis sont ajoutés à la fin, c'est tout). */
  prompt: string;
  /** Prompt négatif envoyé tel quel. */
  negative: string;
  /** Projet de rangement (dossier, et défauts proposés par le panneau). */
  project: ImageProject;
  /** Nom du fichier du modèle dans `models/Stable-diffusion` ; absent = modèle courant de Forge. */
  checkpoint?: string;
  loras?: DirectLora[];
  /** Une des sept tailles natives SDXL ; absent = carré. */
  format?: ImageFormat;
  count?: number;
  /** -1 ou absent = aléatoire. */
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  adetailer?: { faces: boolean; hands: boolean };
  /** `false` = pas de fichier `.txt` à côté de l'image (projet perso, au choix de l'utilisateur). */
  keepTxt?: boolean;
}

/** Nom de fichier sûr : ni séparateur, ni `..`, ni caractère de contrôle. */
const SAFE_FILE_NAME = /^(?!\.)(?!.*\.\.)[\p{L}\p{N} _.\-()[\]+@']{1,200}$/u;

export function isSafeModelFileName(name: string): boolean {
  return SAFE_FILE_NAME.test(name) && !/[\\/:*?"<>|\u0000-\u001f]/u.test(name);
}

/**
 * Lit et borne une demande venue de l'interface (données non fiables) ; `error` = première
 * valeur refusée, en français, pour l'afficher telle quelle.
 */
export function normalizeDirectRequest(input: unknown): { ok: true; request: DirectImageRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Demande vide.' };
  const raw = input as Record<string, unknown>;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt) return { ok: false, error: 'Écris une consigne : elle partira à Forge telle quelle.' };
  if (prompt.length > DIRECT_LIMITS.prompt) return { ok: false, error: `Consigne trop longue (${DIRECT_LIMITS.prompt} caractères au plus).` };
  const negative = typeof raw.negative === 'string' ? raw.negative.trim() : '';
  if (negative.length > DIRECT_LIMITS.negative) return { ok: false, error: `Prompt négatif trop long (${DIRECT_LIMITS.negative} caractères au plus).` };
  const project = typeof raw.project === 'string' && (IMAGE_PROJECTS as readonly string[]).includes(raw.project) ? (raw.project as ImageProject) : null;
  if (!project) return { ok: false, error: `Projet inconnu : ${IMAGE_PROJECTS.join(', ')} attendu.` };

  const request: DirectImageRequest = { prompt, negative, project };

  if (raw.checkpoint !== undefined && raw.checkpoint !== '') {
    if (typeof raw.checkpoint !== 'string' || !isSafeModelFileName(raw.checkpoint) || !/\.(safetensors|ckpt)$/iu.test(raw.checkpoint)) {
      return { ok: false, error: 'Modèle : nom de fichier .safetensors attendu, sans chemin.' };
    }
    request.checkpoint = raw.checkpoint;
  }
  if (raw.loras !== undefined) {
    if (!Array.isArray(raw.loras)) return { ok: false, error: 'LoRA : liste attendue.' };
    if (raw.loras.length > DIRECT_LIMITS.loras) return { ok: false, error: `LoRA : ${DIRECT_LIMITS.loras} au plus.` };
    const loras: DirectLora[] = [];
    for (const item of raw.loras as unknown[]) {
      const lora = item as Record<string, unknown> | null;
      const name = typeof lora?.name === 'string' ? lora.name.trim().replace(/\.safetensors$/iu, '') : '';
      if (!name || !isSafeModelFileName(name)) return { ok: false, error: 'LoRA : nom de fichier attendu, sans chemin.' };
      const weight = lora?.weight;
      if (weight !== undefined) {
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < DIRECT_LIMITS.loraWeight.min || weight > DIRECT_LIMITS.loraWeight.max) {
          return { ok: false, error: `LoRA « ${name} » : force entre ${DIRECT_LIMITS.loraWeight.min} et ${DIRECT_LIMITS.loraWeight.max}.` };
        }
        loras.push({ name, weight });
      } else loras.push({ name });
    }
    if (loras.length) request.loras = loras;
  }
  if (raw.format !== undefined && raw.format !== '') {
    if (typeof raw.format !== 'string' || !isImageFormat(raw.format)) return { ok: false, error: `Taille : ${IMAGE_FORMATS.join(', ')} attendu (tailles natives SDXL).` };
    request.format = raw.format;
  }
  const count = integer(raw.count, 1, MAX_IMAGES_PER_REQUEST);
  if (count === 'bad') return { ok: false, error: `Nombre d'images : 1 à ${MAX_IMAGES_PER_REQUEST}.` };
  if (count !== undefined) request.count = count;
  const seed = integer(raw.seed, -1, Number.MAX_SAFE_INTEGER);
  if (seed === 'bad') return { ok: false, error: 'Graine : nombre entier (ou -1 pour aléatoire).' };
  if (seed !== undefined && seed >= 0) request.seed = seed;
  const steps = integer(raw.steps, DIRECT_LIMITS.steps.min, DIRECT_LIMITS.steps.max);
  if (steps === 'bad') return { ok: false, error: `Étapes : ${DIRECT_LIMITS.steps.min} à ${DIRECT_LIMITS.steps.max}.` };
  if (steps !== undefined) request.steps = steps;
  if (raw.cfg !== undefined && raw.cfg !== '') {
    const cfg = Number(raw.cfg);
    if (!Number.isFinite(cfg) || cfg < DIRECT_LIMITS.cfg.min || cfg > DIRECT_LIMITS.cfg.max) return { ok: false, error: `CFG : ${DIRECT_LIMITS.cfg.min} à ${DIRECT_LIMITS.cfg.max}.` };
    request.cfg = Math.round(cfg * 10) / 10;
  }
  if (raw.sampler !== undefined && raw.sampler !== '') {
    if (typeof raw.sampler !== 'string' || !(DIRECT_SAMPLERS as readonly string[]).includes(raw.sampler)) return { ok: false, error: 'Échantillonneur inconnu.' };
    request.sampler = raw.sampler;
  }
  if (raw.scheduler !== undefined && raw.scheduler !== '') {
    if (typeof raw.scheduler !== 'string' || !(DIRECT_SCHEDULERS as readonly string[]).includes(raw.scheduler)) return { ok: false, error: 'Planificateur inconnu.' };
    request.scheduler = raw.scheduler;
  }
  if (raw.adetailer !== undefined) {
    const ad = raw.adetailer as Record<string, unknown> | null;
    request.adetailer = { faces: ad?.faces === true, hands: ad?.hands === true };
  }
  if (raw.keepTxt !== undefined) request.keepTxt = raw.keepTxt !== false;
  return { ok: true, request };
}

function integer(value: unknown, min: number, max: number): number | undefined | 'bad' {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return 'bad';
  return n;
}

/* ------------------------------------------------------------------ */
/* Défauts proposés par le panneau                                      */
/* ------------------------------------------------------------------ */

export interface DirectProjectDefaults {
  label: string;
  description: string;
  /** Négatif du projet + défauts d'anatomie d'Imager, modifiable dans le panneau. */
  negative: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  format: ImageFormat;
  formats: readonly ImageFormat[];
}

export function directProjectDefaults(preset: ImagePreset, anatomyNegative: readonly string[]): DirectProjectDefaults {
  const terms = new Set<string>();
  for (const part of [...preset.negative.split(','), ...anatomyNegative]) {
    const term = part.trim();
    if (term) terms.add(term);
  }
  return {
    label: preset.label,
    description: preset.description,
    negative: [...terms].join(', '),
    steps: preset.steps,
    cfg: preset.cfg,
    sampler: (DIRECT_SAMPLERS as readonly string[]).includes(preset.sampler) ? preset.sampler : DIRECT_SAMPLERS[0],
    scheduler: (DIRECT_SCHEDULERS as readonly string[]).includes(preset.scheduler) ? preset.scheduler : DIRECT_SCHEDULERS[0],
    format: preset.defaultFormat,
    formats: preset.formats,
  };
}

/* ------------------------------------------------------------------ */
/* Requête Forge                                                        */
/* ------------------------------------------------------------------ */

export interface DirectPayloadOptions {
  /** Nom du fichier VAE ; absent = réglage courant de Forge. */
  vae?: string;
  /** Scripts intégrés de Forge, toujours explicites (`forgeBuiltinScriptArgs`). */
  builtinScripts?: Record<string, { args: unknown[] }>;
  /** Arguments ADetailer déjà construits (`adetailerArgs`) ; absents = pas de retouche. */
  adetailerArgs?: unknown[];
}

function loraTags(loras: readonly DirectLora[] | undefined): string {
  return (loras ?? [])
    .map((lora) => `<lora:${lora.name}:${Number.isFinite(lora.weight ?? NaN) ? lora.weight : DEFAULT_LORA_WEIGHT}>`)
    .join(' ');
}

/** La consigne telle quelle (plus les LoRA choisis), le négatif tel quel, une taille native SDXL. */
export function buildDirectPayload(request: DirectImageRequest, options: DirectPayloadOptions = {}): Txt2ImgPayload {
  const format: ImageFormat = request.format ?? 'carre';
  const size = FORMAT_SIZES[format];
  const tags = loraTags(request.loras);
  const overrides: Record<string, unknown> = {};
  if (request.checkpoint) overrides.sd_model_checkpoint = request.checkpoint;
  if (options.vae) overrides.sd_vae = options.vae;
  const alwayson: Record<string, { args: unknown[] }> = { ...(options.builtinScripts ?? {}) };
  if (options.adetailerArgs) alwayson.ADetailer = { args: options.adetailerArgs };
  return {
    prompt: tags ? `${request.prompt.trim()} ${tags}` : request.prompt.trim(),
    negative_prompt: request.negative.trim(),
    width: size.width,
    height: size.height,
    steps: request.steps ?? DIRECT_LIMITS.steps.default,
    cfg_scale: request.cfg ?? DIRECT_LIMITS.cfg.default,
    sampler_name: request.sampler ?? DIRECT_SAMPLERS[0],
    scheduler: request.scheduler ?? 'Karras',
    seed: Number.isInteger(request.seed) && (request.seed as number) >= 0 ? (request.seed as number) : -1,
    batch_size: Math.min(MAX_IMAGES_PER_REQUEST, Math.max(1, request.count ?? 1)),
    n_iter: 1,
    send_images: true,
    save_images: false,
    override_settings: overrides,
    override_settings_restore_afterwards: false,
    ...(Object.keys(alwayson).length ? { alwayson_scripts: alwayson } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Historique : les tours directs ne vont jamais au modèle              */
/* ------------------------------------------------------------------ */

/** Les messages d'un tour `/image` (demande et réponse) sont marqués `direct: 'image'`. */
export function isDirectImageMessage(message: ChatMessage): boolean {
  return message.direct === 'image';
}

/** Copie de l'historique pour le modèle de langage : sans les tours `/image`. */
export function stripDirectTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => !isDirectImageMessage(message));
}

/* ------------------------------------------------------------------ */
/* Repérage par règles (étape 2 ter) : avant tout envoi au modèle      */
/* ------------------------------------------------------------------ */

/** Débuts de demande qui envoient à Imager directement, modifiables dans `imager_rules.yaml` (`direct.declencheurs`). */
export const DEFAULT_DIRECT_TRIGGERS: readonly string[] = [
  'imager',
  'genere une image',
  'genere moi une image',
  'genere une illustration',
  'genere moi une illustration',
  'genere un sticker',
  'genere moi un sticker',
  'genere un logo',
  'genere moi un logo',
  'genere une photo',
  'genere moi une photo',
  'dessine moi',
  'dessine',
  'fais moi une image',
  'fais une image',
  'fais moi un sticker',
  'fais moi un logo',
  'fais moi un dessin',
  'cree une image',
  'cree moi une image',
  'cree un sticker',
  'cree un logo',
  'une image de',
  'une illustration de',
  'un dessin de',
  'un sticker de',
  // Brouillon de Cursor (10 novembre) : « génère-moi » entendu « generement » par Whisper, « peins-moi », « imagine une image ».
  'generement une image',
  'peins moi',
  'imagine une image',
];

export interface DirectRules {
  /** Imager complète la demande avec ses règles (traduction, qualité, style, négatif) : « Améliorer mon prompt ». */
  ameliorer: boolean;
  /** Débuts de phrase qui envoient la demande à Imager sans passer par le modèle de langage. */
  declencheurs: readonly string[];
}

export const DEFAULT_DIRECT_RULES: DirectRules = { ameliorer: true, declencheurs: DEFAULT_DIRECT_TRIGGERS };

/** Minuscules, sans accents, apostrophes et tirets en espaces, ponctuation retirée, espaces réduits. */
export function normalizeForTriggers(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`\-]/g, ' ')
    .replace(/[.,;:!?«»"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Début de phrase retiré avant le repérage : « jarvis », « ok jarvis », « s'il te plaît », « peux-tu »… */
const LEADING_FILLER =
  /^(?:(?:ok|bon|eh|dis|dis moi|hey|allo|alors|jarvis|s il te plait|stp|est ce que tu peux|peux tu|pourrais tu|tu peux|je veux|je voudrais|j aimerais|il me faut)\s+)+/u;

/** Même chose sur le texte d'origine (accents et ponctuation gardés dans le reste). */
const LEADING_FILLER_RAW =
  /^(?:ok|bon|eh|dis|dis[- ]moi|hey|all[oô]|alors|jarvis|s[’']il te pla[îi]t|stp|est[- ]ce que tu peux|peux[- ]tu|pourrais[- ]tu|tu peux|je veux|je voudrais|j[’']aimerais|il me faut)\s*[,:!]?\s+/iu;

export interface DirectImageDetection {
  /** La demande, sans « Jarvis, », « peux-tu »… ni le mot « Imager » en tête ; le reste mot pour mot. */
  prompt: string;
  trigger: string;
}

/**
 * Vrai si la demande commence par un déclencheur (après « Jarvis, », « peux-tu »…). Règles seules,
 * aucun modèle. « Imager, … » retire le mot ; les autres déclencheurs restent dans la demande
 * (ils décrivent l'image : « une image de renard » reste « une image de renard »).
 */
export function detectDirectImageRequest(text: string, triggers: readonly string[] = DEFAULT_DIRECT_TRIGGERS): DirectImageDetection | null {
  const normalized = normalizeForTriggers(text).replace(LEADING_FILLER, '');
  if (!normalized) return null;
  for (const trigger of triggers) {
    const key = normalizeForTriggers(trigger);
    if (!key) continue;
    if (normalized === key || normalized.startsWith(`${key} `)) {
      const stripped = stripLeadingFiller(text);
      if (key === 'imager') {
        const prompt = stripped.replace(/^imager\s*[,:\-–—]?\s*/iu, '').trim();
        return { prompt: prompt || stripped, trigger: key };
      }
      return { prompt: stripped, trigger: key };
    }
  }
  return null;
}

function stripLeadingFiller(text: string): string {
  let rest = text.trim();
  for (let guard = 0; guard < 6; guard += 1) {
    const next = rest.replace(LEADING_FILLER_RAW, '');
    if (next === rest) break;
    rest = next;
  }
  return rest;
}

/* ------------------------------------------------------------------ */
/* Déductions par mots (projet, type, nombre de personnes)             */
/* ------------------------------------------------------------------ */

/** « pour Driver's Ink » → drivers-ink ; « pour VX », « miniature », « short » → vx ; « pour Jarvis » → jarvis ; sinon perso. */
export function guessProject(text: string): ImageProject {
  const t = normalizeForTriggers(text);
  // « Driver's Ink » : l'apostrophe est devenue un espace (« driver s ink »).
  if (/\bdrivers? ?s? ?ink\b/.test(t)) return 'drivers-ink';
  if (/\bvx\b|\bminiatures?\b|\byoutube\b|\bshorts?\b|\btiktok\b|\bvignettes?\b/.test(t)) return 'vx';
  if (/\b(?:pour|projet|dossier)\s+(?:le\s+|la\s+)?(?:projet\s+)?jarvis\b/.test(t)) return 'jarvis';
  return 'perso';
}

const PERSON_WORDS =
  /\b(?:personne|personnes|portrait|portraits|visage|visages|femme|femmes|homme|hommes|fille|filles|garcon|garcons|enfant|enfants|bebe|humain|humains|gens|personnage|personnages|heroine|heros|guerrier|guerriere|princesse|prince|roi|reine|sorciere|sorcier|elfe|ninja|samourai|pirate|chevalier|soldat|policier|medecin|infirmiere|mannequin|selfie|bikini|lingerie|maillot|robe|jupe|costume|uniforme|cheveux|yeux|sourire|sourit|souriant|souriante|couple|amis|amies|famille|foule|mon visage|mon portrait|1girl|1boy|girl|boy|woman|man|lady|guy|person|people|character|cosplay|waifu|idol)\b/u;
const SCENE_WORDS = /\b(?:scene|groupe|equipe|reunion|fete|mariage|concert|match|bataille|combat|foule|famille|couple)\b/u;
const LANDSCAPE_WORDS =
  /\b(?:paysage|paysages|montagne|montagnes|foret|forets|plage|plages|mer|ocean|lac|riviere|cascade|desert|vallee|colline|prairie|champ|champs|ciel|coucher de soleil|lever de soleil|aurore|nuit etoilee|ville|village|rue|skyline|panorama|horizon|jardin|parc|volcan|glacier|canyon|ile|iles|campagne|nature)\b/u;
const STICKER_WORDS = /\b(?:sticker|stickers|autocollant|autocollants|logo|logos|icone|icones|embleme|blason|badge|pictogramme|vinyle)\b/u;
const OBJECT_WORDS =
  /\b(?:objet|voiture|voitures|moto|motos|velo|camion|bateau|avion|montre|bague|bijou|bouteille|verre|tasse|chaise|table|lampe|telephone|ordinateur|robot|vaisseau|epee|arme|casque|chaussure|chaussures|sac|fleur|fleurs|fruit|fruits|gateau|plat|nourriture|animal|chat|chien|renard|loup|lion|tigre|cheval|oiseau|dragon|poisson|papillon)\b/u;

/** Type du sujet deviné par mots (pas de modèle) : personne, scène, paysage, logo-sticker, objet, sinon autre. */
export function guessSubjectType(text: string): ImageSubjectType {
  const t = normalizeForTriggers(text);
  const persons = PERSON_WORDS.test(t);
  if (STICKER_WORDS.test(t) && !persons) return 'logo-sticker';
  if (persons && (SCENE_WORDS.test(t) || guessPersonCount(text) > 1)) return 'scene';
  if (persons) return 'personne';
  if (LANDSCAPE_WORDS.test(t)) return 'paysage';
  if (OBJECT_WORDS.test(t)) return 'objet';
  return 'autre';
}

const COUNT_WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };

/** « deux femmes », « 3 amis », « un couple » → nombre de personnes ; 0 si rien n'est dit. */
export function guessPersonCount(text: string): number {
  const t = normalizeForTriggers(text);
  const match =
    /\b(un|une|deux|trois|quatre|cinq|six|[1-6])\s+(?:jeunes?\s+|petits?\s+|petites?\s+|grands?\s+|grandes?\s+|belles?\s+|beaux?\s+|jolies?\s+|vieux\s+|vieilles?\s+)?(?:personnes?|femmes?|hommes?|filles?|garcons?|enfants?|amis?|amies?|personnages?|guerriers?|soldats?|ninjas?|pirates?|chevaliers?|gens|heros|heroines?|people|women|men|girls?|boys?|characters?)\b/u.exec(
      t,
    );
  if (match) return COUNT_WORDS[match[1]!] ?? 0;
  if (/\bcouple\b/u.test(t)) return 2;
  if (/\btrio\b/u.test(t)) return 3;
  return 0;
}
