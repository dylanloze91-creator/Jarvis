import { CODE_MODEL_CATALOG, codeModelsOffered } from '../developer/codeModels.js';
import { OLLAMA_DEFAULT_MODEL } from '../providers/ollama.js';
import { OLLAMA_RTX2060_6GB_RECOMMENDATIONS } from '../providers/ollamaModels.js';
import type { OllamaCodeOptions, ProviderConfig } from '../providers/types.js';
import { defaultSettings, parseSettings, type Settings } from '../settings.js';

export type MachineProfileId = 'modest' | 'standard' | 'full';

/** Relevé réel, ou `{ failed: true }` si la mesure n’a pas abouti. */
export interface MachineMeasure {
  failed: boolean;
  totalRamBytes: number;
  cpuModel: string;
  logicalCores: number;
  gpus: Array<{ name: string; totalMiB: number }>;
  /** `absent` : nvidia-smi introuvable. `error` : la mesure de la carte a échoué. */
  gpuProbe: 'ok' | 'absent' | 'error';
  freeDiskBytes: number | null;
  ollamaPresent: boolean;
}

export interface ProfileDecision {
  profile: MachineProfileId;
  /** Pas de carte NVIDIA : le modèle de discussion tourne sur le processeur. */
  cpuOnly: boolean;
  measureFailed: boolean;
  /** Une phrase. */
  detected: string;
  /** Une phrase. */
  chosen: string;
  /** Modèle de discussion Ollama. Jamais un modèle de code. */
  chatModel: string;
}

const GIB = 1024 ** 3;
/** En dessous : « environ 8 Go ». 16 Go reste au-dessus. */
const RAM_MODEST_BELOW_GIB = 12;
/** « 32 Go ou plus ». 31 Go utiles d’une barrette de 32 Go comptent. */
const RAM_FULL_FROM_GIB = 30;
/** « 4 Go ou moins » (GTX 1050 Ti = 4096 Mio). */
const VRAM_MODEST_MAX_MIB = 4.5 * 1024;
/** « environ 6 Go » (GTX 1060 6 Go = 6144 Mio). */
const VRAM_STANDARD_MIN_MIB = 5.5 * 1024;

/** Petit modèle 1,5–2 B déjà listé dans le catalogue Ollama, sinon le plus petit qui tient. */
export function modestChatModel(): string {
  const inRange = OLLAMA_RTX2060_6GB_RECOMMENDATIONS.find((entry) => {
    const size = parameterBillions(entry.model);
    return size !== null && size >= 1.5 && size <= 2;
  });
  if (inRange) return inRange.model;
  const smallest = [...OLLAMA_RTX2060_6GB_RECOMMENDATIONS]
    .filter((entry) => entry.fitsOn6GbVram)
    .sort((a, b) => a.downloadSizeGb - b.downloadSizeGb)[0];
  return smallest?.model ?? OLLAMA_DEFAULT_MODEL;
}

