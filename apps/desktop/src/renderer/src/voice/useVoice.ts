import {
  COMMAND_STARTED_SPEECH_MS,
  ConversationSession,
  END_OF_SPEECH_RMS,
  EndOfSpeechDetector,
  captureFailureText,
  splitWakeWordWindow,
  type Settings,
  type SpeechToTextProvider,
  type TextToSpeechController,
  type TextToSpeechProvider,
  type VoiceSettings,
  type WakeWordDetectorConfig,
  type WakeWordEngine,
  type WakeWordEngineController,
  wrapWakeWordEngineWithVerifier,
} from '@jarvis/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeRms, listMicrophones, microphone } from './audioCapture';
import type { MicrophoneStatus } from './microphone';
import { createSttRegistry, createTtsRegistry, createWakeWordEngine } from './registries';
import { startWakeWhenWindowVisible } from './voiceStartup';
import { wakeLearningSession } from './wakeLearning/session';
import { describeWhisperProgress, getWhisperPipeline, subscribeWhisperProgress } from './whisper/pipelineLoader';

export type VoiceState = 'idle' | 'sleeping' | 'listening' | 'speaking' | 'error';

const SILENCE_RMS = END_OF_SPEECH_RMS;
const MAX_UTTERANCE_MS = 12_000;
const LEVEL_SMOOTHING = 0.35;
/** Vumètre hors captation (réglages) : 4 rafraîchissements par seconde suffisent. */
const IDLE_LEVEL_INTERVAL_MS = 250;
/** Une erreur de Whisper, de la synthèse ou du réveil s'efface d'elle-même. */
const VOICE_ERROR_TTL_MS = 20_000;

export interface UseVoiceOptions {
  settings: Settings | null;
  /** Vrai si une clé OpenAI est configurée côté main pour la voix (jamais la clé elle-même). */
  voiceKeyConfigured: boolean;
  /** Envoie un texte dans la boucle de conversation, exactement comme un message tapé. */
  onTranscript: (text: string) => void;
}

export interface UseVoiceResult {
  state: VoiceState;
  level: number;
  liveTranscript: string;
  /** État du micro : périphérique ouvert, durées, dernier échec exact. */
  mic: MicrophoneStatus;
  /** Échec du micro seulement (nom exact de l'erreur + prochaine étape), sinon `null`. */
  micError: string | null;
  /** Information sur le micro qui n'est pas une panne (repli sur le défaut, piste coupée). */
  micNotice: string | null;
  /** Erreur de Whisper, de la synthèse vocale ou du mot de réveil. Jamais affichée comme « micro ». */
  voiceError: string | null;
  /**
   * Statut de chargement d'un modèle Whisper local (téléchargement en
   * cours, prêt, erreur), affiché en priorité par `VoiceBar` : le premier
   * usage peut prendre du temps (quelques dizaines de Mo à récupérer une
   * seule fois), sans ce retour la commande vocale semblerait ne rien
   * faire pendant ce temps.
   */
  whisperStatus: string | null;
  speakingText: string | null;
  /** Coupe la réponse vocale en cours. */
  stopSpeaking: () => void;
  /** Lit un texte à voix haute avec le moteur configuré (branché sur la fin d'un tour de conversation). */
  speak: (text: string) => void;
  /**
   * Fin du tour de l'agent. En discussion (après un réveil), garde le micro
   * ouvert après la synthèse ou le texte seul si elle est coupée.
   */
  noteAssistantReply: (text: string) => void;
  /** Vrai tant que l'utilisateur n'a pas fermé la session vocale (après « Jarvis »). */
  inVoiceConversation: boolean;
  /** Ferme la session d'écoute et revient en veille (mot de réveil à nouveau requis). */
  endConversation: () => void;
  listMicrophones: typeof listMicrophones;
  /** Nouvelle tentative d'ouverture du micro. */
  retryMicrophone: () => void;
}

function buildWakeWordDetectorConfig(
  voice: VoiceSettings | undefined,
): WakeWordDetectorConfig | null {
  const profiles = voice?.wakeWordProfiles ?? [];
  if (profiles.length === 0) return null;
  return {
    profiles: profiles.map((envelope) => ({ envelope })),
    matchStrategy: voice?.wakeWordMatchStrategy ?? 'best',
  };
}

