import { describe, expect, it } from 'vitest';
import { isLocalMemoryEndpoint, resolveLocalOllamaBase } from './localUrl.js';

describe('isLocalMemoryEndpoint', () => {
  it('accepte la boucle locale et un réseau privé', () => {
    expect(isLocalMemoryEndpoint('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalMemoryEndpoint('http://localhost:11434')).toBe(true);
    expect(isLocalMemoryEndpoint('http://192.168.1.12:11434')).toBe(true);
  });

  it('refuse les hôtes publics (pas d’embeddings cloud)', () => {
    expect(isLocalMemoryEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLocalMemoryEndpoint('https://ollama.com')).toBe(false);
  });
});

describe('resolveLocalOllamaBase', () => {
  it('ignore baseUrl d’un fournisseur cloud', () => {
    expect(
      resolveLocalOllamaBase({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }),
    ).toBe('http://127.0.0.1:11434');
  });

  it('utilise l’URL Ollama locale quand le fournisseur est Ollama', () => {
    expect(resolveLocalOllamaBase({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11435/' })).toBe(
      'http://127.0.0.1:11435',
    );
  });
});
