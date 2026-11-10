import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  BRAIN_KEEP_ALIVE,
  DEFAULT_IMAGES_ROOT_WINDOWS,
  DEFAULT_PRESETS,
  DIRECT_SAMPLERS,
  DIRECT_SCHEDULERS,
  FORMAT_SIZES,
  IMAGE_FORMATS,
  IMAGE_PROJECTS,
  buildDirectPayload,
  directProjectDefaults,
  guessPersonCount,
  guessSubjectType,
  isSafeModelFileName,
  toEnglishIfNeeded,
  MAX_ATTACHMENT_BYTES,
  activeOrchestra,
  adetailerArgs,
  applyImagerRules,
  applyPresetOverrides,
  buildImagerPrompt,
  buildImg2ImgPayload,
  buildTxt2ImgPayload,
  chooseCheckpoint,
  clampCount,
  closestFormatForAspect,
  defaultImagerRulesYaml,
  defaultPresetsYaml,
  denoisingForFidelity,
  forgeBuiltinScriptArgs,
  imageAttachmentExtension,
  imageFileNames,
  isImageAttachmentPath,
  parsePresetsYaml,
  parseTxt2ImgInfo,
  referenceFileName,
  resolveSubjectType,
  resolveRenderStyle,
  defaultFormatFor,
  sidecarText,
  wantsAdetailer,
  type ChatAttachment,
  type CheckpointProfile,
  type DirectImageRequest,
  type DirectProjectDefaults,
  type ImageFormat,
  type Txt2ImgPayload,
  type Txt2ImgResponse,
  type ImagePreset,
  type ImageProject,
  type ImageRequest,
  type ImagerRules,
  type ImageSubjectType,
  type ImageRenderStyle,
  type PayloadOptions,
  type Settings,
} from '@jarvis/core';
import { imageDimensions } from './imageInfo.js';
import { PromptRefiner, type RefineOutcome } from './PromptRefiner.js';
import { ForgeClient, ForgeError, checkForgeUrl, DEFAULT_FORGE_URL } from './ForgeClient.js';
import { ForgeProcess, type ForgeProcessDeps } from './ForgeProcess.js';
import { OllamaControl } from './OllamaControl.js';
import { PngError, toBlackAndWhitePng } from './png.js';

export const DEFAULT_FORGE_DIR_WINDOWS = 'C:\\dev\\Forge';
export const PRESETS_FILE_NAME = 'images_presets.yaml';
export const RULES_FILE_NAME = 'imager_rules.yaml';
export const SDXL_CHECKPOINT_FILE = 'sd_xl_base_1.0.safetensors';
export const SDXL_VAE_FILE = 'sdxl_vae_fp16_fix.safetensors';
export const IMAGES_INTRO_MESSAGE = 'Jarvis Imager prend la main : je décharge le modèle de langage, je reviens dans une minute ou deux…';

export interface ImagesSettings {
  enabled: boolean;
  forgeDir: string;
  forgeUrl: string;
  outputRoot: string;
  keepForgeRunning: boolean;
  /** Ouvrir l'image dans la visionneuse dès qu'elle est faite (défaut : oui). */
  openAfterGeneration: boolean;
  /** Réécrire la demande en consigne SDXL par le modèle de langage avant de le décharger (défaut : oui). */
  refinePrompts: boolean;
  /** Mode direct : garder Forge chargé tant que le panneau « Imager direct » est ouvert (défaut : non). */
  directHoldForge: boolean;
  /** Mode direct : pas de fichier .txt pour le projet perso (défaut : le .txt est écrit). */
  directNoTxtPerso: boolean;
}

/** Ce que le panneau « Imager direct » affiche : modèles et LoRA sur le disque, défauts par projet, options. */
export interface DirectCatalog {
  enabled: boolean;
  forgeDir: string;
  outputRoot: string;
  checkpoints: { file: string; label: string }[];
  loras: string[];
  samplers: readonly string[];
  schedulers: readonly string[];
  formats: { id: ImageFormat; width: number; height: number }[];
  projects: Record<ImageProject, DirectProjectDefaults>;
  adetailerInstalled: boolean;
  /** « Améliorer mon prompt » par défaut (`direct.ameliorer` des règles). */
  improve: boolean;
  holdForge: boolean;
  keepTxtPerso: boolean;
  busy: boolean;
}

export interface DirectContext {
  onProgress?: (message: string) => void;
  /** Avancement de Forge (0 à 1) et temps restant estimé, une fois par seconde pendant la génération. */
  onProgressValue?: (value: number, etaSeconds: number) => void;
  signal?: AbortSignal;
}

export interface DirectFile {
  png: string;
  txt?: string;
  seed: number;
  /** `data:image/png;base64,…` pour l'aperçu du panneau. */
  preview: string;
}

export interface DirectResult {
  project: ImageProject;
  folder: string;
  files: DirectFile[];
  width: number;
  height: number;
  durationMs: number;
  warnings: string[];
  /** Consigne et négatif réellement envoyés à Forge. */
  finalPrompt: string;
  finalNegative: string;
  /** Vrai si Imager a complété la demande avec ses règles (sinon : envoyée telle quelle). */
  improved: boolean;
  translatedBy?: string;
  checkpoint: { id: string; label: string } | null;
  subjectType: ImageSubjectType;
  adetailer: boolean;
  /** Forge gardé chargé (panneau ouvert + option) : le modèle de langage reviendra à la fermeture du panneau. */
  forgeHeld: boolean;
  brainReloaded: string | null;
}

/** Demande directe complète : la demande validée, plus ce que le chemin direct sait en plus. */
export interface DirectGenerateInput extends DirectImageRequest {
  /** Imager complète la demande (règles seules) ; absent = `direct.ameliorer` des règles. */
  improve?: boolean;
  /** Avec `improve` : type et nombre de personnes connus (sinon devinés par mots). */
  subjectType?: string;
  personCount?: number;
  render?: string;
}

export interface ImagesStatus {
  enabled: boolean;
  forgeDir: string;
  forgeUrl: string;
  outputRoot: string;
  presetsPath: string;
  /** `lancer_forge.bat` présent. */
  launcherFound: boolean;
  /** Le modèle SDXL est dans `models/Stable-diffusion`. */
  checkpointFound: boolean;
  vaeFound: boolean;
  /** L'API de Forge répond en ce moment. */
  forgeRunning: boolean;
  /** LoRA disponibles (seulement si Forge répond). */
  loras: string[];
  /** Jarvis Imager : modèles connus des règles et présents sur le disque, et celui qui sera utilisé. */
  checkpoints: { id: string; label: string; file: string }[];
  activeCheckpoint: string | null;
  /** Extension ADetailer installée dans Forge (dossier `extensions/adetailer`). */
  adetailerInstalled: boolean;
  rulesPath: string;
  error?: string;
}

