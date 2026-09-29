import { describe, expect, it, vi } from 'vitest';

vi.mock('onnxruntime-web', () => ({ env: { wasm: {}, versions: { web: '1.31.0-dev' } } }));
const { withOrtLock } = await import('./onnxRuntime');

describe('withOrtLock', () => {
  it('ne laisse jamais deux appels au runtime ONNX se chevaucher', async () => {
    const events: string[] = [];
    const task = (name: string, ms: number) => () =>
      new Promise<string>((resolve) => {
        events.push(`début ${name}`);
        setTimeout(() => {
          events.push(`fin ${name}`);
          resolve(name);
        }, ms);
      });
    const results = await Promise.all([
      withOrtLock(task('whisper', 30)),
      withOrtLock(task('openwakeword', 1)),
      withOrtLock(task('openwakeword-2', 1)),
    ]);
    expect(results).toEqual(['whisper', 'openwakeword', 'openwakeword-2']);
    expect(events).toEqual([
      'début whisper',
      'fin whisper',
      'début openwakeword',
      'fin openwakeword',
      'début openwakeword-2',
      'fin openwakeword-2',
    ]);
  });

  it('un appel en échec ne bloque pas les suivants', async () => {
    await expect(withOrtLock(async () => Promise.reject(new Error('ERROR_CODE: 6')))).rejects.toThrow('ERROR_CODE: 6');
    await expect(withOrtLock(async () => 'ok')).resolves.toBe('ok');
  });
});
