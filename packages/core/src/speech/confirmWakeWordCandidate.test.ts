import { describe, expect, it, vi } from 'vitest';
import {
  confirmWakeWordCandidate,
  wrapWakeWordEngineWithTranscriptConfirmation,
} from './confirmWakeWordCandidate.js';
import { splitWakeWordWindow } from './wakewordEngine.js';
import type {
  WakeWordEngine,
  WakeWordEngineController,
  WakeWordEngineHandlers,
} from './wakewordEngine.js';

describe('confirmWakeWordCandidate', () => {
  it('accepte une transcription qui contient Jarvis', async () => {
    const transcribe = vi.fn().mockResolvedValue('Jarvis, ouvre Chrome');
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2, 0.3]), sampleRate: 16000 },
      transcribe,
      { word: 'jarvis' },
    );
    expect(result).toEqual({
      confirmed: true,
      transcript: 'Jarvis, ouvre Chrome',
      transcriptionFailed: false,
    });
  });

  it('rejette une transcription sans rapport', async () => {
    const transcribe = vi.fn().mockResolvedValue('Il fait beau');
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2]), sampleRate: 16000 },
      transcribe,
      { word: 'jarvis' },
    );
    expect(result.confirmed).toBe(false);
    expect(result.transcriptionFailed).toBe(false);
  });

  it('signale un échec de transcription sans lever', async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error('modèle absent'));
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2]), sampleRate: 16000 },
      transcribe,
      { word: 'jarvis' },
    );
    expect(result).toEqual({ confirmed: false, transcript: null, transcriptionFailed: true });
  });

  it('demande un second avis (français) quand l’anglais hallucine « Thank you. »', async () => {
    const english = vi.fn().mockResolvedValue('Thank you.');
    const french = vi.fn().mockResolvedValue("J'avis.");
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2]), sampleRate: 16000 },
      english,
      { word: 'jarvis' },
      french,
    );
    expect(result).toEqual({ confirmed: true, transcript: "Thank you. / J'avis.", transcriptionFailed: false });
  });

  it('ne demande pas de second avis quand l’anglais a déjà reconnu Jarvis', async () => {
    const french = vi.fn();
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2]), sampleRate: 16000 },
      vi.fn().mockResolvedValue('Jarvis.'),
      { word: 'jarvis' },
      french,
    );
    expect(result.confirmed).toBe(true);
    expect(french).not.toHaveBeenCalled();
  });

  it('ne confirme pas une hallucination (« you » / « Je vous invite à vous dire… »)', async () => {
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2]), sampleRate: 16000 },
      vi.fn().mockResolvedValue('you'),
      { word: 'jarvis' },
      vi.fn().mockResolvedValue('Je vous invite à vous dire que vous avez une question qui'),
    );
    expect(result.confirmed).toBe(false);
    expect(result.transcript).toBe('you / Je vous invite à vous dire que vous avez une question qui');
  });

  it('rejette toujours une autre phrase, même avec le second avis', async () => {
    const result = await confirmWakeWordCandidate(
      { pcm: new Float32Array([0.2]), sampleRate: 16000 },
      vi.fn().mockResolvedValue('would be a table for two'),
      { word: 'jarvis' },
      vi.fn().mockResolvedValue('Bonjour, je voudrais réserver une table.'),
    );
    expect(result.confirmed).toBe(false);
  });
});

class FakeInnerEngine implements WakeWordEngine {
  readonly id = 'local-template';
  readonly label = 'fake';
  readonly managesOwnCapture = false;
  window: { pcm: Float32Array; sampleRate: number } | null = {
    pcm: new Float32Array([0.4, 0.5]),
    sampleRate: 16000,
  };

  start(handlers: WakeWordEngineHandlers): WakeWordEngineController {
    return {
      getLastAnalyzedWindow: () => this.window,
      pushAudio: () => handlers.onDetected('jarvis'),
      stop: () => {},
    };
  }
}

describe('wrapWakeWordEngineWithTranscriptConfirmation', () => {
  it('garde l’audio arrivé pendant la confirmation : c’est le début de la commande', async () => {
    let finish: (text: string) => void = () => {};
    const transcribe = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const wrapped = wrapWakeWordEngineWithTranscriptConfirmation(new FakeInnerEngine(), { transcribe, word: 'jarvis' });
    const windows: Array<ReturnType<NonNullable<WakeWordEngineController['getLastAnalyzedWindow']>>> = [];
    const controller = wrapped.start({
      onDetected: () => windows.push(controller.getLastAnalyzedWindow?.() ?? null),
      onError: () => {},
    });
    controller.pushAudio?.(new Float32Array([0.1]), 16000);
    controller.pushAudio?.(new Float32Array([0.7, 0.8]), 16000);
    controller.pushAudio?.(new Float32Array([0.9]), 16000);
    finish('Jarvis.');
    await vi.waitFor(() => expect(windows).toHaveLength(1));
    const window = windows[0]!;
    expect(Array.from(window!.pcm)).toEqual([0.4, 0.5, 0.7, 0.8, 0.9].map(Math.fround));
    expect(window!.commandOffset).toBe(2);
    const { prefix, command } = splitWakeWordWindow(window!);
    expect(Array.from(prefix)).toEqual([0.4, 0.5].map(Math.fround));
    expect(Array.from(command)).toEqual([0.7, 0.8, 0.9].map(Math.fround));
  });

  it('relaye la détection seulement si Whisper confirme', async () => {
    const transcribe = vi.fn().mockResolvedValue('Jarvis');
    const wrapped = wrapWakeWordEngineWithTranscriptConfirmation(new FakeInnerEngine(), {
      transcribe,
      word: 'jarvis',
    });
    const detections: string[] = [];
    const controller = wrapped.start({
      onDetected: (keyword) => detections.push(keyword),
      onError: () => {},
    });
    controller.pushAudio?.(new Float32Array([0.1]), 16000);
    await vi.waitFor(() => expect(detections).toEqual(['jarvis']));
  });

  it('n’accepte pas un candidat dont la transcription n’est pas Jarvis', async () => {
    const transcribe = vi.fn().mockResolvedValue('bonjour');
    const wrapped = wrapWakeWordEngineWithTranscriptConfirmation(new FakeInnerEngine(), {
      transcribe,
      word: 'jarvis',
    });
    const detections: string[] = [];
    const controller = wrapped.start({
      onDetected: (keyword) => detections.push(keyword),
      onError: () => {},
    });
    controller.pushAudio?.(new Float32Array([0.1]), 16000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(detections).toEqual([]);
  });

  it('accepte le candidat si Whisper échoue et que le repli est demandé', async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error('hors ligne'));
    const wrapped = wrapWakeWordEngineWithTranscriptConfirmation(new FakeInnerEngine(), {
      transcribe,
      word: 'jarvis',
      acceptOnTranscriptionError: true,
    });
    const detections: string[] = [];
    const controller = wrapped.start({
      onDetected: (keyword) => detections.push(keyword),
      onError: () => {},
    });
    controller.pushAudio?.(new Float32Array([0.1]), 16000);
    await vi.waitFor(() => expect(detections).toEqual(['jarvis']));
  });
});