export interface GeneratedFile {
  png: string;
  txt: string;
  blackAndWhite?: string;
  /** Copie de la photo de départ, à côté de l'image. */
  source?: string;
  /** Version agrandie (`-grand.png`), si demandée. */
  upscaled?: string;
  seed: number;
}

export interface ImagesResult {
  project: ImageProject;
  folder: string;
  files: GeneratedFile[];
  width: number;
  height: number;
  durationMs: number;
  /** Forge lancé par Jarvis pour cette image (et arrêté après, sauf réglage contraire). */
  forgeStartedByJarvis: boolean;
  /** Modèle Ollama rechargé après l'image (ou `null` si rien n'était à recharger). */
  brainReloaded: string | null;
  warnings: string[];
  /** Consigne réellement envoyée à Stable Diffusion, et si elle vient de la reformulation. */
  finalPrompt: string;
  refined: { used: boolean; model: string; reason?: string } | null;
  /** Jarvis Imager : modèle utilisé, type du sujet, retouches visages/mains, agrandissement. */
  checkpoint: { id: string; label: string } | null;
  subjectType: ImageSubjectType;
  /** Rendu voulu (`auto`, `realiste`, `anime`) et si le modèle choisi sait le faire. */
  render: ImageRenderStyle;
  renderHonored: boolean;
  adetailer: boolean;
  upscaled: { factor: number; upscaler: string } | null;
}

export interface ImagesServiceDeps {
  getSettings: () => Settings;
  fetchImpl?: typeof fetch;
  ollamaUrl?: string;
  now?: () => Date;
  log?: (line: string) => void;
  processDeps?: ForgeProcessDeps;
  /** Attente avant le second essai après un 500 de Forge (tests : 0). */
  forgeRetryDelayMs?: number;
}

/**
 * Le module images : réglages par projet, Forge (lancé au besoin), déchargement puis
 * rechargement du modèle de langage, rangement des fichiers. Un seul travail à la fois.
 */
export class ImagesService {
  private processes = new Map<string, ForgeProcess>();
  private busy: Promise<unknown> | null = null;
  /** Panneau « Imager direct » ouvert dans la fenêtre. */
  private directPanelOpen = false;
  /** Forge gardé chargé après une image directe (panneau ouvert + option), à libérer à la fermeture. */
  private held: {
    forge: ForgeProcess;
    client: ForgeClient;
    how: 'already' | 'started';
    images: ImagesSettings;
    ollama: OllamaControl;
    settings: Settings;
    loadedBefore: { name: string }[];
  } | null = null;
  /** Adresses de Forge dont l'ouverture du navigateur au démarrage a déjà été coupée. */
  private browserLaunchDisabled = new Set<string>();

  constructor(private readonly deps: ImagesServiceDeps) {}

  settings(): ImagesSettings {
    const raw = this.deps.getSettings().images;
    const url = checkForgeUrl(raw?.forgeUrl ?? '');
    return {
      enabled: raw?.enabled === true,
      forgeDir: raw?.forgeDir?.trim() || DEFAULT_FORGE_DIR_WINDOWS,
      forgeUrl: url.ok ? url.url : DEFAULT_FORGE_URL,
      outputRoot: raw?.outputRoot?.trim() || DEFAULT_IMAGES_ROOT_WINDOWS,
      keepForgeRunning: raw?.keepForgeRunning === true,
      openAfterGeneration: raw?.openAfterGeneration !== false,
      refinePrompts: raw?.refinePrompts !== false,
      directHoldForge: raw?.directHoldForge === true,
      directNoTxtPerso: raw?.directNoTxtPerso === true,
    };
  }

  /** Vrai si `path` est un fichier du dossier des images (seul endroit que l'interface peut demander d'ouvrir). */
  isInsideOutputRoot(path: string): boolean {
    const root = resolve(this.settings().outputRoot).toLowerCase();
    const target = resolve(path).toLowerCase();
    return target.startsWith(`${root}\\`) || target.startsWith(`${root}/`);
  }

  /**
   * Enregistre une photo jointe à la discussion dans `_references/AAAA-MM-JJ/` et rend la
   * pièce jointe à écrire dans le message. La photo n'est jamais envoyée au modèle.
   */
  async saveReference(input: { name: string; mime: string; data: Buffer }): Promise<ChatAttachment> {
    const extension = imageAttachmentExtension(input.name, input.mime);
    if (!extension) throw new ForgeError('http', `« ${input.name} » n’est pas une image acceptée (PNG, JPEG ou WebP).`);
    if (input.data.length > MAX_ATTACHMENT_BYTES) throw new ForgeError('http', `« ${input.name} » dépasse 20 Mo.`);
    if (!imageDimensions(input.data)) throw new ForgeError('http', `« ${input.name} » n’est pas lisible comme une image.`);
    const now = this.deps.now?.() ?? new Date();
    const names = referenceFileName(input.name, extension, now);
    const folder = join(this.settings().outputRoot, ...names.folder.split('/'));
    await mkdir(folder, { recursive: true });
    let path = join(folder, names.file);
    let suffix = 1;
    while (existsSync(path)) {
      suffix += 1;
      path = join(folder, names.file.replace(/(\.[a-z0-9]+)$/i, `-${suffix}$1`));
    }
    await writeFile(path, input.data);
    return { name: input.name, path, mime: input.mime, kind: 'image' };
  }

