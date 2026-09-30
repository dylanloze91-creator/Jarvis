import {
  REQUIRED_VOICE_ASSETS,
  WHISPER_DICTATION_LANGUAGE,
  WHISPER_WAKE_WORD_LANGUAGE,
  confirmWakeWordCandidate,
  createLocalTemplateWakeWordEngine,
  attenuateClipping,
  openWakeWordSensitivityToThreshold,
  peakEnergy,
  commandAfterWakeWord,
  voiceAssetUrl,
  type WakeWordDetectorConfig,
  type VoiceAssetSpec,
} from '@jarvis/core';
import type { VoiceAssetsReport } from '../../../shared/ipc';

export type DiagnosticStepId =
  | 'disk'
  | 'protocol'
  | 'runtime'
  | 'wakeword'
  | 'whisper'
  | 'inference'
  | 'microphone'
  | 'live';

export type DiagnosticStatus = 'pending' | 'running' | 'ok' | 'warning' | 'failed' | 'skipped';

export interface DiagnosticStep {
  id: DiagnosticStepId;
  label: string;
  status: DiagnosticStatus;
  /** Une ligne en français, affichée sous l'étape. */
  summary?: string;
  /** Lignes supplémentaires, seulement dans « Copier le détail ». */
  details?: string[];
  durationMs?: number;
}

export const DIAGNOSTIC_STEPS: ReadonlyArray<{ id: DiagnosticStepId; label: string }> = [
  { id: 'disk', label: 'Fichiers voix sur le disque' },
  { id: 'protocol', label: 'Lecture par le protocole jarvis-oww' },
  { id: 'runtime', label: 'Moteur ONNX (WebAssembly)' },
  { id: 'wakeword', label: 'Mot de réveil (openWakeWord)' },
  { id: 'whisper', label: 'Chargement de Whisper' },
  { id: 'inference', label: 'Transcription d’essai' },
  { id: 'microphone', label: 'Accès au micro' },
  { id: 'live', label: 'Écoute : dis « Jarvis, quelle heure est-il ? »' },
];

const DEPENDS_ON: Partial<Record<DiagnosticStepId, DiagnosticStepId[]>> = {
  protocol: ['disk'],
  runtime: ['protocol'],
  wakeword: ['runtime'],
  whisper: ['runtime'],
  inference: ['whisper'],
  live: ['whisper', 'microphone'],
};

export interface RecordedAudio {
  pcm: Float32Array;
  sampleRate: number;
}

export interface MicrophoneProbe {
  label: string;
  /** Enregistre jusqu'à un silence après la parole, ou `maxMs`. */
  record: (maxMs: number) => Promise<RecordedAudio>;
  close: () => void;
}

export interface RecordingAnalysis {
  peak: number;
  /** Meilleur score openWakeWord sur l'enregistrement (0 à 1). */
  wakeWordScore: number;
  wakeWordThreshold: number;
  /** Le déclencheur « Jarvis » nu a trouvé un candidat que Whisper a confirmé. */
  bareJarvisConfirmed: boolean;
  bareJarvisText: string | null;
  detected: boolean;
  transcript: string;
  command: string;
}

export interface VoiceDiagnosticDeps {
  assetsReport: () => Promise<VoiceAssetsReport>;
  fetch: typeof fetch;
  runtimeVersion: () => string;
  /** Démarre le runtime ONNX et crée une première session (melspectrogram). */
  startRuntime: () => Promise<void>;
  /** Charge openWakeWord et renvoie le meilleur score sur `pcm` (même signal que `peak`, au débit indiqué). */
  scoreWakeWord: (pcm: Float32Array, sampleRate: number) => Promise<number>;
  loadWhisper: () => Promise<void>;
  transcribe: (pcm: Float32Array, language: string, maxNewTokens: number) => Promise<string>;
  openMicrophone: () => Promise<MicrophoneProbe>;
  now: () => number;
  /** Au-delà, une étape est déclarée bloquée. Whisper a son propre délai (90 s). */
  stepTimeoutMs: number;
  whisperTimeoutMs: number;
  liveRecordMs: number;
  wakeWord: string;
  wakeWordVariants: string[];
  sensitivity: number;
  detectorConfig: WakeWordDetectorConfig | null;
  onPrompt?: (message: string | null) => void;
}

export interface VoiceDiagnosticResult {
  steps: DiagnosticStep[];
  firstFailure: DiagnosticStep | null;
  environment: VoiceAssetsReport | null;
  runtimeVersion: string;
  analysis: RecordingAnalysis | null;
  startedAt: Date;
}

class StepTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`bloqué plus de ${Math.round(ms / 1000)} s`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} Mo`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} ko`;
  return `${bytes} o`;
}

