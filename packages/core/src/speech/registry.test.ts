import { describe, expect, it } from 'vitest';
import { SpeechToTextRegistry, TextToSpeechRegistry } from './registry.js';
import type {
  SpeechToTextController,
  SpeechToTextDescriptor,
  SpeechToTextHandlers,
  SpeechToTextProvider,
  TextToSpeechController,
  TextToSpeechDescriptor,
  TextToSpeechHandlers,
  TextToSpeechProvider,
} from './types.js';

/** Le fabricant réel utilise toujours l'identifiant de son propre descripteur, jamais celui demandé par la config (voir OpenAIProvider). */
class FakeSttProvider implements SpeechToTextProvider {
  readonly managesOwnCapture = true;
  constructor(
    readonly id: string,
    readonly label: string,
    readonly requiresApiKey: boolean,
  ) {}
  start(handlers: SpeechToTextHandlers): SpeechToTextController {
    handlers.onFinal(`réponse de ${this.id}`);
    return { stop: () => {}, abort: () => {} };
  }
}

class FakeTtsProvider implements TextToSpeechProvider {
  readonly managesOwnPlayback = true;
  constructor(
    readonly id: string,
    readonly label: string,
    readonly requiresApiKey: boolean,
  ) {}
  async listVoices() {
    return [];
  }
  speak(_text: string, handlers: TextToSpeechHandlers): TextToSpeechController {
    handlers.onEnd?.();
    return { stop: () => {} };
  }
}

const localSttDescriptor: SpeechToTextDescriptor = {
  id: 'local',
  label: 'Local',
  requiresApiKey: false,
};
const cloudSttDescriptor: SpeechToTextDescriptor = {
  id: 'cloud',
  label: 'Cloud',
  requiresApiKey: true,
};

describe('SpeechToTextRegistry', () => {
  function buildRegistry(): SpeechToTextRegistry {
    return new SpeechToTextRegistry()
      .register(localSttDescriptor, () => new FakeSttProvider('local', 'Local', false))
      .register(cloudSttDescriptor, () => new FakeSttProvider('cloud', 'Cloud', true));
  }

  it('liste les moteurs enregistrés', () => {
    const registry = buildRegistry();
    expect(registry.list().map((d) => d.id)).toEqual(['local', 'cloud']);
    expect(registry.has('cloud')).toBe(true);
    expect(registry.has('inconnu')).toBe(false);
  });

  it('crée le moteur demandé quand il existe', () => {
    const registry = buildRegistry();
    const provider = registry.create({ provider: 'local' });
    expect(provider.id).toBe('local');
  });

  it('lève une erreur claire pour un moteur inconnu', () => {
    const registry = buildRegistry();
    expect(() => registry.create({ provider: 'inconnu' })).toThrow(/inconnu/);
  });

  it('bascule sur le moteur local quand la clé API manque', () => {
    const registry = buildRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'cloud' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('local');
  });

  it("n'a pas besoin de repli quand la clé API est fournie", () => {
    const registry = buildRegistry();
    const { provider, fellBack } = registry.createOrFallback({
      provider: 'cloud',
      apiKey: 'sk-test',
    });
    expect(fellBack).toBe(false);
    expect(provider.id).toBe('cloud');
  });

  it('bascule aussi quand le moteur demandé est totalement inconnu', () => {
    const registry = buildRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'absent' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('local');
  });

  it("échoue proprement si aucun moteur local n'est disponible en repli", () => {
    const registry = new SpeechToTextRegistry().register(
      cloudSttDescriptor,
      () => new FakeSttProvider('cloud', 'Cloud', true),
    );
    expect(() => registry.createOrFallback({ provider: 'cloud' })).toThrow(/repli/);
  });
});

describe('TextToSpeechRegistry', () => {
  const localTtsDescriptor: TextToSpeechDescriptor = {
    id: 'local',
    label: 'Local',
    requiresApiKey: false,
  };
  const cloudTtsDescriptor: TextToSpeechDescriptor = {
    id: 'cloud',
    label: 'Cloud',
    requiresApiKey: true,
  };

  function buildRegistry(): TextToSpeechRegistry {
    return new TextToSpeechRegistry()
      .register(localTtsDescriptor, () => new FakeTtsProvider('local', 'Local', false))
      .register(cloudTtsDescriptor, () => new FakeTtsProvider('cloud', 'Cloud', true));
  }

  it('bascule sur le moteur local quand la clé API manque', () => {
    const registry = buildRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'cloud' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('local');
  });

  it('conserve le moteur demandé quand la clé API est fournie', () => {
    const registry = buildRegistry();
    const { provider, fellBack } = registry.createOrFallback({
      provider: 'cloud',
      apiKey: 'sk-test',
    });
    expect(fellBack).toBe(false);
    expect(provider.id).toBe('cloud');
  });
});