  /** Lit et contrôle la photo de départ ; renvoie ses octets, sa taille et son extension. */
  private async readInitImage(path: string): Promise<{ data: Buffer; width: number; height: number; extension: string }> {
    const clean = path.trim().replace(/^["']|["']$/g, '');
    if (!clean || !isImageAttachmentPath(clean)) {
      throw new ForgeError('http', `La photo de départ doit être un fichier PNG, JPEG ou WebP (reçu : « ${clean || 'vide'} »).`);
    }
    let size: number;
    try {
      size = (await stat(clean)).size;
    } catch {
      throw new ForgeError('http', `Photo de départ introuvable : ${clean}`);
    }
    if (size > MAX_ATTACHMENT_BYTES) throw new ForgeError('http', 'La photo de départ dépasse 20 Mo.');
    const data = await readFile(clean);
    const dimensions = imageDimensions(data);
    if (!dimensions) throw new ForgeError('http', `La photo de départ n’est pas lisible comme une image : ${clean}`);
    return { data, ...dimensions, extension: extname(clean).toLowerCase() };
  }

  isEnabled(): boolean {
    return this.settings().enabled;
  }

  presetsPath(): string {
    return join(this.settings().outputRoot, PRESETS_FILE_NAME);
  }

  rulesPath(): string {
    return join(this.settings().outputRoot, RULES_FILE_NAME);
  }

  /** Lit les règles de Jarvis Imager (créées avec les défauts si le fichier manque). */
  async loadRules(): Promise<{ rules: ImagerRules; warnings: string[] }> {
    const path = this.rulesPath();
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      await mkdir(this.settings().outputRoot, { recursive: true });
      text = defaultImagerRulesYaml();
      await writeFile(path, text, 'utf8');
      return applyImagerRules({});
    }
    const parsed = parsePresetsYaml(text);
    const applied = applyImagerRules(parsed.values);
    return { rules: applied.rules, warnings: [...parsed.errors, ...applied.warnings] };
  }

  private checkpointPath(forgeDir: string, file: string): string {
    return join(forgeDir, 'models', 'Stable-diffusion', file);
  }

  private adetailerInstalled(forgeDir: string): boolean {
    return existsSync(join(forgeDir, 'extensions', 'adetailer', 'scripts'));
  }

  /** Lit le fichier de réglages (créé avec les défauts s'il manque). */
  async loadPresets(): Promise<{ presets: Record<ImageProject, ImagePreset>; warnings: string[] }> {
    const path = this.presetsPath();
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      await mkdir(this.settings().outputRoot, { recursive: true });
      text = defaultPresetsYaml();
      await writeFile(path, text, 'utf8');
      return { presets: { ...DEFAULT_PRESETS }, warnings: [] };
    }
    const parsed = parsePresetsYaml(text);
    const applied = applyPresetOverrides(parsed.values);
    return { presets: applied.presets, warnings: [...parsed.errors, ...applied.warnings] };
  }

  async status(draft?: { forgeDir?: string; forgeUrl?: string; outputRoot?: string }): Promise<ImagesStatus> {
    const base = this.settings();
    const urlCheck = checkForgeUrl(draft?.forgeUrl ?? base.forgeUrl);
    const forgeDir = draft?.forgeDir?.trim() || base.forgeDir;
    const outputRoot = draft?.outputRoot?.trim() || base.outputRoot;
    const forgeUrl = urlCheck.ok ? urlCheck.url : base.forgeUrl;
    const client = new ForgeClient(forgeUrl, this.deps.fetchImpl);
    const forgeRunning = await client.ping();
    let loras: string[] = [];
    if (forgeRunning) {
      try {
        loras = (await client.loras()).map((lora) => lora.name);
      } catch {
        loras = [];
      }
    }
    const { rules } = await this.loadRules().catch(() => applyImagerRules({}));
    const checkpoints = Object.entries(rules.checkpoints)
      .filter(([, profile]) => existsSync(this.checkpointPath(forgeDir, profile.fichier)))
      .map(([id, profile]) => ({ id, label: profile.label, file: profile.fichier }));
    const active = chooseCheckpoint(rules, (file) => existsSync(this.checkpointPath(forgeDir, file)));
    return {
      enabled: base.enabled,
      forgeDir,
      forgeUrl,
      outputRoot,
      presetsPath: join(outputRoot, PRESETS_FILE_NAME),
      rulesPath: join(outputRoot, RULES_FILE_NAME),
      launcherFound: existsSync(join(forgeDir, 'lancer_forge.bat')),
      checkpointFound: checkpoints.length > 0,
      vaeFound: existsSync(join(forgeDir, 'models', 'VAE', SDXL_VAE_FILE)),
      forgeRunning,
      loras,
      checkpoints,
      activeCheckpoint: active?.profile.label ?? null,
      adetailerInstalled: this.adetailerInstalled(forgeDir),
      ...(urlCheck.ok ? {} : { error: urlCheck.reason }),
    };
  }

  /**
   * Génère une ou plusieurs images. Ordre imposé : prévenir → décharger Ollama → Forge prêt →
   * générer → enregistrer → libérer Forge → **recharger le modèle de langage, même en cas d'erreur**.
   */
  async generate(request: ImageRequest, context: { onProgress?: (message: string) => void; signal?: AbortSignal } = {}): Promise<ImagesResult> {
    if (this.busy) throw new ForgeError('http', 'Une image est déjà en cours de génération : attends qu’elle finisse.');
    const work = this.generateNow(request, context);
    this.busy = work.catch(() => undefined);
    try {
      return await work;
    } finally {
      this.busy = null;
    }
  }

