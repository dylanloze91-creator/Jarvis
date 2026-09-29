import { describe, expect, it } from 'vitest';
import { voiceBarStatusLines } from './voiceBarStatus';

describe('voiceBarStatusLines', () => {
  it('garde « En veille » même si Whisper affiche indisponible + code', () => {
    const lines = voiceBarStatusLines({
      state: 'sleeping',
      micError: null,
      whisperStatus: 'Modèle Whisper indisponible (code 6)',
      liveTranscript: '',
    });
    expect(lines.primary).toMatch(/En veille/);
    expect(lines.detail).toMatch(/indisponible \(code 6\)/);
    expect(lines.detailIsError).toBe(true);
  });

  it('n’écrase pas la veille par une erreur openWakeWord', () => {
    const lines = voiceBarStatusLines({
      state: 'sleeping',
      micError: 'openWakeWord indisponible : code 6',
      whisperStatus: null,
      liveTranscript: '',
    });
    expect(lines.primary).toMatch(/En veille/);
    expect(lines.detail).toBe('openWakeWord indisponible : code 6');
    expect(lines.detailIsError).toBe(true);
  });

  it('garde « En veille » si Whisper explique le tuple 99, 50, 24, 8', () => {
    const lines = voiceBarStatusLines({
      state: 'sleeping',
      micError: null,
      whisperStatus:
        "Le moteur Whisper n'a pas pu démarrer (codes 99, 50, 24, 8). Ce n'est pas un identifiant de modèle : le runtime WebAssembly ou un fichier ONNX embarqué est illisible.",
      liveTranscript: '',
    });
    expect(lines.primary).toMatch(/En veille/);
    expect(lines.detail).toMatch(/codes 99, 50, 24, 8/);
    expect(lines.detail).not.toMatch(/^Transcription locale indisponible : 99/);
    expect(lines.detailIsError).toBe(true);
  });

  it('affiche vraiment Micro indisponible seulement en état error', () => {
    const lines = voiceBarStatusLines({
      state: 'error',
      micError: 'Micro indisponible',
      whisperStatus: null,
      liveTranscript: '',
    });
    expect(lines.primary).toBe('Micro indisponible');
  });

  it('pendant l’écoute, montre la transcription sans hériter d’une ancienne erreur', () => {
    const lines = voiceBarStatusLines({
      state: 'listening',
      micError: 'Transcription locale indisponible : ancienne erreur',
      whisperStatus: null,
      liveTranscript: 'Initialisation de Whisper (moteur ONNX)…',
    });
    expect(lines.primary).toBe('Initialisation de Whisper (moteur ONNX)…');
    expect(lines.primaryIsError).toBe(false);
  });

  it('classe l’échec de chargement borné comme une erreur, pas le chargement lui-même', () => {
    const loading = voiceBarStatusLines({
      state: 'sleeping',
      micError: null,
      whisperStatus: 'Initialisation de Whisper (moteur ONNX)…',
      liveTranscript: '',
    });
    expect(loading.detailIsError).toBe(false);
    const stuck = voiceBarStatusLines({
      state: 'sleeping',
      micError: null,
      whisperStatus:
        "Whisper ne s'est pas chargé en 90 s (bloqué à l'étape : création des sessions ONNX du modèle). Lance « Tester la voix » dans les réglages.",
      liveTranscript: '',
    });
    expect(stuck.detailIsError).toBe(true);
  });
});
