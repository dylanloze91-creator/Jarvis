import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_TTS_VOICES, OpenAITtsProvider } from './openai-tts.js';

describe('OpenAITtsProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('expose une liste de voix statique, sans appel réseau', async () => {
    const provider = new OpenAITtsProvider({ provider: 'openai-tts', apiKey: 'sk-test' });
    const voices = await provider.listVoices();
    expect(voices).toEqual(OPENAI_TTS_VOICES);
  });

  it('signale une erreur claire si aucune clé API n’est configurée', async () => {
    const provider = new OpenAITtsProvider({ provider: 'openai-tts' });
    const errors: string[] = [];
    provider.speak('Bonjour', { onError: (m) => errors.push(m) });
    await flush();
    expect(errors[0]).toMatch(/clé api/i);
  });

  it('interroge l’API de synthèse et renvoie les octets audio reçus', async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { voice: string; input: string };
      expect(body.voice).toBe('nova');
      expect(body.input).toBe('Bonjour Jarvis');
      return new Response(audioBytes.buffer, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAITtsProvider({ provider: 'openai-tts', apiKey: 'sk-test' });
    const events: string[] = [];
    let received: Uint8Array | null = null;
    provider.speak(
      'Bonjour Jarvis',
      {
        onStart: () => events.push('start'),
        onAudio: (clip) => {
          received = clip.data;
          expect(clip.mimeType).toBe('audio/mpeg');
        },
        onEnd: () => events.push('end'),
        onError: () => events.push('error'),
      },
      { voice: 'nova' },
    );
    await flush();

    expect(events).toEqual(['start', 'end']);
    expect(received).toEqual(audioBytes);
  });

  it('n’appelle pas onError quand la synthèse est interrompue via stop()', async () => {
    let rejectFetch: (() => void) | null = null;
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          rejectFetch = () => reject(new DOMException('Aborted', 'AbortError'));
          init.signal?.addEventListener('abort', () => rejectFetch?.());
        }),
    ) as unknown as typeof fetch;

    const provider = new OpenAITtsProvider({ provider: 'openai-tts', apiKey: 'sk-test' });
    const events: string[] = [];
    const controller = provider.speak('Bonjour', {
      onStart: () => events.push('start'),
      onEnd: () => events.push('end'),
      onError: () => events.push('error'),
    });
    controller.stop();
    await flush();

    expect(events).toEqual(['start', 'end']);
  });

  it('relaie le message d’erreur renvoyé par l’API en cas d’échec HTTP', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Texte trop long' } }), { status: 400 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAITtsProvider({ provider: 'openai-tts', apiKey: 'sk-test' });
    const errors: string[] = [];
    provider.speak('Bonjour', { onError: (m) => errors.push(m) });
    await flush();

    expect(errors).toEqual(['Texte trop long']);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
