import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalBrowserTtsProvider } from './localTts';

class FakeUtterance {
  lang = '';
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

function installSpeech() {
  const spoken: FakeUtterance[] = [];
  const speechSynthesis = {
    getVoices: () => [],
    speak: (utterance: FakeUtterance) => spoken.push(utterance),
    // Chromium : annuler une phrase en cours lève `interrupted`.
    cancel: () => spoken.forEach((utterance) => utterance.onerror?.({ error: 'interrupted' })),
  };
  vi.stubGlobal('window', { speechSynthesis });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return spoken;
}

describe('synthèse vocale locale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('couper la réponse n’est pas signalé comme une erreur', () => {
    installSpeech();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const controller = new LocalBrowserTtsProvider().speak('Bonjour', { onError, onEnd });

    controller.stop();

    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('une vraie panne reste signalée', () => {
    const spoken = installSpeech();
    const onError = vi.fn();
    new LocalBrowserTtsProvider().speak('Bonjour', { onError });

    spoken[0]?.onerror?.({ error: 'synthesis-failed' });

    expect(onError).toHaveBeenCalledWith('Erreur de synthèse vocale : synthesis-failed');
  });
});
