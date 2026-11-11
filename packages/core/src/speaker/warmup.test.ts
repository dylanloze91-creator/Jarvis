import { describe, expect, it } from 'vitest';
import { isOllamaLoadOnly, speakerWarmupRequests, SPEAKER_AWAKE_KEEP_ALIVE } from './warmup.js';

describe('préchauffage Ollama', () => {
  it('charge le trieur et la conversation, sans rien générer', () => {
    const requests = speakerWarmupRequests({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      orchestra: {
        enabled: true,
        brain: 'qwen2.5:7b',
        router: { model: 'jarvis-trieur' },
        teams: { conversation: { model: 'qwen2.5:3b' } },
      },
    });
    expect(requests.map((item) => item.model)).toEqual(['jarvis-trieur', 'qwen2.5:3b']);
    expect(requests.every((item) => isOllamaLoadOnly(item))).toBe(true);
    expect(requests.every((item) => !('messages' in item))).toBe(true);
  });

  it('sans trieur, le cerveau trie ; un seul modèle n’est chargé qu’une fois', () => {
    const requests = speakerWarmupRequests({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      orchestra: { enabled: true, brain: 'qwen2.5:7b' },
      speakerKeepAwake: true,
    });
    expect(requests).toEqual([
      { model: 'qwen2.5:7b', prompt: '', keep_alive: SPEAKER_AWAKE_KEEP_ALIVE, stream: false },
    ]);
  });

  it('sans orchestre, charge le modèle du chat ; un autre fournisseur ne charge rien', () => {
    expect(speakerWarmupRequests({ provider: 'ollama', model: 'qwen2.5:3b' })).toEqual([
      { model: 'qwen2.5:3b', prompt: '', keep_alive: '10m', stream: false },
    ]);
    expect(speakerWarmupRequests({ provider: 'mock', model: 'jarvis-demo' })).toEqual([]);
  });

  it('refuse une requête qui demanderait une réponse', () => {
    expect(isOllamaLoadOnly({ model: 'qwen2.5:7b', prompt: 'bonjour', stream: false })).toBe(false);
    expect(isOllamaLoadOnly({ model: 'qwen2.5:7b', prompt: '', messages: [], stream: false })).toBe(false);
  });
});