  private async generateNow(request: ImageRequest, context: { onProgress?: (message: string) => void; signal?: AbortSignal }): Promise<ImagesResult> {
    const settings = this.deps.getSettings();
    const images = this.settings();
    if (!images.enabled) throw new ForgeError('http', 'Le module images est coupé : active-le dans Réglages → Images.');
    const started = Date.now();
    const warnings: string[] = [];
    const { presets, warnings: presetWarnings } = await this.loadPresets();
    warnings.push(...presetWarnings);
    const { rules, warnings: ruleWarnings } = await this.loadRules();
    warnings.push(...ruleWarnings);
    const preset = presets[request.project];
    const count = clampCount(request.count);
    const subjectType = resolveSubjectType(request.subjectType);
    // Rendu : choix du 7B, sinon les mots de la demande (« anime », « manga », « Naruto »… ; « photo », « réaliste »).
    const render = resolveRenderStyle(request.render, request.prompt, request.style);
    // Modèle : réglage explicite, sinon l'ordre du rendu (anime → Animagine), sinon l'ordre général.
    const chosen = chooseCheckpoint(rules, (file) => existsSync(this.checkpointPath(images.forgeDir, file)), render);
    const checkpoint: CheckpointProfile | undefined = chosen?.profile;
    const renderHonored = render === 'auto' || (checkpoint?.rendu ?? 'realiste') === render;
    if (!renderHonored && render === 'anime') {
      const animeFiles = Object.values(rules.checkpoints)
        .filter((profile) => profile.rendu === 'anime')
        .map((profile) => profile.fichier);
      warnings.push(
        `Rendu anime demandé mais aucun modèle anime n’est dans ${join(images.forgeDir, 'models', 'Stable-diffusion')} (${animeFiles.join(', ') || 'aucun profil'}) : image faite avec ${checkpoint?.label ?? 'le modèle courant de Forge'}, rendu réaliste probable.`,
      );
    }
    const vaePath = join(images.forgeDir, 'models', 'VAE', SDXL_VAE_FILE);
    const vae = checkpoint?.vae?.trim() || (existsSync(vaePath) ? SDXL_VAE_FILE : '');
    const payloadOptions: PayloadOptions = {
      ...(checkpoint ? { checkpoint: checkpoint.fichier } : {}),
      ...(vae ? { vae } : {}),
      ...(checkpoint ? { sampling: { sampler: checkpoint.sampler, scheduler: checkpoint.scheduler, steps: checkpoint.steps, cfg: checkpoint.cfg } } : {}),
    };
    // Photo de départ : lue et contrôlée avant de toucher à Ollama ou à Forge.
    const init = request.initImage ? await this.readInitImage(request.initImage.path) : null;
    // Format : celui demandé, sinon celui de la photo de départ, sinon celui du type (personne → portrait, scène → paysage) s'il convient au projet.
    const format = request.format ?? (init ? closestFormatForAspect(init.width, init.height) : defaultFormatFor(rules, subjectType, preset));
    const ollamaUrl = this.deps.ollamaUrl ?? (settings.baseUrl?.trim() || 'http://127.0.0.1:11434');
    const ollama = new OllamaControl(ollamaUrl, this.deps.fetchImpl);

    // Reformulation en consigne SDXL par le modèle de langage, tant qu'il est encore chargé.
    let refined: RefineOutcome | null = null;
    if (images.refinePrompts) {
      const loaded = await ollama.loaded();
      const model = pickBrainModel(settings, loaded.map((entry) => entry.name));
      if (model) {
        context.onProgress?.('Je traduis ta demande en consigne pour Stable Diffusion…');
        refined = await new PromptRefiner(ollamaUrl, this.deps.fetchImpl).refine(
          {
            prompt: request.prompt,
            project: request.project,
            preset,
            ...(request.style ? { style: request.style } : {}),
            ...(request.negative ? { negative: request.negative } : {}),
            ...(init ? { fromPhoto: true } : {}),
            ...(render !== 'auto' && renderHonored ? { render } : {}),
          },
          model,
          context.signal,
        );
        if (!refined.used && refined.reason) this.deps.log?.(`[images] consigne d'origine gardée : ${refined.reason}`);
      }
    }
    // Jarvis Imager assemble la consigne finale : règle du projet, sujet (reformulé ou tel quel),
    // nombre de personnes, mots du type, qualité ; négatif du projet, du type, de l'anatomie, du modèle.
    const assembled = buildImagerPrompt(
      {
        subject: refined?.used ? refined.prompt : request.prompt,
        type: subjectType,
        ...(request.personCount ? { personCount: request.personCount } : {}),
        project: request.project,
        preset,
        ...(request.style && !refined?.used ? { style: request.style } : {}),
        ...(render !== 'auto' ? { render } : {}),
        extraNegative: [request.negative, refined?.used ? refined.negative : undefined].filter((item): item is string => Boolean(item)),
        ...(checkpoint ? { checkpoint } : {}),
        ...(request.lora ? { lora: request.lora } : {}),
      },
      rules,
    );
    const baseRequest: ImageRequest = { ...request, count, ...(format ? { format } : {}) };
    const denoising = init ? denoisingForFidelity(request.initImage?.fidelity) : null;
    const useAdetailer = wantsAdetailer(rules, subjectType, this.adetailerInstalled(images.forgeDir));
    // Les scripts intégrés de Forge reçoivent toujours leurs arguments explicitement (voir forgeBuiltinScriptArgs).
    const finalOptions: PayloadOptions = {
      ...payloadOptions,
      finalPrompt: assembled.prompt,
      finalNegative: assembled.negative,
      alwaysonScripts: {
        ...forgeBuiltinScriptArgs(),
        ...(useAdetailer ? { ADetailer: { args: adetailerArgs({ hands: rules.types[subjectType].adetailerMains, anime: checkpoint?.rendu === 'anime' }) } } : {}),
      },
    };
    const payload = init
      ? buildImg2ImgPayload(baseRequest, preset, finalOptions, init.data.toString('base64'), denoising!)
      : buildTxt2ImgPayload(baseRequest, preset, finalOptions);

    context.onProgress?.(init ? 'Jarvis Imager part de ta photo : je décharge le modèle de langage, je reviens dans une minute ou deux…' : IMAGES_INTRO_MESSAGE);
    const unloaded = await ollama.unloadAll();
    const loadedBefore = unloaded.map((name) => ({ name }));
    if (unloaded.length) this.deps.log?.(`[images] modèles Ollama déchargés : ${unloaded.join(', ')}`);

    const client = new ForgeClient(images.forgeUrl, this.deps.fetchImpl);
    const forge = this.processFor(images.forgeDir, client);
    let how: 'already' | 'started' | null = null;
    let brainReloaded: string | null = null;
    try {
      how = await forge.ensureRunning(context.onProgress, context.signal);
      if (how === 'started') await this.disableBrowserLaunch(client, images.forgeUrl);
      context.onProgress?.(count > 1 ? `Forge est prêt, je fabrique ${count} images…` : 'Forge est prêt, je fabrique l’image…');
      if (useAdetailer) {
        // L'extension est sur le disque ; elle doit aussi être chargée par ce Forge.
        const scripts = await client.scripts().catch(() => [] as string[]);
        if (!scripts.includes('adetailer')) {
          warnings.push('ADetailer est installé mais ce Forge ne l’a pas chargé : image sans retouche des visages et des mains.');
          delete payload.alwayson_scripts?.ADetailer;
        }
      }
      const adetailerApplied = Boolean(payload.alwayson_scripts?.ADetailer);
      const generateOnce = () =>
        init ? client.img2img(payload as ReturnType<typeof buildImg2ImgPayload>, context.signal) : client.txt2img(payload, context.signal);
      let response: Awaited<ReturnType<typeof generateOnce>>;
      try {
        response = await generateOnce();
      } catch (error) {
        // Juste après son démarrage (changement de modèle en cours), Forge répond parfois 500 à la
        // première requête : un seul nouvel essai après une courte attente, puis l'erreur telle quelle.
        // De même quand la connexion tombe en cours de route (« fetch failed ») alors que Forge
        // répond toujours : observé sur une image lourde (1216×832, deux personnes, retouches),
        // erreur interne de placement de tenseurs côté Forge, la requête suivante passe.
        const transient =
          error instanceof ForgeError &&
          !context.signal?.aborted &&
          ((error.kind === 'http' && /\b500\b/.test(error.message)) || (error.kind === 'unreachable' && (await client.ping(5_000))));
        if (transient) {
          const delay = this.deps.forgeRetryDelayMs ?? 8_000;
          this.deps.log?.(`[images] Forge a échoué (${(error as ForgeError).message}) : nouvel essai dans ${Math.round(delay / 1000)} s`);
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          response = await generateOnce();
          warnings.push(`Forge a échoué à la première requête (${(error as ForgeError).message}), la seconde a réussi.`);
        } else throw error;
      }
      const info = parseTxt2ImgInfo(response.info, count);
      // Agrandissement : toujours après une génération en taille native, jamais une génération en grand.
      let upscaled: { factor: number; upscaler: string } | null = null;
      let upscaledImages: string[] = [];
      if (request.upscale && response.images?.length) {
        const available = await client.upscalers().catch(() => [] as string[]);
        const upscaler = available.includes(rules.general.upscaler) ? rules.general.upscaler : available.includes('Lanczos') ? 'Lanczos' : available[0];
        if (upscaler) {
          context.onProgress?.(`J’agrandis ${count > 1 ? 'les images' : 'l’image'} (×${rules.general.facteurAgrandissement}, ${upscaler})…`);
          try {
            upscaledImages = [];
            for (const image of response.images.slice(0, count)) {
              upscaledImages.push(await client.upscale(image, rules.general.facteurAgrandissement, upscaler, context.signal));
            }
            upscaled = { factor: rules.general.facteurAgrandissement, upscaler };
            if (upscaler !== rules.general.upscaler) warnings.push(`Agrandisseur « ${rules.general.upscaler} » absent de Forge : « ${upscaler} » utilisé.`);
          } catch (error) {
            warnings.push(`Agrandissement non fait : ${error instanceof Error ? error.message : String(error)}`);
            upscaledImages = [];
          }
        } else warnings.push('Aucun agrandisseur disponible dans Forge : image en taille native seulement.');
      }
      const now = this.deps.now?.() ?? new Date();
      const folderNames = imageFileNames({ project: request.project, prompt: request.prompt, now, index: 0 });
      const folder = join(images.outputRoot, ...folderNames.folder.split('/'));
      await mkdir(folder, { recursive: true });
      const files: GeneratedFile[] = [];
      const imagesData = (response.images ?? []).slice(0, count);
      for (let index = 0; index < imagesData.length; index += 1) {
        const names = imageFileNames({ project: request.project, prompt: request.prompt, now, index });
        const png = Buffer.from(imagesData[index]!, 'base64');
        const pngPath = join(folder, names.png);
        await writeFile(pngPath, png);
        let blackAndWhite: string | undefined;
        if (preset.blackAndWhite) {
          try {
            const bwPath = join(folder, names.pngBw);
            await writeFile(bwPath, toBlackAndWhitePng(png));
            blackAndWhite = bwPath;
          } catch (error) {
            warnings.push(`Version noir et blanc non produite : ${error instanceof PngError ? error.message : 'erreur de conversion'}.`);
          }
        }
        const seed = info.seeds[index] ?? -1;
        let source: string | undefined;
        if (init && request.initImage) {
          // La photo de départ est recopiée une fois à côté de la première image.
          if (index === 0) {
            source = join(folder, `${names.sourceBase}${init.extension}`);
            await copyFile(request.initImage.path.trim().replace(/^["']|["']$/g, ''), source);
          } else {
            source = files[0]?.source;
          }
        }
        let upscaledPath: string | undefined;
        if (upscaledImages[index]) {
          upscaledPath = join(folder, `${names.base}-grand.png`);
          await writeFile(upscaledPath, Buffer.from(upscaledImages[index]!, 'base64'));
        }
        const txtPath = join(folder, names.txt);
        await writeFile(
          txtPath,
          sidecarText({
            project: request.project,
            userPrompt: request.prompt,
            payload,
            seed,
            ...(info.checkpoint ? { checkpoint: info.checkpoint } : payload.override_settings.sd_model_checkpoint ? { checkpoint: String(payload.override_settings.sd_model_checkpoint) } : {}),
            ...(payload.override_settings.sd_vae ? { vae: String(payload.override_settings.sd_vae) } : {}),
            ...(request.lora ? { lora: request.lora } : {}),
            createdAt: now,
            ...(blackAndWhite ? { blackAndWhiteFile: blackAndWhite } : {}),
            ...(source ? { sourceImage: source, fidelity: 1 - (denoising ?? 0.55) } : {}),
            ...(refined?.used ? { refinedBy: refined.model } : refined?.reason ? { refineFallback: refined.reason } : {}),
            imager: {
              subjectType,
              ...(request.personCount ? { personCount: request.personCount } : {}),
              ...(render !== 'auto' ? { render: renderHonored ? render : `${render} demandé, modèle ${checkpoint?.rendu ?? 'inconnu'}` } : {}),
              checkpointLabel: chosen?.profile.label ?? 'modèle courant de Forge',
              adetailer: adetailerApplied,
              ...(upscaled ? { upscaled: `×${upscaled.factor} (${upscaled.upscaler})${upscaledPath ? ` : ${upscaledPath}` : ''}` } : {}),
            },
          }),
          'utf8',
        );
        files.push({ png: pngPath, txt: txtPath, seed, ...(blackAndWhite ? { blackAndWhite } : {}), ...(source ? { source } : {}), ...(upscaledPath ? { upscaled: upscaledPath } : {}) });
      }
      if (!files.length) throw new ForgeError('bad_response', 'Forge n’a renvoyé aucune image.');
      return {
        project: request.project,
        folder,
        files,
        width: payload.width,
        height: payload.height,
        durationMs: Date.now() - started,
        forgeStartedByJarvis: how === 'started',
        brainReloaded: (brainReloaded = await this.release(forge, client, how, images, ollama, settings, loadedBefore, warnings)),
        warnings,
        finalPrompt: payload.prompt,
        refined: refined ? { used: refined.used, model: refined.model, ...(refined.reason ? { reason: refined.reason } : {}) } : null,
        checkpoint: chosen ? { id: chosen.id, label: chosen.profile.label } : null,
        subjectType,
        render,
        renderHonored,
        adetailer: adetailerApplied,
        upscaled,
      };
    } finally {
      // Déjà fait sur le chemin normal ; ici, le chemin d'erreur : Forge libéré et modèle rechargé quoi qu'il arrive.
      if (brainReloaded === null) await this.release(forge, client, how, images, ollama, settings, loadedBefore, warnings);
    }
  }

  /** Libère Forge (arrêt s'il a été lancé ici, sinon déchargement du modèle) puis recharge le modèle de langage. */
  private async release(
    forge: ForgeProcess,
    client: ForgeClient,
    how: 'already' | 'started' | null,
    images: ImagesSettings,
    ollama: OllamaControl,
    settings: Settings,
    loadedBefore: { name: string }[],
    warnings: string[],
  ): Promise<string | null> {
    try {
      if (how === 'started' && !images.keepForgeRunning) await forge.stop();
      else if (how !== null) await client.unloadCheckpoint().catch(() => undefined);
    } catch (error) {
      warnings.push(`Forge n’a pas pu être libéré : ${error instanceof Error ? error.message : String(error)}`);
    }
    const brain = pickBrainModel(settings, loadedBefore.map((model) => model.name));
    if (!brain) return null;
    const keepAlive = activeOrchestra(settings) ? BRAIN_KEEP_ALIVE : '5m';
    const ok = await ollama.preload(brain, keepAlive);
    if (!ok) warnings.push(`Le modèle ${brain} n’a pas pu être rechargé : il reviendra à la prochaine demande.`);
    return ok ? brain : null;
  }

  /**
   * Forge ouvre son interface dans le navigateur à chaque démarrage (réglage `auto_launch_browser`
   * à « Local » par défaut, sans `config.json`). Lancé par Jarvis après chaque image, il ouvrait un
   * onglet à chaque fois. Le réglage est coupé une fois par l'API (Forge l'écrit dans son
   * `config.json`) ; un Forge lancé par l'utilisateur n'est jamais modifié.
   */
  private async disableBrowserLaunch(client: ForgeClient, forgeUrl: string): Promise<void> {
    if (this.browserLaunchDisabled.has(forgeUrl)) return;
    try {
      const options = await client.options();
      if (options.auto_launch_browser !== 'Disable') {
        await client.setOptions({ auto_launch_browser: 'Disable' });
        this.deps.log?.('[images] Forge : ouverture du navigateur au démarrage coupée (config.json de Forge).');
      }
      this.browserLaunchDisabled.add(forgeUrl);
    } catch (error) {
      this.deps.log?.(`[images] Forge : réglage du navigateur laissé tel quel (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  private processFor(forgeDir: string, client: ForgeClient): ForgeProcess {
    const key = `${forgeDir}|${client.url}`;
    let process = this.processes.get(key);
    if (!process) {
      process = new ForgeProcess(forgeDir, client, { log: this.deps.log, ...this.deps.processDeps });
      this.processes.set(key, process);
    }
    return process;
  }

  /* ------------------------------------------------------------------ */
  /* Mode direct : la consigne de l'utilisateur, sans le modèle de langage */
  /* ------------------------------------------------------------------ */

  /** Panneau « Imager direct » ouvert : avec `directHoldForge`, Forge reste chargé entre deux images. */
  setDirectPanelOpen(open: boolean): Promise<void> {
    this.directPanelOpen = open;
    if (open || !this.held) return Promise.resolve();
    // Fermeture : Forge est libéré et le modèle de langage rechargé, comme après une image ordinaire.
    const held = this.held;
    this.held = null;
    return this.release(held.forge, held.client, held.how, held.images, held.ollama, held.settings, held.loadedBefore, []).then(() => undefined);
  }

  /** Vrai si le mode direct garde Forge chargé en ce moment (panneau ouvert et option active). */
  private holdsForge(images: ImagesSettings): boolean {
    return this.directPanelOpen && images.directHoldForge;
  }

  /** Ce que le panneau « Imager direct » a besoin de savoir : modèles et LoRA sur le disque, défauts par projet. */
  async directCatalog(): Promise<DirectCatalog> {
    const images = this.settings();
    const { presets } = await this.loadPresets();
    const { rules } = await this.loadRules();
    const byFile = new Map(Object.values(rules.checkpoints).map((profile) => [profile.fichier.toLowerCase(), profile.label]));
    const checkpoints = this.listModelFiles(join(images.forgeDir, 'models', 'Stable-diffusion')).map((file) => ({ file, label: byFile.get(file.toLowerCase()) ?? file.replace(/\.(safetensors|ckpt)$/iu, '') }));
    const loras = this.listModelFiles(join(images.forgeDir, 'models', 'Lora')).map((file) => file.replace(/\.(safetensors|ckpt|pt)$/iu, ''));
    return {
      enabled: images.enabled,
      forgeDir: images.forgeDir,
      outputRoot: images.outputRoot,
      checkpoints,
      loras,
      samplers: DIRECT_SAMPLERS,
      schedulers: DIRECT_SCHEDULERS,
      formats: IMAGE_FORMATS.map((id) => ({ id, ...FORMAT_SIZES[id] })),
      projects: Object.fromEntries(IMAGE_PROJECTS.map((id) => [id, directProjectDefaults(presets[id], rules.negatifAnatomie)])) as Record<ImageProject, DirectProjectDefaults>,
      adetailerInstalled: this.adetailerInstalled(images.forgeDir),
      improve: rules.direct.ameliorer,
      holdForge: images.directHoldForge,
      keepTxtPerso: !images.directNoTxtPerso,
      busy: this.busy !== null,
    };
  }

  private listModelFiles(dir: string): string[] {
    try {
      return readdirSync(dir)
        .filter((name) => /\.(safetensors|ckpt|pt)$/iu.test(name) && isSafeModelFileName(name))
        .sort((a, b) => a.localeCompare(b, 'fr'));
    } catch {
      return [];
    }
  }

  /**
   * Génère depuis la consigne de l'utilisateur, sans le modèle de langage. `improve` : Imager
   * complète la demande avec ses règles (traduction par un petit modèle local si la demande est en
   * français, mots de qualité, style du projet, négatif anti-défauts, taille native du type) ; le
   * contenu de la demande n'est ni jugé ni filtré. Sinon la consigne part telle quelle.
   * Même ordre que `generate` : décharger Ollama → Forge → générer → ranger → libérer → recharger.
   */
  async generateDirect(request: DirectGenerateInput, context: DirectContext = {}): Promise<DirectResult> {
    if (this.busy) throw new ForgeError('http', 'Une image est déjà en cours de génération : attends qu’elle finisse.');
    const work = this.generateDirectNow(request, context);
    this.busy = work.catch(() => undefined);
    try {
      return await work;
    } finally {
      this.busy = null;
    }
  }

  private async generateDirectNow(request: DirectGenerateInput, context: DirectContext): Promise<DirectResult> {
    const settings = this.deps.getSettings();
    const images = this.settings();
    if (!images.enabled) throw new ForgeError('http', 'Jarvis Imager est coupé : active-le dans Réglages → Services → Jarvis Imager.');
    const started = Date.now();
    const warnings: string[] = [];
    const { presets, warnings: presetWarnings } = await this.loadPresets();
    warnings.push(...presetWarnings);
    const { rules, warnings: ruleWarnings } = await this.loadRules();
    warnings.push(...ruleWarnings);
    const preset = presets[request.project];
    const improve = request.improve ?? rules.direct.ameliorer;
    const ollamaUrl = this.deps.ollamaUrl ?? (settings.baseUrl?.trim() || 'http://127.0.0.1:11434');
    const ollama = new OllamaControl(ollamaUrl, this.deps.fetchImpl);

    // Modèle : celui du panneau (fichier), sinon pour « améliorer » le choix d'Imager selon le rendu, sinon le modèle courant de Forge.
    const byFile = Object.entries(rules.checkpoints).find(([, profile]) => profile.fichier.toLowerCase() === request.checkpoint?.toLowerCase());
    const render = improve ? resolveRenderStyle(request.render, request.prompt) : 'auto';
    const chosen = request.checkpoint
      ? byFile
        ? { id: byFile[0], profile: byFile[1] }
        : null
      : improve
        ? chooseCheckpoint(rules, (file) => existsSync(this.checkpointPath(images.forgeDir, file)), render)
        : null;
    const checkpointFile = request.checkpoint ?? chosen?.profile.fichier;
    const profile = chosen?.profile;
    const vaePath = join(images.forgeDir, 'models', 'VAE', SDXL_VAE_FILE);
    const vae = profile?.vae?.trim() || (existsSync(vaePath) ? SDXL_VAE_FILE : '');

    // « Améliorer mon prompt » : type, nombre de personnes et format devinés par mots, consigne assemblée par les règles.
    const subjectType = improve ? (request.subjectType ? resolveSubjectType(request.subjectType) : guessSubjectType(request.prompt)) : 'autre';
    const personCount = improve ? (request.personCount ?? (guessPersonCount(request.prompt) || undefined)) : undefined;
    const format: ImageFormat = request.format ?? (improve ? defaultFormatFor(rules, subjectType, preset) ?? preset.defaultFormat : preset.defaultFormat);
    const useAdetailer = request.adetailer
      ? request.adetailer.faces || request.adetailer.hands
      : improve && wantsAdetailer(rules, subjectType, this.adetailerInstalled(images.forgeDir));
    const adetailerHands = request.adetailer ? request.adetailer.hands : rules.types[subjectType].adetailerMains;

    context.onProgress?.(improve ? 'Imager complète ta consigne, puis décharge le modèle de langage…' : 'Imager envoie ta consigne telle quelle : je décharge le modèle de langage…');
    const unloaded = await ollama.unloadAll();
    const loadedBefore = unloaded.map((name) => ({ name }));
    if (unloaded.length) this.deps.log?.(`[images] modèles Ollama déchargés : ${unloaded.join(', ')}`);

    // Traduction en anglais par le dictionnaire local (aucun modèle, rien n'est jugé ni filtré) : seulement si la demande est en français.
    const english = improve ? toEnglishIfNeeded(request.prompt) : null;
    const translated = english?.translated ? { text: english.text, model: 'dictionnaire local' } : null;

    const assembled = improve
      ? buildImagerPrompt(
          {
            subject: translated?.text ?? request.prompt,
            type: subjectType,
            ...(personCount ? { personCount } : {}),
            project: request.project,
            preset,
            ...(render !== 'auto' ? { render } : {}),
            extraNegative: request.negative ? [request.negative] : [],
            ...(profile ? { checkpoint: profile } : {}),
            ...(request.loras?.[0] ? { lora: request.loras[0] } : {}),
          },
          rules,
        )
      : null;
    const sampling = profile && (improve || !request.sampler) ? { sampler: profile.sampler, scheduler: profile.scheduler, steps: profile.steps, cfg: profile.cfg } : null;
    const payload = buildDirectPayload(
      {
        ...request,
        ...(assembled ? { prompt: assembled.prompt, negative: assembled.negative, loras: request.loras?.slice(1) } : {}),
        format,
        ...(checkpointFile ? { checkpoint: checkpointFile } : {}),
        steps: request.steps ?? sampling?.steps,
        cfg: request.cfg ?? sampling?.cfg,
        sampler: request.sampler ?? sampling?.sampler,
        scheduler: request.scheduler ?? sampling?.scheduler,
      },
      {
        ...(vae ? { vae } : {}),
        builtinScripts: forgeBuiltinScriptArgs(),
        ...(useAdetailer ? { adetailerArgs: adetailerArgs({ hands: adetailerHands, anime: profile?.rendu === 'anime' }) } : {}),
      },
    );

    const client = new ForgeClient(images.forgeUrl, this.deps.fetchImpl);
    const forge = this.processFor(images.forgeDir, client);
    let how: 'already' | 'started' | null = null;
    let released = false;
    try {
      how = this.held ? this.held.how : await forge.ensureRunning(context.onProgress, context.signal);
      if (how === 'started') await this.disableBrowserLaunch(client, images.forgeUrl);
      const count = payload.batch_size;
      context.onProgress?.(count > 1 ? `Forge est prêt, je fabrique ${count} images…` : 'Forge est prêt, je fabrique l’image…');
      if (useAdetailer) {
        const scripts = await client.scripts().catch(() => [] as string[]);
        if (!scripts.includes('adetailer')) {
          warnings.push('ADetailer est installé mais ce Forge ne l’a pas chargé : image sans retouche des visages et des mains.');
          delete payload.alwayson_scripts?.ADetailer;
        }
      }
      const response = await this.txt2imgWithProgress(client, payload, context, warnings);
      const info = parseTxt2ImgInfo(response.info, count);
      const now = this.deps.now?.() ?? new Date();
      const folderNames = imageFileNames({ project: request.project, prompt: request.prompt, now, index: 0 });
      const folder = join(images.outputRoot, ...folderNames.folder.split('/'));
      await mkdir(folder, { recursive: true });
      const keepTxt = request.keepTxt ?? !(request.project === 'perso' && images.directNoTxtPerso);
      const files: DirectFile[] = [];
      const imagesData = (response.images ?? []).slice(0, count);
      for (let index = 0; index < imagesData.length; index += 1) {
        const names = imageFileNames({ project: request.project, prompt: request.prompt, now, index });
        const png = Buffer.from(imagesData[index]!, 'base64');
        const pngPath = join(folder, names.png);
        await writeFile(pngPath, png);
        const seed = info.seeds[index] ?? -1;
        let txtPath: string | undefined;
        if (keepTxt) {
          txtPath = join(folder, names.txt);
          await writeFile(
            txtPath,
            sidecarText({
              project: request.project,
              userPrompt: request.prompt,
              payload,
              seed,
              ...(checkpointFile ? { checkpoint: checkpointFile } : {}),
              ...(vae ? { vae } : {}),
              ...(request.loras?.[0] ? { lora: request.loras[0] } : {}),
              createdAt: now,
              direct: improve ? `complétée par Imager (règles seules${translated ? ', traduite par le dictionnaire local' : ''})` : 'envoyée telle quelle',
              ...(improve ? { imager: { subjectType, ...(personCount ? { personCount } : {}), ...(render !== 'auto' ? { render } : {}), checkpointLabel: profile?.label ?? 'modèle courant de Forge', adetailer: Boolean(payload.alwayson_scripts?.ADetailer) } } : {}),
            }),
            'utf8',
          );
        }
        files.push({ png: pngPath, ...(txtPath ? { txt: txtPath } : {}), seed, preview: `data:image/png;base64,${imagesData[index]!}` });
      }
      if (!files.length) throw new ForgeError('bad_response', 'Forge n’a renvoyé aucune image.');
      const hold = this.holdsForge(images);
      let brainReloaded: string | null = null;
      if (hold) {
        this.held = { forge, client, how, images, ollama, settings, loadedBefore: this.held?.loadedBefore.length ? this.held.loadedBefore : loadedBefore };
      } else {
        this.held = null;
        brainReloaded = await this.release(forge, client, how, images, ollama, settings, loadedBefore, warnings);
      }
      released = true;
      return {
        project: request.project,
        folder,
        files,
        width: payload.width,
        height: payload.height,
        durationMs: Date.now() - started,
        warnings,
        finalPrompt: payload.prompt,
        finalNegative: payload.negative_prompt,
        improved: improve,
        ...(translated ? { translatedBy: translated.model } : {}),
        checkpoint: profile ? { id: chosen!.id, label: profile.label } : checkpointFile ? { id: checkpointFile, label: checkpointFile } : null,
        subjectType,
        adetailer: Boolean(payload.alwayson_scripts?.ADetailer),
        forgeHeld: hold,
        brainReloaded,
      };
    } finally {
      if (!released) {
        // Chemin d'erreur : Forge libéré et modèle rechargé quoi qu'il arrive (même si le panneau garde Forge d'habitude).
        this.held = null;
        await this.release(forge, client, how, images, ollama, settings, loadedBefore, warnings);
      }
    }
  }

  /** `txt2img` avec l'avancement de Forge (`/sdapi/v1/progress`) relayé chaque seconde, et le second essai après un 500. */
  private async txt2imgWithProgress(client: ForgeClient, payload: Txt2ImgPayload, context: DirectContext, warnings: string[]): Promise<Txt2ImgResponse> {
    const poll = context.onProgressValue
      ? setInterval(() => {
          void client.progress().then((p) => context.onProgressValue?.(p.progress, p.etaSeconds)).catch(() => undefined);
        }, 1_000)
      : null;
    try {
      const once = () => client.txt2img(payload, context.signal);
      try {
        return await once();
      } catch (error) {
        const transient =
          error instanceof ForgeError &&
          !context.signal?.aborted &&
          ((error.kind === 'http' && /\b500\b/.test(error.message)) || (error.kind === 'unreachable' && (await client.ping(5_000))));
        if (!transient) throw error;
        const delay = this.deps.forgeRetryDelayMs ?? 8_000;
        this.deps.log?.(`[images] Forge a échoué (${(error as ForgeError).message}) : nouvel essai dans ${Math.round(delay / 1000)} s`);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        const response = await once();
        warnings.push(`Forge a échoué à la première requête (${(error as ForgeError).message}), la seconde a réussi.`);
        return response;
      }
    } finally {
      if (poll) clearInterval(poll);
    }
  }

  /** À la fermeture de Jarvis : un Forge lancé par Jarvis ne doit pas survivre. */
  async shutdown(): Promise<void> {
    this.held = null;
    for (const process of this.processes.values()) await process.stop();
  }
}

/** Le modèle à recharger : le cerveau de l'orchestre, sinon celui qui tournait, sinon le modèle du chat (Ollama seulement). */
export function pickBrainModel(settings: Settings, loadedBefore: string[]): string | null {
  const orchestra = activeOrchestra(settings);
  if (orchestra) return orchestra.brain;
  if (settings.provider !== 'ollama') return loadedBefore[0] ?? null;
  return loadedBefore[0] ?? settings.model?.trim() ?? null;
}

/** Phrase française du résultat du mode direct (discussion, enceinte, journal). */
export function describeDirectResult(result: DirectResult): string {
  const lines = [
    result.files.length > 1
      ? `${result.files.length} images générées (${result.width}×${result.height}, projet ${result.project}) dans ${result.folder} :`
      : `Image générée (${result.width}×${result.height}, projet ${result.project}) :`,
    ...result.files.map((file) => `- ${file.png} — graine ${file.seed}`),
    `Durée : ${Math.round(result.durationMs / 1000)} s. Mode direct, sans le modèle de langage${result.improved ? ` : consigne complétée par Imager (règles seules${result.translatedBy ? ', traduite par le dictionnaire local' : ''})` : ' : consigne envoyée telle quelle'}.`,
    `Consigne envoyée à Stable Diffusion : ${result.finalPrompt}`,
  ];
  if (result.checkpoint) lines.push(`Modèle : ${result.checkpoint.label}${result.adetailer ? ', retouche visages/mains faite' : ''}.`);
  for (const warning of result.warnings) lines.push(`Attention : ${warning}`);
  if (result.forgeHeld) lines.push('Forge reste chargé tant que le panneau Imager direct est ouvert ; le modèle de langage reviendra à sa fermeture.');
  else if (result.brainReloaded) lines.push(`Le modèle ${result.brainReloaded} est rechargé.`);
  return lines.join('\n');
}

/** Phrase française du résultat, pour le modèle et l'utilisateur. */
export function describeImagesResult(result: ImagesResult): string {
  const lines = [
    result.files.length > 1
      ? `${result.files.length} images générées (${result.width}×${result.height}, projet ${result.project}) dans ${result.folder} :`
      : `Image générée (${result.width}×${result.height}, projet ${result.project}) :`,
    ...result.files.map((file) => `- ${file.png}${file.blackAndWhite ? ` (noir et blanc : ${file.blackAndWhite})` : ''} — graine ${file.seed}`),
    `Réglages à côté de chaque image (fichier .txt). Durée : ${Math.round(result.durationMs / 1000)} s.`,
  ];
  const source = result.files.find((file) => file.source)?.source;
  if (source) lines.push(`Faite à partir de ta photo (copie : ${source}).`);
  const upscaledFiles = result.files.filter((file) => file.upscaled).map((file) => file.upscaled!);
  if (result.upscaled && upscaledFiles.length) lines.push(`Version agrandie ×${result.upscaled.factor} (${result.upscaled.upscaler}) : ${upscaledFiles.join(', ')}`);
  lines.push(
    `Jarvis Imager : modèle ${result.checkpoint?.label ?? 'courant de Forge'}, sujet « ${result.subjectType} »${result.render !== 'auto' ? `, rendu ${result.render}${result.renderHonored ? '' : ' demandé mais aucun modèle de ce rendu sur le disque'}` : ''}, retouche visages et mains ${result.adetailer ? 'faite' : 'non appliquée'}.`,
  );
  if (result.refined?.used) lines.push(`Consigne envoyée à Stable Diffusion (sujet décrit par ${result.refined.model}, règles Imager appliquées) : ${result.finalPrompt}`);
  else if (result.refined?.reason) lines.push(`Consigne envoyée (sujet gardé tel quel, ${result.refined.reason}) : ${result.finalPrompt}`);
  else lines.push(`Consigne envoyée à Stable Diffusion : ${result.finalPrompt}`);
  if (result.brainReloaded) lines.push(`Le modèle ${result.brainReloaded} est rechargé.`);
  if (result.warnings.length) lines.push(`Remarques : ${result.warnings.join(' ')}`);
  return lines.join('\n');
}
