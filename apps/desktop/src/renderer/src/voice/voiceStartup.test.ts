import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  startWakeWhenWindowVisible,
  voiceBootAction,
  waitForWindowShown,
  type WindowShownApi,
} from './voiceStartup.js';

describe('démarrage vocal paresseux', () => {
  it('ne lance pas le réveil tant que la fenêtre est cachée', () => {
    expect(voiceBootAction({ voiceEnabled: true, windowVisible: false })).toBe('wait');
    expect(voiceBootAction({ voiceEnabled: true, windowVisible: true })).toBe('start-wake');
    expect(voiceBootAction({ voiceEnabled: false, windowVisible: true })).toBe('off');
  });

  it('démarre le réveil tout de suite si la fenêtre est déjà visible', async () => {
    const started = vi.fn();
    await startWakeWhenWindowVisible(
      {
        isVisible: async () => true,
        onShown: () => () => undefined,
      },
      started,
    );
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('attend window:shown avant de démarrer le réveil', async () => {
    let listener: (() => void) | null = null;
    const api: WindowShownApi = {
      isVisible: async () => false,
      onShown: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    };
    const started = vi.fn();
    const pending = startWakeWhenWindowVisible(api, started);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).not.toHaveBeenCalled();
    expect(listener).toBeTypeOf('function');
    listener?.();
    await pending;
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('ne rate pas un affichage qui arrive entre l’abonnement et la sonde', async () => {
    let visible = false;
    let listener: (() => void) | null = null;
    const api: WindowShownApi = {
      isVisible: async () => visible,
      onShown: (next) => {
        listener = next;
        visible = true;
        next();
        return () => {
          listener = null;
        };
      },
    };
    await waitForWindowShown(api);
    expect(listener).toBeNull();
  });

  it('annule l’attente si l’écoute s’arrête', async () => {
    const abort = new AbortController();
    const pending = waitForWindowShown(
      {
        isVisible: () => new Promise(() => undefined),
        onShown: () => () => undefined,
      },
      abort.signal,
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('ne précharge pas Whisper à l’activation de la voix, seulement au réveil', () => {
    const source = readFileSync(new URL('./useVoice.ts', import.meta.url), 'utf8');
    const calls = [...source.matchAll(/getWhisperPipeline\(/g)].map((match) => match.index!);
    const wake = source.indexOf('const beginListening');
    const afterWake = source.indexOf('const startWakeWordEngine');
    expect(calls.length).toBeGreaterThan(0);
    for (const index of calls) {
      expect(index).toBeGreaterThan(wake);
      expect(index).toBeLessThan(afterWake);
    }
  });
});
