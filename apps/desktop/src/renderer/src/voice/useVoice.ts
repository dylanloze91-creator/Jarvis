import type {
  Settings,
  SpeechToTextProvider,
  TextToSpeechController,
  TextToSpeechProvider,
} from '@jarvis/core';
import { WakeWordDetector } from '@jarvis/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeRms,
  listMicrophones,
  startAudioCapture,
  type AudioCaptureHandle,
} from './audioCapture';
import { createSttRegistry, createTtsRegistry } from './registries';

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
  speakingText: string | null;
  /** Injecte un texte comme s'il avait été transcrit, pour démonstration sans microphone. */
  simulate: (text: string) => void;
  /** Coupe la réponse vocale en cours. */
  stopSpeaking: () => void;
  /** Lit un texte à voix haute avec le moteur configuré (branché sur la fin d'un tour de conversation). */
  speak: (text: string) => void;
  listMicrophones: typeof listMicrophones;
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
  const detectorRef = useRef<WakeWordDetector | null>(null);
  const sttControllerRef = useRef<ReturnType<SpeechToTextProvider['start']> | null>(null);
  const sttOwnsCaptureRef = useRef(false);
  const silenceSinceRef = useRef<number | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const ttsControllerRef = useRef<TextToSpeechController | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const resolveStt = useCallback((): SpeechToTextProvider => {
    const current = settingsRef.current;
    const requestedId = current?.voice.sttProvider ?? 'browser-local';
    const descriptor = sttRegistry.describe(requestedId);
    const eligible = descriptor && (!descriptor.requiresApiKey || voiceKeyConfiguredRef.current);
    return sttRegistry.create({
      provider: eligible ? requestedId : 'browser-local',
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
      const trimmed = text.trim();
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
    setVoiceState('listening');
    setLiveTranscript('');
    silenceSinceRef.current = null;

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

    maxDurationTimerRef.current = window.setTimeout(() => finishListening(), MAX_UTTERANCE_MS);
  }, [finalizeTranscript, finishListening, resolveStt, setVoiceState]);

  const handleFrame = useCallback(
    (frame: Float32Array, sampleRate: number) => {
      const rms = computeRms(frame);
      setLevel((previous) => previous + (rms - previous) * LEVEL_SMOOTHING);

      if (stateRef.current === 'sleeping') {
        const detected = detectorRef.current?.pushEnergy(rms) ?? false;
        if (detected) beginListening();
        return;
      }

      if (stateRef.current === 'listening') {
        if (!sttOwnsCaptureRef.current) sttControllerRef.current?.pushAudio?.(frame, sampleRate);

        const now = performance.now();
        if (rms < SILENCE_RMS) {
          if (silenceSinceRef.current === null) silenceSinceRef.current = now;
          else if (now - silenceSinceRef.current > SILENCE_MS) finishListening();
        } else {
          silenceSinceRef.current = null;
        }
      }
    },
    [beginListening, finishListening],
  );

  const stopCapture = useCallback(() => {
    clearMaxDurationTimer();
    sttControllerRef.current?.abort();
    sttControllerRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    detectorRef.current = null;
    setLevel(0);
    setLiveTranscript('');
  }, [clearMaxDurationTimer]);

  // (Re)démarre l'écoute permanente quand elle est activée, ou l'arrête sinon.
  // Ne dépend que du micro et de l'activation : le gabarit du mot de réveil
  // est appliqué séparément (voir l'effet suivant) pour ne pas rouvrir le
  // flux audio à chaque enregistrement d'échantillon.
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
        const profile = settingsRef.current?.voice.wakeWordProfile ?? [];
        detectorRef.current = new WakeWordDetector(
          profile.length > 0 ? { envelope: profile } : null,
        );
        setMicError(null);
        setVoiceState('sleeping');
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
    // Volontairement limité à ces deux dépendances : le gabarit du mot de
    // réveil est appliqué par l'effet suivant, sans rouvrir le micro.
  }, [settings?.voice.enabled, settings?.voice.microphoneId]);

  // Applique un nouveau gabarit de mot de réveil sans redémarrer la capture.
  const wakeWordProfileKey = JSON.stringify(settings?.voice.wakeWordProfile ?? []);
  useEffect(() => {
    const profile = settings?.voice.wakeWordProfile ?? [];
    detectorRef.current?.setProfile(profile.length > 0 ? { envelope: profile } : null);
  }, [wakeWordProfileKey]);

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

  const simulate = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed) onTranscriptRef.current(trimmed);
  }, []);

  useEffect(() => stopCapture, [stopCapture]);

  return {
    state,
    level,
    liveTranscript,
    micError,
    speakingText,
    simulate,
    stopSpeaking,
    speak,
    listMicrophones,
  };
}
