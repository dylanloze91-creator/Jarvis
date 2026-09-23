import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAISttProvider } from './openai-stt.js';

describe('OpenAISttProvider', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('signale une erreur claire si aucune clé API n’est configurée', async () => {
    const provider = new OpenAISttProvider({ provider: 'openai-whisper' });
    const finals: string[] = [];
    const errors: string[] = [];
    const controller = provider.start({
      onFinal: (text) => finals.push(text),
      onError: (message) => errors.push(message),
    });
    controller.pushAudio?.(new Float32Array([0.1, -0.1]), 16000);
    controller.stop();
    await flush();

    expect(finals).toHaveLength(0);
    expect(errors[0]).toMatch(/clé api/i);
  });

  it("signale une erreur si aucun son n'a été capturé", async () => {
    const provider = new OpenAISttProvider({ provider: 'openai-whisper', apiKey: 'sk-test' });
    const errors: string[] = [];
    const controller = provider.start({ onFinal: () => {}, onError: (m) => errors.push(m) });
    controller.stop();
    await flush();
    expect(errors[0]).toMatch(/aucun son/i);
  });

  it('encode l’audio capturé en WAV et transmet la transcription reçue', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sk-test');
      const form = init.body as FormData;
      expect(form.get('model')).toBe('whisper-1');
      expect(form.get('file')).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ text: 'Bonjour Jarvis' }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAISttProvider({ provider: 'openai-whisper', apiKey: 'sk-test' });
    const finals: string[] = [];
    const controller = provider.start({ onFinal: (text) => finals.push(text), onError: () => {} });
    controller.pushAudio?.(new Float32Array(1600).fill(0.2), 16000);
    controller.pushAudio?.(new Float32Array(800).fill(-0.2), 16000);
    controller.stop();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(finals).toEqual(['Bonjour Jarvis']);
  });

  it('relaie le message d’erreur renvoyé par l’API en cas d’échec HTTP', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Clé invalide' } }), { status: 401 }),
    ) as unknown as typeof fetch;

    const provider = new OpenAISttProvider({ provider: 'openai-whisper', apiKey: 'sk-test' });
    const errors: string[] = [];
    const controller = provider.start({ onFinal: () => {}, onError: (m) => errors.push(m) });
    controller.pushAudio?.(new Float32Array(160).fill(0.1), 16000);
    controller.stop();
    await flush();

    expect(errors).toEqual(['Clé invalide']);
  });

  it('ignore les appels répétés à pushAudio/stop après abort', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAISttProvider({ provider: 'openai-whisper', apiKey: 'sk-test' });
    const controller = provider.start({ onFinal: () => {}, onError: () => {} });
    controller.abort();
    controller.pushAudio?.(new Float32Array(10), 16000);
    controller.stop();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