export function selectMachineProfile(measure: MachineMeasure): ProfileDecision {
  if (measure.failed || measure.gpuProbe === 'error' || !(measure.totalRamBytes > 0)) {
    return decide('modest', {
      cpuOnly: true,
      measureFailed: true,
      detected: 'La mesure de la machine a échoué.',
      chosen:
        'Profil modeste par précaution : petit modèle, réveil coupé, synthèse Windows, vidéo et développeur coupés.',
      chatModel: modestChatModel(),
    });
  }

  const ramGib = measure.totalRamBytes / GIB;
  const gpu = strongestGpu(measure);
  const noGpu = measure.gpuProbe !== 'ok' || !gpu || gpu.totalMiB <= 0;

  if (noGpu) {
    const profile: MachineProfileId = ramGib >= RAM_MODEST_BELOW_GIB ? 'standard' : 'modest';
    return decide(profile, {
      cpuOnly: true,
      measureFailed: false,
      detected: `Pas de carte graphique : ${hardwareTail(measure)}.`,
      chosen:
        profile === 'standard'
          ? 'Réglé pour le processeur, profil standard : Qwen 2.5 3B, voix actuelle, mode développeur coupé.'
          : 'Réglé pour le processeur, profil modeste : petit modèle, réveil coupé, synthèse Windows, vidéo et développeur coupés.',
      chatModel: profile === 'modest' ? modestChatModel() : OLLAMA_DEFAULT_MODEL,
    });
  }

  const detected = `${hardwareTail(measure, gpu)}.`;
  const modest = ramGib < RAM_MODEST_BELOW_GIB || gpu.totalMiB <= VRAM_MODEST_MAX_MIB;
  if (modest) {
    return decide('modest', {
      cpuOnly: false,
      measureFailed: false,
      detected,
      chosen:
        'Profil modeste : Qwen 2.5 1.5B, contexte 4096, réveil coupé, synthèse Windows, vidéo et développeur coupés.',
      chatModel: modestChatModel(),
    });
  }
  if (ramGib >= RAM_FULL_FROM_GIB && gpu.totalMiB >= VRAM_STANDARD_MIN_MIB) {
    return decide('full', {
      cpuOnly: false,
      measureFailed: false,
      detected,
      chosen:
        'Profil complet : Qwen 2.5 3B et les réglages de la 0.4.25, sans télécharger le modèle de code.',
      chatModel: OLLAMA_DEFAULT_MODEL,
    });
  }
  if (ramGib >= RAM_MODEST_BELOW_GIB && gpu.totalMiB >= VRAM_STANDARD_MIN_MIB) {
    return decide('standard', {
      cpuOnly: false,
      measureFailed: false,
      detected,
      chosen: 'Profil standard : Qwen 2.5 3B, voix actuelle, contexte inchangé, mode développeur coupé.',
      chatModel: OLLAMA_DEFAULT_MODEL,
    });
  }
  return decide('modest', {
    cpuOnly: false,
    measureFailed: false,
    detected,
    chosen:
      'Profil modeste : Qwen 2.5 1.5B, contexte 4096, réveil coupé, synthèse Windows, vidéo et développeur coupés.',
    chatModel: modestChatModel(),
  });
}

/**
 * Applique un profil sur une copie des réglages. Le prompt système, les clés
 * et le reste (Spotify, Google, raccourci) sont gardés. Le modèle de code
 * n’est jamais choisi ici.
 */
export function applyMachineProfile(current: Settings, decision: ProfileDecision): Settings {
  assertChatModelDownload(decision.chatModel);
  const voice = { ...current.voice };
  const developer = { ...current.developer, enabled: false };
  const next: Settings = {
    ...current,
    voice,
    developer,
    provider: 'ollama',
    model: decision.chatModel,
    fallbackModel: decision.chatModel,
    machine: {
      profile: decision.profile,
      cpuOnly: decision.cpuOnly,
      measureFailed: decision.measureFailed,
      detected: decision.detected,
      chosen: decision.chosen,
    },
  };
  if (decision.profile === 'modest') {
    next.ollamaNumCtx = 4096;
    next.videoAnalysis = false;
    next.voice = {
      ...voice,
      enabled: false,
      sttProvider: 'local-whisper',
      ttsProvider: 'browser-local',
      wakeLearning: false,
    };
    next.developer = { ...developer, enabled: false, codeModel: '' };
  } else {
    next.ollamaNumCtx = undefined;
    next.videoAnalysis = current.videoAnalysis === false ? undefined : current.videoAnalysis;
  }
  return parseSettings(next);
}

/**
 * Un fichier de réglages déjà présent n’est pas réécrit. Sans fichier, le
 * profil est appliqué sur les défauts.
 */
export function planStartup(
  existingRaw: string | null,
  decision: ProfileDecision,
): { rawToWrite: string | null; settings: Settings } {
  if (existingRaw !== null) {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(existingRaw) as unknown;
    } catch {
      parsed = {};
    }
    return { rawToWrite: null, settings: parseSettings(parsed) };
  }
  const settings = applyMachineProfile(defaultSettings, decision);
  return { rawToWrite: JSON.stringify(settings, null, 2), settings };
}