function assetLabel(asset: Pick<VoiceAssetSpec, 'host' | 'path'>): string {
  return `${asset.host}/${asset.path}`;
}

async function readBody(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** 1,5 s de bruit très faible : assez pour faire tourner encodeur + décodeur. */
export function syntheticProbe(sampleRate = 16000): Float32Array {
  const pcm = new Float32Array(Math.round(sampleRate * 1.5));
  let seed = 7;
  for (let i = 0; i < pcm.length; i += 1) {
    seed = (seed * 16807) % 2147483647;
    pcm[i] = ((seed / 2147483647) * 2 - 1) * 0.002;
  }
  return pcm;
}

/** En direct, chaque candidat du déclencheur passe par Whisper ; ici on s'arrête au 4e. */
const MAX_CANDIDATES = 4;

/**
 * Rejoue la chaîne de production sur un enregistrement : openWakeWord,
 * déclencheur « Jarvis » nu (gabarit d'énergie + Whisper anglais), puis la
 * dictée (Whisper français) dont on retire le mot de réveil.
 */
export async function analyzeRecording(
  audio: RecordedAudio,
  deps: Pick<
    VoiceDiagnosticDeps,
    'scoreWakeWord' | 'transcribe' | 'wakeWord' | 'wakeWordVariants' | 'sensitivity' | 'detectorConfig'
  >,
): Promise<RecordingAnalysis> {
  const { pcm, sampleRate } = audio;
  const peak = peakEnergy(pcm);
  const leveled = attenuateClipping(pcm).pcm;
  const wakeWordThreshold = openWakeWordSensitivityToThreshold(deps.sensitivity);
  const wakeWordScore = await deps.scoreWakeWord(pcm, sampleRate);

  const candidates: Float32Array[] = [];
  const trigger = createLocalTemplateWakeWordEngine({
    keyword: deps.wakeWord,
    detectorConfig: deps.detectorConfig,
    sensitivity: deps.sensitivity,
  });
  const controller = trigger.start({
    onDetected: () => {
      const window = controller.getLastAnalyzedWindow?.()?.pcm;
      if (window && candidates.length < MAX_CANDIDATES) candidates.push(window);
    },
    onError: () => undefined,
  });
  for (let offset = 0; offset < leveled.length; offset += 4096) {
    controller.pushAudio?.(leveled.subarray(offset, Math.min(leveled.length, offset + 4096)), sampleRate);
  }
  controller.stop();

  const match = { word: deps.wakeWord, variants: deps.wakeWordVariants };
  let bareJarvisText: string | null = null;
  let bareJarvisConfirmed = false;
  for (const candidate of candidates) {
    const confirmation = await confirmWakeWordCandidate(
      { pcm: candidate, sampleRate },
      (window) => deps.transcribe(window, WHISPER_WAKE_WORD_LANGUAGE, 12),
      match,
      (window) => deps.transcribe(window, WHISPER_DICTATION_LANGUAGE, 12),
    );
    bareJarvisText = confirmation.transcript;
    if (confirmation.confirmed) {
      bareJarvisConfirmed = true;
      break;
    }
  }

  const detected = wakeWordScore >= wakeWordThreshold || bareJarvisConfirmed;
  // Whisper (dictée) seulement après un réveil. La confirmation du « Jarvis »
  // nu, plus haut, reste le seul appel avant ça.
  const transcript = detected ? await deps.transcribe(leveled, WHISPER_DICTATION_LANGUAGE, 96) : '';
  return {
    peak,
    wakeWordScore,
    wakeWordThreshold,
    bareJarvisConfirmed,
    bareJarvisText,
    detected,
    transcript,
    command: commandAfterWakeWord(transcript, match).trim(),
  };
}

/**
 * « Tester la voix » : chaque étape est bornée dans le temps. La première
 * étape en échec est rendue en français ; les étapes qui en dépendent sont
 * marquées « non lancée », le micro est testé quoi qu'il arrive.
 */
export async function runVoiceDiagnostic(
  deps: VoiceDiagnosticDeps,
  onUpdate: (steps: DiagnosticStep[]) => void = () => undefined,
): Promise<VoiceDiagnosticResult> {
  const steps: DiagnosticStep[] = DIAGNOSTIC_STEPS.map((step) => ({ ...step, status: 'pending' }));
  const result: VoiceDiagnosticResult = {
    steps,
    firstFailure: null,
    environment: null,
    runtimeVersion: deps.runtimeVersion(),
    analysis: null,
    startedAt: new Date(),
  };
  const byId = (id: DiagnosticStepId): DiagnosticStep => steps.find((step) => step.id === id)!;
  const publish = (): void => onUpdate(steps.map((step) => ({ ...step })));

  const run = async (
    id: DiagnosticStepId,
    body: (step: DiagnosticStep) => Promise<void>,
    timeoutMs = deps.stepTimeoutMs,
  ): Promise<void> => {
    const step = byId(id);
    const blocker = (DEPENDS_ON[id] ?? []).map(byId).find((dep) => dep.status === 'failed' || dep.status === 'skipped');
    if (blocker) {
      step.status = 'skipped';
      step.summary = `Non lancée : « ${blocker.label} » a échoué.`;
      publish();
      return;
    }
    step.status = 'running';
    publish();
    const startedAt = deps.now();
    try {
      await withTimeout(body(step), timeoutMs);
      if (step.status === 'running') step.status = 'ok';
    } catch (error) {
      step.status = 'failed';
      if (error instanceof StepTimeoutError) {
        step.summary = `Bloquée : aucune réponse après ${Math.round(error.ms / 1000)} s. ${step.summary ?? ''}`.trim();
      } else {
        step.summary = errorText(error);
      }
      result.firstFailure ??= step;
    } finally {
      step.durationMs = deps.now() - startedAt;
      publish();
    }
  };

  await run('disk', async (step) => {
    const report = await deps.assetsReport();
    result.environment = report;
    const problems = report.files.filter((file) => !file.exists || file.size < file.minBytes);
    const total = report.files.reduce((sum, file) => sum + file.size, 0);
    step.details = [
      `Dossier : ${report.root}`,
      ...report.files.map(
        (file) => `${file.host}/${file.path} : ${file.exists ? `${file.size} octets` : 'ABSENT'}`,
      ),
    ];
    if (problems.length > 0) {
      throw new Error(
        `Fichier${problems.length > 1 ? 's' : ''} absent${problems.length > 1 ? 's' : ''} ou tronqué${problems.length > 1 ? 's' : ''} dans ${report.root} : ` +
          problems.map((file) => `${file.host}/${file.path}`).join(', ') +
          '. Réinstalle Jarvis.',
      );
    }
    step.summary = `${report.files.length} fichiers présents (${formatBytes(total)}).`;
  });

  await run('protocol', async (step) => {
    const expected = new Map(
      (result.environment?.files ?? []).map((file) => [`${file.host}/${file.path}`, file.size]),
    );
    step.details = [];
    let totalBytes = 0;
    for (const asset of REQUIRED_VOICE_ASSETS) {
      const url = voiceAssetUrl(asset.host, asset.path);
      step.summary = `Lecture de ${assetLabel(asset)}…`;
      publish();
      let response: Response;
      try {
        response = await deps.fetch(url);
      } catch (error) {
        step.details.push(`${url} → échec réseau (${errorText(error)})`);
        throw new Error(`${assetLabel(asset)} : lecture impossible par jarvis-oww (${errorText(error)}).`);
      }
      const body = await readBody(response);
      const type = response.headers.get('content-type') ?? '?';
      step.details.push(`${url} → HTTP ${response.status}, ${type}, ${body.byteLength} octets`);
      if (!response.ok) {
        throw new Error(`${assetLabel(asset)} : HTTP ${response.status} par jarvis-oww.`);
      }
      const onDisk = expected.get(assetLabel(asset));
      if (onDisk !== undefined && onDisk !== body.byteLength) {
        throw new Error(
          `${assetLabel(asset)} : ${body.byteLength} octets reçus au lieu de ${onDisk} sur le disque.`,
        );
      }
      if (asset.kind === 'json') {
        try {
          JSON.parse(new TextDecoder().decode(body));
        } catch {
          throw new Error(`${assetLabel(asset)} : JSON illisible.`);
        }
      }
      if (asset.kind === 'wasm' && type !== 'application/wasm') {
        throw new Error(`${assetLabel(asset)} : servi en « ${type} » au lieu de application/wasm.`);
      }
      totalBytes += body.byteLength;
    }
    step.summary = `${REQUIRED_VOICE_ASSETS.length} fichiers lus (${formatBytes(totalBytes)}).`;
  });

  await run('runtime', async (step) => {
    await deps.startRuntime();
    step.summary = `onnxruntime-web ${deps.runtimeVersion()} démarré (1 thread).`;
  });

  await run('wakeword', async (step) => {
    const score = await deps.scoreWakeWord(new Float32Array(16000 * 2), 16000);
    step.summary = `Modèles chargés ; score sur 2 s de silence : ${score.toFixed(3)} (seuil ${openWakeWordSensitivityToThreshold(deps.sensitivity).toFixed(2)}).`;
    if (score >= openWakeWordSensitivityToThreshold(deps.sensitivity)) {
      step.status = 'warning';
      step.summary += ' Le silence dépasse le seuil : baisse la sensibilité.';
    }
  });

  await run(
    'whisper',
    async (step) => {
      const startedAt = deps.now();
      await deps.loadWhisper();
      step.summary = `Whisper prêt en ${((deps.now() - startedAt) / 1000).toFixed(1).replace('.', ',')} s.`;
    },
    deps.whisperTimeoutMs,
  );

  await run('inference', async (step) => {
    const startedAt = deps.now();
    await deps.transcribe(syntheticProbe(), WHISPER_DICTATION_LANGUAGE, 4);
    step.summary = `Encodeur et décodeur ont répondu en ${((deps.now() - startedAt) / 1000).toFixed(1).replace('.', ',')} s.`;
  });

  let microphone: MicrophoneProbe | null = null;
  await run('microphone', async (step) => {
    microphone = await deps.openMicrophone();
    step.summary = `Micro ouvert : ${microphone.label || 'périphérique par défaut'}.`;
  });

  try {
    await run(
      'live',
      async (step) => {
        const mic = microphone!;
        deps.onPrompt?.(
          `Parle maintenant dans « ${mic.label || 'le micro choisi'} » : « Jarvis, quelle heure est-il ? »`,
        );
        const audio = await mic.record(deps.liveRecordMs);
        deps.onPrompt?.(null);
        const analysis = await analyzeRecording(audio, deps);
        result.analysis = analysis;
        step.details = [`Niveau crête : ${analysis.peak.toFixed(3)}`, ...describeAnalysis(analysis)];
        if (analysis.peak < 0.02) {
          step.status = 'warning';
          step.summary = 'Aucune voix entendue : vérifie le micro choisi et son volume.';
          return;
        }
        step.summary = `${analysis.detected ? 'Mot de réveil reconnu' : 'Mot de réveil non reconnu'} · « ${analysis.transcript || '(rien)'} »`;
        if (!analysis.detected) step.status = 'warning';
      },
      deps.liveRecordMs + deps.whisperTimeoutMs,
    );
  } finally {
    deps.onPrompt?.(null);
    (microphone as MicrophoneProbe | null)?.close();
  }

  return result;
}

const STATUS_TEXT: Record<DiagnosticStatus, string> = {
  pending: 'en attente',
  running: 'en cours',
  ok: 'OK',
  warning: 'à vérifier',
  failed: 'ÉCHEC',
  skipped: 'non lancée',
};

export function describeAnalysis(analysis: RecordingAnalysis): string[] {
  return [
    ...(analysis.peak >= 1
      ? ['Crête ≥ 1 : signal atténué avant openWakeWord et Whisper (même forme, sous le plein échelle).']
      : []),
    `Score openWakeWord max : ${analysis.wakeWordScore.toFixed(3)} (seuil ${analysis.wakeWordThreshold.toFixed(2)})`,
    `« Jarvis » nu confirmé par Whisper : ${analysis.bareJarvisConfirmed ? 'oui' : 'non'}${analysis.bareJarvisText !== null ? ` (« ${analysis.bareJarvisText} »)` : ''}`,
    `Réveil : ${analysis.detected ? 'oui' : 'non'}`,
    `Transcription : « ${analysis.transcript} »`,
    analysis.detected
      ? `Commande envoyée : ${analysis.command ? `« ${analysis.command} »` : 'aucune (mot de réveil seul)'}`
      : 'Commande envoyée : aucune (pas de réveil)',
  ];
}

/** Texte copié par « Copier le détail » : ce que l'utilisateur renvoie. */
export function formatDiagnosticReport(
  result: VoiceDiagnosticResult,
  files: Array<{ name: string; durationS: number; analysis: RecordingAnalysis }> = [],
): string {
  const env = result.environment;
  const lines = [
    'Jarvis — Tester la voix',
    `Date : ${result.startedAt.toISOString()}`,
    env
      ? `Jarvis ${env.appVersion} · ${env.platform} ${env.arch} · Electron ${env.electron} · Chrome ${env.chrome} · ${env.packaged ? 'installé' : 'développement'}`
      : 'Environnement : inconnu',
    `onnxruntime-web ${result.runtimeVersion}`,
    result.firstFailure
      ? `Première étape en échec : ${result.firstFailure.label} — ${result.firstFailure.summary ?? ''}`
      : 'Aucune étape en échec.',
    '',
  ];
  result.steps.forEach((step, index) => {
    const duration = step.durationMs !== undefined ? ` (${(step.durationMs / 1000).toFixed(1)} s)` : '';
    lines.push(`${index + 1}. ${step.label} — ${STATUS_TEXT[step.status]}${duration}${step.summary ? ` — ${step.summary}` : ''}`);
    for (const detail of step.details ?? []) lines.push(`   ${detail}`);
  });
  for (const file of files) {
    lines.push('', `Fichier « ${file.name} » (${file.durationS.toFixed(1)} s)`);
    for (const detail of describeAnalysis(file.analysis)) lines.push(`   ${detail}`);
  }
  return lines.join('\n');
}