export function microphoneNotice(status: MicrophoneStatus): string | null {
  if (status.phase !== 'open') return null;
  if (status.muted) return `« ${status.label || 'Le micro'} » est coupé par le système (mute).`;
  if (status.usingFallback) {
    return `Le micro choisi n’est pas branché : écoute sur l’entrée par défaut de Windows${status.label ? ` (« ${status.label} »)` : ''}. Il sera repris dès qu’il revient.`;
  }
  return null;
}

export function microphoneErrorText(status: MicrophoneStatus): string | null {
  if (status.phase === 'off' || !status.failure) return null;
  const text = captureFailureText(status.failure);
  if (status.phase === 'open') return `${text} L’écoute continue sur « ${status.label || 'le micro précédent'} ».`;
  return text;
}

export function useVoice({
  settings,
  voiceKeyConfigured,
  onTranscript,
}: UseVoiceOptions): UseVoiceResult {
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [voiceError, setVoiceErrorState] = useState<string | null>(null);
  const [whisperStatus, setWhisperStatus] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [inVoiceConversation, setInVoiceConversation] = useState(false);
  const [mic, setMic] = useState<MicrophoneStatus>(() => microphone.getStatus());

  const sttRegistry = useMemo(() => createSttRegistry(), []);
  const ttsRegistry = useMemo(() => createTtsRegistry(), []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const voiceKeyConfiguredRef = useRef(voiceKeyConfigured);
  voiceKeyConfiguredRef.current = voiceKeyConfigured;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stateRef = useRef<VoiceState>('idle');
  const wakeWordControllerRef = useRef<WakeWordEngineController | null>(null);
  const wakeWordOwnsCaptureRef = useRef(false);
  const sttControllerRef = useRef<ReturnType<SpeechToTextProvider['start']> | null>(null);
  const sttOwnsCaptureRef = useRef(false);
  /**
   * Renseigné quand l'audio du mot de réveil a été transmis en préfixe à la
   * dictée (voir `beginListening`) : indique à `finalizeTranscript` qu'il
   * faut retirer le mot de réveil du texte transcrit avant de le traiter
   * comme une commande.
   */
  const pendingWakeWordStripRef = useRef<{ word: string; variants: string[] } | null>(null);
  const endOfSpeechRef = useRef<EndOfSpeechDetector | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const ttsControllerRef = useRef<TextToSpeechController | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const voiceErrorTimerRef = useRef<number | null>(null);
  /** Audio reçu depuis l'ouverture, en secondes : horloge des mesures de latence. */
  const audioClockRef = useRef(0);
  const lastVoiceClockRef = useRef(0);
  const timingRef = useRef<{ wakeAt: number; endAt: number | null } | null>(null);
  const levelRef = useRef(0);
  const levelShownAtRef = useRef(0);
  const conversationRef = useRef(new ConversationSession());
  const syncVoiceConversation = useCallback(() => {
    setInVoiceConversation(conversationRef.current.showListening);
  }, []);
  /** Transcription en cours : les trames suivantes ne relancent pas la fin de parole. */
  const closingRef = useRef(false);
  const hotTailRef = useRef(new FrameTail());
  const ttsGenerationRef = useRef(0);

  useEffect(() => microphone.subscribe(setMic), []);

  const setVoiceError = useCallback((message: string | null) => {
    if (voiceErrorTimerRef.current !== null) window.clearTimeout(voiceErrorTimerRef.current);
    voiceErrorTimerRef.current = null;
    setVoiceErrorState(message);
    if (message) {
      voiceErrorTimerRef.current = window.setTimeout(() => setVoiceErrorState(null), VOICE_ERROR_TTL_MS);
    }
  }, []);

  const setVoiceState = useCallback((next: VoiceState) => {
    const wasListening = stateRef.current === 'listening';
    stateRef.current = next;
    setState(next);
    if (wasListening !== (next === 'listening')) window.jarvis.voice.setListening(next === 'listening');
  }, []);

  const resolveStt = useCallback((): SpeechToTextProvider => {
    const current = settingsRef.current;
    const requestedId = current?.voice.sttProvider ?? 'local-whisper';
    const descriptor = sttRegistry.describe(requestedId);
    const eligible = descriptor && (!descriptor.requiresApiKey || voiceKeyConfiguredRef.current);
    return sttRegistry.create({
      provider: eligible ? requestedId : 'local-whisper',
      apiKey: voiceKeyConfiguredRef.current ? 'configured' : '',
    });
  }, [sttRegistry]);

  const resolveTts = useCallback((): TextToSpeechProvider => {
    const current = settingsRef.current;
    const requestedId = current?.voice.ttsProvider ?? 'browser-local';
    const descriptor = ttsRegistry.describe(requestedId);
    const eligible = descriptor && (!descriptor.requiresApiKey || voiceKeyConfiguredRef.current);
    return ttsRegistry.create({
      provider: eligible ? requestedId : 'browser-local',
      apiKey: voiceKeyConfiguredRef.current ? 'configured' : '',
    });
  }, [ttsRegistry]);

  const resolveWakeWordEngine = useCallback((): WakeWordEngine => {
    const voice = settingsRef.current?.voice;
    const engine = createWakeWordEngine({
      keyword: voice?.wakeWord ?? 'jarvis',
      detectorConfig: buildWakeWordDetectorConfig(voice),
      sensitivity: voice?.wakeWordSensitivity ?? 0.7,
      variants: voice?.wakeWordVariants ?? [],
    });
    // Sans apprentissage : le détecteur tel quel (0.4.16).
    if (!voice?.wakeLearning) return engine;
    return wrapWakeWordEngineWithVerifier(engine, {
      getModel: () => wakeLearningSession.model,
      features: wakeLearningSession.computeFeatures,
      onCandidate: wakeLearningSession.onCandidate,
      log: (line) => microphoneLog(`[apprentissage] ${line}`),
    });
  }, []);

  const backToSleepOrIdle = useCallback(() => {
    setVoiceState(settingsRef.current?.voice.enabled ? 'sleeping' : 'idle');
  }, [setVoiceState]);

  const clearMaxDurationTimer = useCallback(() => {
    if (maxDurationTimerRef.current !== null) {
      window.clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const audioMs = useCallback(() => audioClockRef.current * 1000, []);

  const wakeMatch = useCallback(() => {
    const voice = settingsRef.current?.voice;
    return { word: voice?.wakeWord ?? 'jarvis', variants: voice?.wakeWordVariants ?? [] };
  }, []);

  const stopPlayback = useCallback(() => {
    ttsControllerRef.current?.stop();
    ttsControllerRef.current = null;
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }
    setSpeakingText(null);
  }, []);

  const returnToStandby = useCallback(() => {
    closingRef.current = false;
    clearMaxDurationTimer();
    sttControllerRef.current?.abort();
    sttControllerRef.current = null;
    endOfSpeechRef.current = null;
    hotTailRef.current.clear();
    pendingWakeWordStripRef.current = null;
    conversationRef.current.standby();
    syncVoiceConversation();
    setLiveTranscript('');
    backToSleepOrIdle();
  }, [backToSleepOrIdle, clearMaxDurationTimer, syncVoiceConversation]);

  const armHot = useCallback(() => {
    closingRef.current = false;
    clearMaxDurationTimer();
    sttControllerRef.current = null;
    endOfSpeechRef.current = new EndOfSpeechDetector();
    hotTailRef.current.clear();
    setVoiceState('listening');
  }, [clearMaxDurationTimer, setVoiceState]);

  const finalizeTranscript = useCallback(
    (text: string, failed = false) => {
      clearMaxDurationTimer();
      sttControllerRef.current = null;
      setLiveTranscript('');
      pendingWakeWordStripRef.current = null;
      closingRef.current = false;
      const decision = conversationRef.current.deliver(text, wakeMatch());
      const sent = decision.kind === 'send' ? decision.text : '';
      const timing = timingRef.current;
      timingRef.current = null;
      if (timing) {
        const now = performance.now();
        microphoneLog(
          `[latence] texte prêt · audio ${audioClockRef.current.toFixed(2)} s · ${Math.round(now - timing.wakeAt)} ms après le réveil` +
            (timing.endAt !== null ? ` · ${Math.round(now - timing.endAt)} ms après la fin de parole` : ''),
        );
      }
      microphoneLog(
        `dictée terminée : ${decision.kind === 'send' ? `commande de ${sent.length} caractères envoyée` : decision.kind === 'stop' ? 'arrêt, retour en veille' : 'rien à envoyer'}`,
      );
      if (settingsRef.current?.voice.wakeLearning) {
        wakeLearningSession.outcome(decision.kind === 'stop' ? 'stop' : sent, failed);
      }
      if (decision.kind === 'send') {
        onTranscriptRef.current(sent);
        armHot();
        syncVoiceConversation();
        return;
      }
      if (decision.kind === 'stop') {
        ttsGenerationRef.current += 1;
        stopPlayback();
        returnToStandby();
        return;
      }
      if (conversationRef.current.phase === 'standby') {
        returnToStandby();
        return;
      }
      armHot();
      syncVoiceConversation();
    },
    [armHot, clearMaxDurationTimer, returnToStandby, stopPlayback, wakeMatch, syncVoiceConversation],
  );

  const finishListening = useCallback(() => {
    if (closingRef.current) return;
    const session = conversationRef.current;
    if (session.phase === 'command' && audioMs() < session.graceDeadline) return;
    closingRef.current = true;
    clearMaxDurationTimer();
    if (timingRef.current && timingRef.current.endAt === null) {
      timingRef.current.endAt = performance.now();
      microphoneLog(
        `[latence] fin de parole · audio ${audioClockRef.current.toFixed(2)} s · dernière parole ${Math.round((audioClockRef.current - lastVoiceClockRef.current) * 1000)} ms avant · ${Math.round(timingRef.current.endAt - timingRef.current.wakeAt)} ms après le réveil`,
      );
    }
    sttControllerRef.current?.stop();
  }, [audioMs, clearMaxDurationTimer]);

  const beginListening = useCallback(() => {
    if (conversationRef.current.acceptWake(audioMs()) !== 'started') return;
    syncVoiceConversation();
    closingRef.current = false;
    microphoneLog(
      `[latence] réveil · audio ${audioClockRef.current.toFixed(2)} s · dernière parole ${Math.round((audioClockRef.current - lastVoiceClockRef.current) * 1000)} ms avant`,
    );
    timingRef.current = { wakeAt: performance.now(), endAt: null };
    setVoiceState('listening');
    setLiveTranscript('');
    const endOfSpeech = new EndOfSpeechDetector();
    endOfSpeechRef.current = endOfSpeech;

    const provider = resolveStt();
    sttOwnsCaptureRef.current = provider.managesOwnCapture;
    // Le premier réveil charge Whisper pendant que l'utilisateur parle ; ensuite il reste prêt.
    if (provider.id === 'local-whisper') void getWhisperPipeline().catch(() => undefined);

    const controller = provider.start(
      {
        onPartial: (text) => setLiveTranscript(text),
        onFinal: (text) => finalizeTranscript(text),
        onError: (message) => {
          setVoiceError(message);
          finalizeTranscript('', true);
        },
      },
      { language: 'fr-FR' },
    );
    sttControllerRef.current = controller;

    // Préfixe la dictée avec l'audio qui a déclenché le mot de réveil, quand
    // le moteur le conserve : Whisper transcrit
    // ainsi l'énoncé complet — mot de réveil compris — plutôt que l'audio
    // coupé pile à l'instant de la détection, ce qui lui donne plus de
    // contexte (meilleure reconnaissance du mot de réveil lui-même) et évite
    // de risquer d'amputer l'attaque du mot suivant. Le mot de réveil est
    // retiré ensuite du texte obtenu, jamais de l'audio — voir
    // `finalizeTranscript` et `stripLeadingWakeWord`.
    const lastWindow = wakeWordControllerRef.current?.getLastAnalyzedWindow?.();
    if (lastWindow && !provider.managesOwnCapture) {
      const { prefix, command } = splitWakeWordWindow(lastWindow);
      endOfSpeech.primeWithCommandAudio(command, lastWindow.sampleRate);
      controller.pushAudio?.(prefix, lastWindow.sampleRate);
      controller.markPrefixEnd?.();
      if (command.length > 0) controller.pushAudio?.(command, lastWindow.sampleRate);
      const voice = settingsRef.current?.voice;
      pendingWakeWordStripRef.current = {
        word: voice?.wakeWord ?? 'jarvis',
        variants: voice?.wakeWordVariants ?? [],
      };
    } else {
      pendingWakeWordStripRef.current = null;
    }

    maxDurationTimerRef.current = window.setTimeout(() => finishListening(), MAX_UTTERANCE_MS);
  }, [audioMs, finalizeTranscript, finishListening, resolveStt, setVoiceError, setVoiceState, syncVoiceConversation]);

  const beginFollowUp = useCallback(
    (frames: Float32Array[], sampleRate: number) => {
      closingRef.current = false;
      setVoiceState('listening');
      setLiveTranscript('');
      const provider = resolveStt();
      sttOwnsCaptureRef.current = provider.managesOwnCapture;
      if (provider.id === 'local-whisper') void getWhisperPipeline().catch(() => undefined);
      const controller = provider.start(
        {
          onPartial: (text) => setLiveTranscript(text),
          onFinal: (text) => finalizeTranscript(text),
          onError: (message) => {
            setVoiceError(message);
            finalizeTranscript('', true);
          },
        },
        { language: 'fr-FR' },
      );
      sttControllerRef.current = controller;
      pendingWakeWordStripRef.current = null;
      if (!provider.managesOwnCapture) {
        for (const frame of frames) controller.pushAudio?.(frame, sampleRate);
      }
      maxDurationTimerRef.current = window.setTimeout(() => finishListening(), MAX_UTTERANCE_MS);
    },
    [finalizeTranscript, finishListening, resolveStt, setVoiceError, setVoiceState],
  );

  const startWakeWordEngine = useCallback(() => {
    wakeWordControllerRef.current?.stop();
    const engine = resolveWakeWordEngine();
    wakeWordOwnsCaptureRef.current = engine.managesOwnCapture;
    microphoneLog('moteur du mot de réveil démarré');
    wakeWordControllerRef.current = engine.start({
      onDetected: () => {
        if (!wakeLearningSession.enrolling) beginListening();
      },
      onScore: () => microphone.markWakeScore(),
      onError: (message) => setVoiceError(message),
    });
  }, [beginListening, resolveWakeWordEngine, setVoiceError]);

  const handleFrame = useCallback(
    (frame: Float32Array, sampleRate: number) => {
      const rms = computeRms(frame);
      audioClockRef.current += frame.length / sampleRate;
      if (rms >= SILENCE_RMS) lastVoiceClockRef.current = audioClockRef.current;
      const smoothed = levelRef.current + (rms - levelRef.current) * LEVEL_SMOOTHING;
      levelRef.current = smoothed;
      const listening = stateRef.current === 'listening';
      // Hors captation, le niveau ne sert qu'au vumètre des réglages : pas besoin de 16 rendus par seconde.
      const now = performance.now();
      if (listening || now - levelShownAtRef.current >= IDLE_LEVEL_INTERVAL_MS) {
        levelShownAtRef.current = now;
        setLevel(smoothed);
      }
      if (listening) window.jarvis.voice.sendLevel(smoothed);

      if (stateRef.current === 'sleeping') {
        if (!wakeWordOwnsCaptureRef.current)
          wakeWordControllerRef.current?.pushAudio?.(frame, sampleRate);
        if (settingsRef.current?.voice.wakeLearning && !wakeLearningSession.enrolling) {
          wakeLearningSession.pushIdleAudio(frame, sampleRate);
        }
        return;
      }

      if (stateRef.current === 'listening') {
        const session = conversationRef.current;
        const at = audioMs();

        if (session.phase === 'hot') {
          hotTailRef.current.push(frame, sampleRate);
          const detector = endOfSpeechRef.current ?? new EndOfSpeechDetector();
          endOfSpeechRef.current = detector;
          const started = detector.commandStarted;
          detector.pushPcm(frame, sampleRate);
          if (!started && detector.commandStarted) {
            const decision = session.noteHotSpeech(at, COMMAND_STARTED_SPEECH_MS);
            if (decision === 'capture') {
              ttsGenerationRef.current += 1;
              stopPlayback();
              beginFollowUp(hotTailRef.current.drain(), sampleRate);
            }
          }
          return;
        }

        if (closingRef.current) return;
        if (session.phase !== 'command' && session.phase !== 'follow-up') return;
        if (!sttOwnsCaptureRef.current) sttControllerRef.current?.pushAudio?.(frame, sampleRate);
        const ended = endOfSpeechRef.current?.pushPcm(frame, sampleRate) ?? false;
        const decision = session.phase === 'command' ? session.pollCommand(at, ended) : ended ? 'close' : 'hold';
        if (decision === 'close') finishListening();
      }
    },
    [audioMs, beginFollowUp, finishListening, returnToStandby, stopPlayback],
  );
  const handleFrameRef = useRef(handleFrame);
  handleFrameRef.current = handleFrame;
  useEffect(() => microphone.onFrame((frame, rate) => handleFrameRef.current(frame, rate)), []);

  const stopEngines = useCallback(() => {
    clearMaxDurationTimer();
    sttControllerRef.current?.abort();
    sttControllerRef.current = null;
    wakeWordControllerRef.current?.stop();
    wakeWordControllerRef.current = null;
    endOfSpeechRef.current = null;
    hotTailRef.current.clear();
    closingRef.current = false;
    conversationRef.current.standby();
    syncVoiceConversation();
    levelRef.current = 0;
    setLevel(0);
    setLiveTranscript('');
  }, [clearMaxDurationTimer, syncVoiceConversation]);

  const endConversation = useCallback(() => {
    ttsGenerationRef.current += 1;
    stopPlayback();
    returnToStandby();
  }, [returnToStandby, stopPlayback]);

  // Le choix du micro est appliqué tout de suite, sans rouvrir le reste.
  useEffect(() => {
    if (!settings) return;
    void microphone.setPreferredDevice(settings.voice.microphoneId);
  }, [settings?.voice.microphoneId]);

  // Écoute permanente : un bail sur le micro partagé, et le moteur du mot de
  // réveil démarré une fois la fenêtre affichée. Une reprise du micro
  // (débranché, changé, pilote relancé) ne redémarre pas le moteur.
  useEffect(() => {
    if (!settings) return;
    if (!settings.voice.enabled) {
      stopEngines();
      setVoiceState('idle');
      return;
    }
    void microphone.setPreferredDevice(settings.voice.microphoneId);
    const release = microphone.acquire('écoute permanente');
    setVoiceState('sleeping');
    const abort = new AbortController();
    void startWakeWhenWindowVisible(
      window.jarvis.window,
      () => {
        if (!abort.signal.aborted) startWakeWordEngine();
      },
      abort.signal,
    ).catch(() => undefined);
    return () => {
      abort.abort();
      stopEngines();
      release();
    };
    // Volontairement limité à l'activation : le micro et la configuration
    // du mot de réveil sont appliqués par les autres effets.
  }, [settings?.voice.enabled]);

  useEffect(() => {
    if (!settings?.voice.enabled || !settings.voice.wakeLearning) return;
    wakeLearningSession.start();
    return () => wakeLearningSession.stop();
  }, [settings?.voice.enabled, settings?.voice.wakeLearning]);

  // Reconfigure le mot de réveil (gabarits, sensibilité, stratégie,
  // variantes) sans redémarrer la capture audio.
  const wakeWordConfigKey = JSON.stringify({
    word: settings?.voice.wakeWord,
    profiles: settings?.voice.wakeWordProfiles,
    strategy: settings?.voice.wakeWordMatchStrategy,
    sensitivity: settings?.voice.wakeWordSensitivity,
    variants: settings?.voice.wakeWordVariants,
    learning: settings?.voice.wakeLearning,
  });
  useEffect(() => {
    if (stateRef.current === 'sleeping' && wakeWordControllerRef.current) startWakeWordEngine();
    // Dépendance volontairement limitée à la clé sérialisée ci-dessus.
  }, [wakeWordConfigKey]);

  const stopSpeaking = useCallback(() => {
    ttsGenerationRef.current += 1;
    stopPlayback();
    const session = conversationRef.current;
    if (session.showListening) {
      if (session.phase === 'hot') {
        session.replyFinished(audioMs());
      }
      if (stateRef.current !== 'listening') setVoiceState('listening');
      return;
    }
    if (stateRef.current === 'speaking') backToSleepOrIdle();
  }, [audioMs, backToSleepOrIdle, setVoiceState, stopPlayback]);

  const playClip = useCallback((data: Uint8Array, mimeType: string, onEnd: () => void) => {
    const blob = new Blob([data.buffer as ArrayBuffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioElementRef.current = audio;
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      onEnd();
    });
    void audio.play().catch(() => {
      URL.revokeObjectURL(url);
      onEnd();
    });
  }, []);

  const speak = useCallback(
    (text: string) => {
      const current = settingsRef.current;
      if (!current?.voice.ttsEnabled || !text.trim()) return;
      stopSpeaking();

      const provider = resolveTts();
      setVoiceState('speaking');
      setSpeakingText(text);

      const controller = provider.speak(
        text,
        {
          onAudio: (clip) => playClip(clip.data, clip.mimeType, () => backToSleepOrIdle()),
          onEnd: () => {
            if (provider.managesOwnPlayback) backToSleepOrIdle();
          },
          onError: (message) => {
            setVoiceError(message);
            backToSleepOrIdle();
          },
        },
        { voice: current.voice.ttsVoice || undefined },
      );
      ttsControllerRef.current = controller;
    },
    [backToSleepOrIdle, playClip, resolveTts, setVoiceError, setVoiceState, stopSpeaking],
  );

  const speakInConversation = useCallback(
    (text: string) => {
      const current = settingsRef.current;
      if (!current) return;
      stopPlayback();
      const generation = (ttsGenerationRef.current += 1);
      const provider = resolveTts();
      setSpeakingText(text);
      if (stateRef.current !== 'listening') setVoiceState('listening');

      const finished = (): void => {
        if (generation !== ttsGenerationRef.current) return;
        setSpeakingText(null);
        const session = conversationRef.current;
        if (session.phase !== 'hot') return;
        session.replyFinished(audioMs());
      };

      const controller = provider.speak(
        text,
        {
          onAudio: (clip) => playClip(clip.data, clip.mimeType, finished),
          onEnd: () => {
            if (provider.managesOwnPlayback) finished();
          },
          onError: (message) => {
            setVoiceError(message);
            finished();
          },
        },
        { voice: current.voice.ttsVoice || undefined },
      );
      ttsControllerRef.current = controller;
    },
    [audioMs, playClip, resolveTts, setVoiceError, setVoiceState, stopPlayback],
  );

  const noteAssistantReply = useCallback(
    (text: string) => {
      const session = conversationRef.current;
      if (!session.showListening || session.phase === 'command' || session.phase === 'follow-up') {
        if (!session.showListening) speak(text);
        return;
      }
      const current = settingsRef.current;
      if (!current?.voice.ttsEnabled || !text.trim()) {
        session.replyFinished(audioMs());
        return;
      }
      speakInConversation(text);
    },
    [audioMs, speak, speakInConversation],
  );

  useEffect(
    () => () => {
      stopEngines();
      if (voiceErrorTimerRef.current !== null) window.clearTimeout(voiceErrorTimerRef.current);
    },
    [stopEngines],
  );

  // Abonnement global au chargement des modèles Whisper (dictée et mot de
  // réveil partagent le même mécanisme) : le badge « prêt » disparaît après
  // un court délai, l'erreur reste affichée jusqu'au prochain événement.
  useEffect(() => {
    let clearTimer: number | null = null;
    return subscribeWhisperProgress((info) => {
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      setWhisperStatus(describeWhisperProgress(info));
      if (info.status === 'ready') {
        clearTimer = window.setTimeout(() => setWhisperStatus(null), 4000);
      }
    });
  }, []);

  const retryMicrophone = useCallback(() => {
    void microphone.retry();
  }, []);

  const enabled = settings?.voice.enabled ?? false;
  const effectiveState: VoiceState = enabled && mic.phase === 'error' ? 'error' : state;

  return {
    state: effectiveState,
    level: mic.phase === 'open' ? level : 0,
    liveTranscript,
    mic,
    micError: enabled ? microphoneErrorText(mic) : null,
    micNotice: enabled ? microphoneNotice(mic) : null,
    voiceError,
    whisperStatus,
    speakingText,
    stopSpeaking,
    speak,
    noteAssistantReply,
    inVoiceConversation,
    endConversation,
    listMicrophones,
    retryMicrophone,
  };
}

/** Dernières secondes du micro chaud, pour ne pas couper l'attaque d'un suivi. */
class FrameTail {
  private chunks: Float32Array[] = [];
  private samples = 0;

  push(frame: Float32Array, sampleRate: number): void {
    this.chunks.push(frame);
    this.samples += frame.length;
    const max = Math.round(sampleRate * 2);
    while (this.chunks.length > 1 && this.samples - this.chunks[0]!.length >= max) {
      this.samples -= this.chunks.shift()!.length;
    }
  }

  drain(): Float32Array[] {
    const chunks = this.chunks;
    this.chunks = [];
    this.samples = 0;
    return chunks;
  }

  clear(): void {
    this.chunks = [];
    this.samples = 0;
  }
}

function microphoneLog(line: string): void {
  try {
    window.jarvis?.voice?.log?.(`[voix] ${line}`);
  } catch {
    // Journal seulement.
  }
}
