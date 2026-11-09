import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  BRAIN_KEEP_ALIVE,
  DEFAULT_IMAGES_ROOT_WINDOWS,
  DEFAULT_PRESETS,
  MAX_ATTACHMENT_BYTES,
  activeOrchestra,
  applyPresetOverrides,
  buildImg2ImgPayload,
  buildTxt2ImgPayload,
  clampCount,
  closestFormatForAspect,
  defaultPresetsYaml,
  denoisingForFidelity,
  imageAttachmentExtension,
  imageFileNames,
  isImageAttachmentPath,
  parsePresetsYaml,
  parseTxt2ImgInfo,
  referenceFileName,
  sidecarText,
  type ChatAttachment,
  type ImagePreset,
  type ImageProject,
  type ImageRequest,
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
export const SDXL_CHECKPOINT_FILE = 'sd_xl_base_1.0.safetensors';
export const SDXL_VAE_FILE = 'sdxl_vae_fp16_fix.safetensors';
export const IMAGES_INTRO_MESSAGE = 'Je génère ton image : je décharge le modèle de langage, je reviens dans une minute ou deux…';

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
  error?: string;
}

export interface GeneratedFile {
  png: string;
  txt: string;
  blackAndWhite?: string;
  /** Copie de la photo de départ, à côté de l'image. */
  source?: string;
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
}

export interface ImagesServiceDeps {
  getSettings: () => Settings;
  fetchImpl?: typeof fetch;
  ollamaUrl?: string;
  now?: () => Date;
  log?: (line: string) => void;
  processDeps?: ForgeProcessDeps;
}

/**
 * Le module images : réglages par projet, Forge (lancé au besoin), déchargement puis
 * rechargement du modèle de langage, rangement des fichiers. Un seul travail à la fois.
 */
export class ImagesService {
  private processes = new Map<string, ForgeProcess>();
  private busy: Promise<unknown> | null = null;

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
    return {
      enabled: base.enabled,
      forgeDir,
      forgeUrl,
      outputRoot,
      presetsPath: join(outputRoot, PRESETS_FILE_NAME),
      launcherFound: existsSync(join(forgeDir, 'lancer_forge.bat')),
      checkpointFound: existsSync(join(forgeDir, 'models', 'Stable-diffusion', SDXL_CHECKPOINT_FILE)),
      vaeFound: existsSync(join(forgeDir, 'models', 'VAE', SDXL_VAE_FILE)),
      forgeRunning,
      loras,
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
    const preset = presets[request.project];
    const count = clampCount(request.count);
    const vaePath = join(images.forgeDir, 'models', 'VAE', SDXL_VAE_FILE);
    const checkpointPath = join(images.forgeDir, 'models', 'Stable-diffusion', SDXL_CHECKPOINT_FILE);
    const payloadOptions = {
      ...(existsSync(checkpointPath) ? { checkpoint: SDXL_CHECKPOINT_FILE } : {}),
      ...(existsSync(vaePath) ? { vae: SDXL_VAE_FILE } : {}),
    };
    // Photo de départ : lue et contrôlée avant de toucher à Ollama ou à Forge.
    const init = request.initImage ? await this.readInitImage(request.initImage.path) : null;
    const format = request.format ?? (init ? closestFormatForAspect(init.width, init.height) : undefined);
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
          { prompt: request.prompt, project: request.project, preset, ...(request.style ? { style: request.style } : {}), ...(request.negative ? { negative: request.negative } : {}), ...(init ? { fromPhoto: true } : {}) },
          model,
          context.signal,
        );
        if (!refined.used && refined.reason) this.deps.log?.(`[images] consigne d'origine gardée : ${refined.reason}`);
      }
    }
    const baseRequest: ImageRequest = {
      ...request,
      count,
      ...(format ? { format } : {}),
      ...(refined?.used ? { prompt: refined.prompt, style: undefined, negative: [request.negative, refined.negative].filter(Boolean).join(', ') || undefined } : {}),
    };
    const denoising = init ? denoisingForFidelity(request.initImage?.fidelity) : null;
    const payload = init
      ? buildImg2ImgPayload(baseRequest, preset, payloadOptions, init.data.toString('base64'), denoising!)
      : buildTxt2ImgPayload(baseRequest, preset, payloadOptions);

    context.onProgress?.(init ? 'Je pars de ta photo : je décharge le modèle de langage, je reviens dans une minute ou deux…' : IMAGES_INTRO_MESSAGE);
    const unloaded = await ollama.unloadAll();
    const loadedBefore = unloaded.map((name) => ({ name }));
    if (unloaded.length) this.deps.log?.(`[images] modèles Ollama déchargés : ${unloaded.join(', ')}`);

    const client = new ForgeClient(images.forgeUrl, this.deps.fetchImpl);
    const forge = this.processFor(images.forgeDir, client);
    let how: 'already' | 'started' | null = null;
    let brainReloaded: string | null = null;
    try {
      how = await forge.ensureRunning(context.onProgress, context.signal);
      context.onProgress?.(count > 1 ? `Forge est prêt, je fabrique ${count} images…` : 'Forge est prêt, je fabrique l’image…');
      const response = init
        ? await client.img2img(payload as ReturnType<typeof buildImg2ImgPayload>, context.signal)
        : await client.txt2img(payload, context.signal);
      const info = parseTxt2ImgInfo(response.info, count);
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
          }),
          'utf8',
        );
        files.push({ png: pngPath, txt: txtPath, seed, ...(blackAndWhite ? { blackAndWhite } : {}), ...(source ? { source } : {}) });
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

  private processFor(forgeDir: string, client: ForgeClient): ForgeProcess {
    const key = `${forgeDir}|${client.url}`;
    let process = this.processes.get(key);
    if (!process) {
      process = new ForgeProcess(forgeDir, client, { log: this.deps.log, ...this.deps.processDeps });
      this.processes.set(key, process);
    }
    return process;
  }

  /** À la fermeture de Jarvis : un Forge lancé par Jarvis ne doit pas survivre. */
  async shutdown(): Promise<void> {
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
  if (result.refined?.used) lines.push(`Consigne envoyée à Stable Diffusion (reformulée par ${result.refined.model}) : ${result.finalPrompt}`);
  else if (result.refined?.reason) lines.push(`Consigne envoyée telle quelle (${result.refined.reason}) : ${result.finalPrompt}`);
  if (result.brainReloaded) lines.push(`Le modèle ${result.brainReloaded} est rechargé.`);
  if (result.warnings.length) lines.push(`Remarques : ${result.warnings.join(' ')}`);
  return lines.join('\n');
}
