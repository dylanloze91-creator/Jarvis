import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UseVoiceResult } from '@/voice/useVoice';
import { VoiceBar } from './VoiceBar';

function voice(overrides: Partial<UseVoiceResult>): UseVoiceResult {
  return {
    state: 'sleeping',
    level: 0,
    liveTranscript: '',
    mic: {
      phase: 'open',
      preferredId: '',
      deviceId: 'default',
      label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)',
      usingFallback: false,
      failure: null,
      timings: {},
      inputs: [],
      muted: false,
      opens: 1,
    },
    micError: null,
    micNotice: null,
    voiceError: null,
    whisperStatus: null,
    speakingText: null,
    stopSpeaking: () => undefined,
    speak: () => undefined,
    noteAssistantReply: () => undefined,
    listMicrophones: async () => [],
    retryMicrophone: () => undefined,
    ...overrides,
  };
}

describe('VoiceBar', () => {
  it('ne pose jamais un second champ de saisie sur le composer, même en erreur', () => {
    for (const state of ['idle', 'sleeping', 'listening', 'speaking', 'error'] as const) {
      const html = renderToStaticMarkup(
        <VoiceBar
          voiceEnabled
          voice={voice({
            state,
            voiceError: 'openWakeWord indisponible : fichiers du modèle introuvables',
            liveTranscript: state === 'listening' ? 'Initialisation de Whisper (moteur ONNX)…' : '',
          })}
        />,
      );
      expect(html, state).not.toMatch(/<input|<textarea/);
      expect(html, state).not.toMatch(/dirais/);
    }
    expect(renderToStaticMarkup(<VoiceBar voiceEnabled={false} voice={voice({})} />)).not.toMatch(
      /<input|Simuler/,
    );
  });

  it('pendant l’écoute, une ancienne erreur ne colore pas la ligne en rouge', () => {
    const html = renderToStaticMarkup(
      <VoiceBar
        voiceEnabled
        voice={voice({ state: 'listening', voiceError: 'Whisper indisponible', liveTranscript: 'Transcription…' })}
      />,
    );
    expect(html).toContain('Transcription…');
    expect(html).not.toContain('text-rose-300');
  });

  it('en échec du micro, affiche la cause exacte et « Réessayer »', () => {
    const html = renderToStaticMarkup(
      <VoiceBar
        voiceEnabled
        voice={voice({
          state: 'error',
          micError: 'Windows n’a pas pu démarrer « Chat Mic » (NotReadableError : Could not start audio source). …',
        })}
      />,
    );
    expect(html).toContain('NotReadableError : Could not start audio source');
    expect(html).toContain('Réessayer');
  });

  it('la feuille de style ne contient plus la boîte flottante .voice-sim', () => {
    const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');
    expect(css).not.toMatch(/\.voice-sim\b/);
  });
});