/** Absent ou vrai : l’analyse vidéo reste celle de 0.4.25. Seul `false` la coupe. */
export function videoAnalysisEnabled(settings: Settings): boolean {
  return settings.videoAnalysis !== false;
}

/**
 * Options Ollama du chat. Absentes : le corps de la requête reste celui de
 * 0.4.25 (`num_ctx` 8192, pas de `num_gpu`).
 */
export function chatOllamaOptions(settings: Settings): OllamaCodeOptions | undefined {
  const machine = settings.machine;
  if (!machine) return undefined;
  const options: OllamaCodeOptions = {};
  if (machine.profile === 'modest') options.numCtx = settings.ollamaNumCtx ?? 4096;
  if (machine.cpuOnly && machine.profile !== 'full') options.numGpu = 0;
  return options.numCtx !== undefined || options.numGpu !== undefined ? options : undefined;
}

export function chatProviderConfig(settings: Settings): ProviderConfig {
  const ollama = settings.provider === 'ollama' ? chatOllamaOptions(settings) : undefined;
  return {
    provider: settings.provider,
    model: settings.model,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    ...(ollama ? { ollama } : {}),
  };
}

/** Refuse tout modèle de code, et tout identifiant hors des deux modèles de discussion. */
export function assertChatModelDownload(model: string): void {
  if (CODE_MODEL_CATALOG.some((spec) => spec.id === model)) {
    throw new Error('Un modèle de code ne se télécharge pas au démarrage.');
  }
  const allowed = new Set([modestChatModel(), OLLAMA_DEFAULT_MODEL]);
  if (!allowed.has(model)) {
    throw new Error(`Modèle de discussion non prévu : ${model}`);
  }
}

export function shouldDownloadChatModel(input: {
  firstLaunch: boolean;
  ollamaPresent: boolean;
  installed: boolean;
  model: string;
}): boolean {
  if (!input.firstLaunch || !input.ollamaPresent || input.installed) return false;
  try {
    assertChatModelDownload(input.model);
    return true;
  } catch {
    return false;
  }
}

export function modelIsInstalled(names: string[], id: string): boolean {
  return names.some((name) => name === id || name.startsWith(`${id}:`));
}

export function offeredCodeModels(profile: MachineProfileId | undefined) {
  return codeModelsOffered(profile);
}

function decide(
  profile: MachineProfileId,
  fields: Omit<ProfileDecision, 'profile'>,
): ProfileDecision {
  return { profile, ...fields };
}

function parameterBillions(model: string): number | null {
  const match = /(\d+(?:\.\d+)?)b/i.exec(model);
  return match ? Number(match[1]) : null;
}

function strongestGpu(measure: MachineMeasure): { name: string; totalMiB: number } | null {
  return [...measure.gpus].sort((a, b) => b.totalMiB - a.totalMiB)[0] ?? null;
}

function hardwareTail(
  measure: MachineMeasure,
  gpu?: { name: string; totalMiB: number } | null,
): string {
  const parts = [`${formatGo(measure.totalRamBytes)} de mémoire`];
  if (gpu) parts.push(`${gpu.name.trim()} ${formatVram(gpu.totalMiB)}`);
  parts.push(shortCpu(measure.cpuModel));
  parts.push(measure.freeDiskBytes == null ? 'disque non mesuré' : `${formatGo(measure.freeDiskBytes)} libres`);
  parts.push(measure.ollamaPresent ? 'Ollama est là' : 'Ollama est absent');
  return parts.join(', ');
}

function formatGo(bytes: number): string {
  return `${Math.round(bytes / GIB)} Go`;
}

function formatVram(totalMiB: number): string {
  return `${Math.round(totalMiB / 1024)} Go`;
}

function shortCpu(model: string): string {
  const cleaned = model.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'processeur non identifié';
  return cleaned.length > 42 ? `${cleaned.slice(0, 40)}…` : cleaned;
}
