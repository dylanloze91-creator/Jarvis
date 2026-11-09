import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRAIN_KEEP_ALIVE,
  DEFAULT_IMAGES_ROOT_WINDOWS,
  DEFAULT_PRESETS,
  activeOrchestra,
  applyPresetOverrides,
  buildTxt2ImgPayload,
  clampCount,
  defaultPresetsYaml,
  imageFileNames,
  parsePresetsYaml,
  parseTxt2ImgInfo,
  sidecarText,
  type ImagePreset,
  type ImageProject,
  type ImageRequest,
  type Settings,
} from '@jarvis/core';
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
    };
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
    const payload = buildTxt2ImgPayload({ ...request, count }, preset, {
      ...(existsSync(checkpointPath) ? { checkpoint: SDXL_CHECKPOINT_FILE } : {}),
      ...(existsSync(vaePath) ? { vae: SDXL_VAE_FILE } : {}),
    });

    context.onProgress?.(IMAGES_INTRO_MESSAGE);
    const ollama = new OllamaControl(this.deps.ollamaUrl ?? (settings.baseUrl?.trim() || 'http://127.0.0.1:11434'), this.deps.fetchImpl);
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
      const response = await client.txt2img(payload, context.signal);
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
          }),
          'utf8',
        );
        files.push({ png: pngPath, txt: txtPath, seed, ...(blackAndWhite ? { blackAndWhite } : {}) });
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
  if (result.brainReloaded) lines.push(`Le modèle ${result.brainReloaded} est rechargé.`);
  if (result.warnings.length) lines.push(`Remarques : ${result.warnings.join(' ')}`);
  return lines.join('\n');
}
