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

  it('n’écrase pas la veille par une erreur openWakeWord ou de synthèse', () => {
    for (const voiceError of ['openWakeWord indisponible : code 6', 'Erreur de synthèse vocale : synthesis-failed']) {
      const lines = voiceBarStatusLines({
        state: 'sleeping',
        micPhase: 'open',
        micError: null,
        voiceError,
        whisperStatus: null,
        liveTranscript: '',
      });
      expect(lines.primary).toMatch(/En veille/);
      expect(lines.primary).not.toMatch(/Micro/);
      expect(lines.detail).toBe(voiceError);
      expect(lines.detailIsError).toBe(true);
    }
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

  it('en échec du micro, la ligne donne la cause exacte, pas un libellé générique', () => {
    const lines = voiceBarStatusLines({
      state: 'error',
      micPhase: 'error',
      micError:
        'Windows bloque le micro pour Jarvis (NotAllowedError : Permission denied by system). Paramètres Windows > …',
      whisperStatus: null,
      liveTranscript: '',
    });
    expect(lines.primary).toContain('NotAllowedError : Permission denied by system');
    expect(lines.primaryIsError).toBe(true);
  });

  it('montre l’ouverture et la reprise du micro au lieu de « dis Jarvis »', () => {
    expect(
      voiceBarStatusLines({ state: 'sleeping', micPhase: 'opening', micError: null, whisperStatus: null, liveTranscript: '' })
        .primary,
    ).toBe('Ouverture du micro…');
    const recovering = voiceBarStatusLines({
      state: 'sleeping',
      micPhase: 'recovering',
      micError: 'Le micro s’est arrêté (DeviceLostError : MediaStreamTrack ended). …',
      whisperStatus: null,
      liveTranscript: '',
    });
    expect(recovering.primary).toMatch(/reprise automatique/);
    expect(recovering.detail).toContain('DeviceLostError');
  });

  it('un repli sur le micro par défaut est une information, pas une erreur', () => {
    const lines = voiceBarStatusLines({
      state: 'sleeping',
      micPhase: 'open',
      micError: null,
      micNotice: 'Le micro choisi n’est pas branché : écoute sur l’entrée par défaut de Windows.',
      whisperStatus: null,
      liveTranscript: '',
    });
    expect(lines.primary).toMatch(/En veille/);
    expect(lines.detailIsError).toBe(false);
  });

  it('pendant l’écoute, montre la transcription sans hériter d’une ancienne erreur', () => {
    const lines = voiceBarStatusLines({
      state: 'listening',
      micError: null,
      voiceError: 'Transcription locale indisponible : ancienne erreur',
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
