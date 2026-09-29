import {
  commandAfterWakeWord,
  splitWakeWordWindow,
  type Settings,
  type SpeechToTextProvider,
  type TextToSpeechController,
  type TextToSpeechProvider,
  type VoiceSettings,
  type WakeWordDetectorConfig,
  type WakeWordEngine,
  type WakeWordEngineController,
} from '@jarvis/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeRms,
  listMicrophones,
  startAudioCapture,
  type AudioCaptureHandle,
} from './audioCapture';
import { createSttRegistry, createTtsRegistry, createWakeWordEngine } from './registries';
import { describeWhisperProgress, getWhisperPipeline, subscribeWhisperProgress } from './whisper/pipelineLoader';

export type VoiceState = 'idle' | 'sleeping' | 'listening' | 'speaking' | 'error';

const SILENCE_RMS = 0.012;
const SILENCE_MS = 900;
const MAX_UTTERANCE_MS = 12_000;
const LEVEL_SMOOTHING = 0.35;

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
  micError: string | null;
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
  listMicrophones: typeof listMicrophones;
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

export function useVoice({
  settings,
  voiceKeyConfigured,
  onTranscript,
}: UseVoiceOptions): UseVoiceResult {
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [whisperStatus, setWhisperStatus] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);

  const sttRegistry = useMemo(() => createSttRegistry(), []);
  const ttsRegistry = useMemo(() => createTtsRegistry(), []);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const voiceKeyConfiguredRef = useRef(voiceKeyConfigured);
  voiceKeyConfiguredRef.current = voiceKeyConfigured;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stateRef = useRef<VoiceState>('idle');
  const captureRef = useRef<AudioCaptureHandle | null>(null);
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
  const silenceMsRef = useRef<number | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const ttsControllerRef = useRef<TextToSpeechController | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
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
    return createWakeWordEngine({
      keyword: voice?.wakeWord ?? 'jarvis',
      detectorConfig: buildWakeWordDetectorConfig(voice),
      sensitivity: voice?.wakeWordSensitivity ?? 0.7,
      variants: voice?.wakeWordVariants ?? [],
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

  const finalizeTranscript = useCallback(
    (text: string) => {
      clearMaxDurationTimer();
      sttControllerRef.current = null;
      setLiveTranscript('');
      const pendingStrip = pendingWakeWordStripRef.current;
      pendingWakeWordStripRef.current = null;
      const command = pendingStrip ? commandAfterWakeWord(text, pendingStrip) : text;
      const trimmed = command.trim();
      if (trimmed) onTranscriptRef.current(trimmed);
      backToSleepOrIdle();
    },
    [backToSleepOrIdle, clearMaxDurationTimer],
  );

  const finishListening = useCallback(() => {
    clearMaxDurationTimer();
    sttControllerRef.current?.stop();
  }, [clearMaxDurationTimer]);

  const beginListening = useCallback(() => {
    if (stateRef.current !== 'sleeping') return;
    setVoiceState('listening');
    setLiveTranscript('');
    silenceMsRef.current = null;

    const provider = resolveStt();
    sttOwnsCaptureRef.current = provider.managesOwnCapture;

    const controller = provider.start(
      {
        onPartial: (text) => setLiveTranscript(text),
        onFinal: (text) => finalizeTranscript(text),
        onError: (message) => {
          setMicError(message);
          finalizeTranscript('');
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
  }, [finalizeTranscript, finishListening, resolveStt, setVoiceState]);

  const startWakeWordEngine = useCallback(() => {
    wakeWordControllerRef.current?.stop();
    const engine = resolveWakeWordEngine();
    wakeWordOwnsCaptureRef.current = engine.managesOwnCapture;
    wakeWordControllerRef.current = engine.start({
      onDetected: () => beginListening(),
      onError: (message) => setMicError(message),
    });
  }, [beginListening, resolveWakeWordEngine]);

  const handleFrame = useCallback(
    (frame: Float32Array, sampleRate: number) => {
      const rms = computeRms(frame);
      setLevel((previous) => previous + (rms - previous) * LEVEL_SMOOTHING);

      if (stateRef.current === 'sleeping') {
        if (!wakeWordOwnsCaptureRef.current)
          wakeWordControllerRef.current?.pushAudio?.(frame, sampleRate);
        return;
      }

      if (stateRef.current === 'listening') {
        if (!sttOwnsCaptureRef.current) sttControllerRef.current?.pushAudio?.(frame, sampleRate);

        // Durée mesurée en audio, pas à l'horloge : après une inférence
        // Whisper, les trames retenues arrivent d'un coup.
        if (rms < SILENCE_RMS) {
          silenceMsRef.current = (silenceMsRef.current ?? 0) + (frame.length / sampleRate) * 1000;
          if (silenceMsRef.current > SILENCE_MS) finishListening();
        } else {
          silenceMsRef.current = null;
        }
      }
    },
    [finishListening],
  );

  const stopCapture = useCallback(() => {
    clearMaxDurationTimer();
    sttControllerRef.current?.abort();
    sttControllerRef.current = null;
    wakeWordControllerRef.current?.stop();
    wakeWordControllerRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    setLevel(0);
    setLiveTranscript('');
  }, [clearMaxDurationTimer]);

  // (Re)démarre l'écoute permanente quand elle est activée, ou l'arrête sinon.
  // Ne dépend que du micro et de l'activation : la configuration du mot de
  // réveil est appliquée séparément (voir l'effet suivant) pour ne pas
  // rouvrir le flux audio à chaque changement de réglage vocal.
  useEffect(() => {
    if (!settings) return;
    if (!settings.voice.enabled) {
      stopCapture();
      setVoiceState('idle');
      setMicError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const handle = await startAudioCapture(settings.voice.microphoneId || undefined, {
          onFrame: handleFrame,
          onError: (message) => setMicError(message),
        });
        if (cancelled) {
          handle.stop();
          return;
        }
        captureRef.current = handle;
        setMicError(null);
        setVoiceState('sleeping');
        startWakeWordEngine();
      } catch (error) {
        if (cancelled) return;
        setMicError(error instanceof Error ? error.message : String(error));
        setVoiceState('error');
      }
    })();

    return () => {
      cancelled = true;
      stopCapture();
    };
    // Volontairement limité à ces deux dépendances : le moteur de mot de
    // réveil est (re)configuré par l'effet suivant, sans rouvrir le micro.
  }, [settings?.voice.enabled, settings?.voice.microphoneId]);

  // Reconfigure le mot de réveil (gabarits, sensibilité, stratégie,
  // variantes) sans redémarrer la capture audio.
  const wakeWordConfigKey = JSON.stringify({
    word: settings?.voice.wakeWord,
    profiles: settings?.voice.wakeWordProfiles,
    strategy: settings?.voice.wakeWordMatchStrategy,
    sensitivity: settings?.voice.wakeWordSensitivity,
    variants: settings?.voice.wakeWordVariants,
  });
  useEffect(() => {
    if (stateRef.current === 'sleeping' && captureRef.current) startWakeWordEngine();
    // Dépendance volontairement limitée à la clé sérialisée ci-dessus.
  }, [wakeWordConfigKey]);

  const stopSpeaking = useCallback(() => {
    ttsControllerRef.current?.stop();
    ttsControllerRef.current = null;
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }
    setSpeakingText(null);
    if (stateRef.current === 'speaking') backToSleepOrIdle();
  }, [backToSleepOrIdle]);

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
            setMicError(message);
            backToSleepOrIdle();
          },
        },
        { voice: current.voice.ttsVoice || undefined },
      );
      ttsControllerRef.current = controller;
    },
    [backToSleepOrIdle, playClip, resolveTts, setVoiceState, stopSpeaking],
  );

  useEffect(() => stopCapture, [stopCapture]);

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

  useEffect(() => {
    if (!settings?.voice.enabled) return;
    void getWhisperPipeline().catch(() => {
      // L'erreur est déjà affichée via subscribeWhisperProgress.
    });
  }, [settings?.voice.enabled]);

  return {
    state,
    level,
    liveTranscript,
    micError,
    whisperStatus,
    speakingText,
    stopSpeaking,
    speak,
    listMicrophones,
  };
}
