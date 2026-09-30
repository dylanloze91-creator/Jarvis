import { describe, expect, it } from 'vitest';
import { PcmHistory, VoskWakeWordEngine, type VoskModelLike, type VoskRecognizerLike } from './voskWakeWordEngine';

class FakeRecognizer implements VoskRecognizerLike {
  readonly listeners = new Map<string, Array<(message: unknown) => void>>();
  words = false;
  fed = 0;
  removed = false;
  constructor(
    readonly sampleRate: number,
    readonly grammar?: string,
  ) {}
  on(event: string, listener: (message: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  setWords(words: boolean) {
    this.words = words;
  }
  acceptWaveformFloat(buffer: Float32Array) {
    this.fed += buffer.length;
  }
  retrieveFinalResult() {}
  remove() {
    this.removed = true;
  }
  emit(event: string, message: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(message);
  }
}

function fakeModel() {
  const created: FakeRecognizer[] = [];
  const model: VoskModelLike = {
    KaldiRecognizer: class extends FakeRecognizer {
      constructor(sampleRate: number, grammar?: string) {
        super(sampleRate, grammar);
        created.push(this);
      }
    } as unknown as VoskModelLike['KaldiRecognizer'],
  };
  return { model, created };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function frame(value: number, length = 4096) {
  return new Float32Array(length).fill(value);
}

describe('Vosk : « Jarvis » seul', () => {
  it('ouvre un recognizer 16 kHz à grammaire fermée, avec les temps des mots', async () => {
    const { model, created } = fakeModel();
    const engine = new VoskWakeWordEngine({ keyword: 'jarvis', sensitivity: 0.7 }, async () => model);
    const controller = engine.start({ onDetected: () => undefined, onError: () => undefined });
    controller.pushAudio?.(frame(0), 16000);
    await flush();
    controller.pushAudio?.(frame(0), 16000);
    expect(created).toHaveLength(1);
    expect(created[0]!.sampleRate).toBe(16000);
    expect(JSON.parse(created[0]!.grammar!)).toEqual(expect.arrayContaining(['jarvis', 'gervais', '[unk]']));
    expect(created[0]!.words).toBe(true);
    expect(created[0]!.fed).toBe(4096);
  });

  it('réveille sur un « Jarvis » sûr et transmet l’audio depuis le mot jusqu’à maintenant', async () => {
    const { model, created } = fakeModel();
    const detected: string[] = [];
    const engine = new VoskWakeWordEngine({ keyword: 'jarvis', sensitivity: 0.7 }, async () => model);
    const controller = engine.start({ onDetected: (word) => detected.push(word), onError: () => undefined });
    controller.pushAudio?.(frame(0.9), 16000); // avant le recognizer : hors du temps de Vosk
    await flush();
    for (let i = 0; i < 8; i += 1) controller.pushAudio?.(frame(i / 10), 16000); // 2,048 s données à Vosk
    created[0]!.emit('result', {
      result: {
        text: 'jarvis [unk]',
        result: [
          { word: 'jarvis', conf: 1, start: 0.5, end: 1.0 },
          { word: '[unk]', conf: 0.8, start: 1.2, end: 1.9 },
        ],
      },
    });
    expect(detected).toEqual(['jarvis']);
    const window = controller.getLastAnalyzedWindow?.();
    expect(window?.sampleRate).toBe(16000);
    expect(window?.pcm.length).toBe(8 * 4096 - Math.round(0.25 * 16000));
    expect(window?.commandOffset).toBe(Math.round(1.0 * 16000) - Math.round(0.25 * 16000));
    expect(window?.pcm[0]).toBe(0);
  });

  it('ignore un leurre ou un « jarvis » peu sûr', async () => {
    const { model, created } = fakeModel();
    const detected: string[] = [];
    const engine = new VoskWakeWordEngine({ keyword: 'jarvis', sensitivity: 0.7 }, async () => model);
    const controller = engine.start({ onDetected: (word) => detected.push(word), onError: () => undefined });
    controller.pushAudio?.(frame(0), 16000);
    await flush();
    created[0]!.emit('result', {
      result: {
        text: 'parvis jarvis',
        result: [
          { word: 'parvis', conf: 1, start: 0.1, end: 0.5 },
          { word: 'jarvis', conf: 0.63, start: 0.6, end: 1.0 },
        ],
      },
    });
    expect(detected).toEqual([]);
  });

  it('signale un modèle qui ne se charge pas (le repli Whisper prend alors le relais)', async () => {
    const errors: string[] = [];
    const engine = new VoskWakeWordEngine({ keyword: 'jarvis' }, async () => {
      throw new Error('HTTP 404 pour jarvis-oww://vosk/vosk-model-small-fr-0.22.tar.gz');
    });
    const controller = engine.start({ onDetected: () => undefined, onError: (message) => errors.push(message) });
    controller.pushAudio?.(frame(0), 16000);
    await flush();
    expect(errors).toEqual(['Vosk indisponible : HTTP 404 pour jarvis-oww://vosk/vosk-model-small-fr-0.22.tar.gz']);
  });

  it('libère le recognizer à l’arrêt', async () => {
    const { model, created } = fakeModel();
    const engine = new VoskWakeWordEngine({ keyword: 'jarvis' }, async () => model);
    const controller = engine.start({ onDetected: () => undefined, onError: () => undefined });
    controller.pushAudio?.(frame(0), 16000);
    await flush();
    controller.stop();
    expect(created[0]!.removed).toBe(true);
  });
});

describe('historique audio indexé', () => {
  it('rend les échantillons encore en mémoire, par index absolu', () => {
    const history = new PcmHistory(10);
    history.push(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]));
    history.push(new Float32Array([9, 10, 11, 12]));
    expect(history.totalSamples).toBe(12);
    expect(Array.from(history.slice(0, 12))).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Array.from(history.slice(8, 11))).toEqual([9, 10, 11]);
  });
});
