import { beforeEach, describe, expect, it, vi } from 'vitest';

const transcribeWithWhisper = vi.fn(async () => 'Jarvis, quelle heure est-il ?');
vi.mock('./whisper/pipelineLoader', () => ({
  transcribeWithWhisper,
  subscribeWhisperProgress: () => () => undefined,
  describeWhisperProgress: () => '',
  describeWhisperLoadError: (error: unknown) => String(error),
}));
const { LocalWhisperSttProvider } = await import('./localWhisperStt');

const tone = (ms: number, amplitude = 0.1) =>
  new Float32Array(Math.round(16 * ms)).map((_, i) => Math.sin(i / 5) * amplitude);

async function dictate(prefix: Float32Array, after: Float32Array[]): Promise<string> {
  const provider = new LocalWhisperSttProvider();
  return new Promise((resolve, reject) => {
    const controller = provider.start({ onFinal: resolve, onError: reject });
    controller.pushAudio?.(prefix, 16000);
    controller.markPrefixEnd?.();
    for (const frame of after) controller.pushAudio?.(frame, 16000);
    controller.stop();
  });
}

describe('LocalWhisperSttProvider après un mot de réveil', () => {
  beforeEach(() => transcribeWithWhisper.mockClear());

  it('« Jarvis » seul (fin du mot + silence) : rien n’est transcrit ni envoyé', async () => {
    const text = await dictate(tone(1500), [tone(256), new Float32Array(16000)]);
    expect(text).toBe('');
    expect(transcribeWithWhisper).not.toHaveBeenCalled();
  });

  it('« Jarvis, quelle heure est-il » : la commande est transcrite avec le préfixe', async () => {
    const text = await dictate(tone(1500), [tone(800), new Float32Array(8000)]);
    expect(text).toBe('Jarvis, quelle heure est-il ?');
    expect(transcribeWithWhisper).toHaveBeenCalledWith(expect.any(Float32Array), {
      language: 'french',
    });
  });
});
