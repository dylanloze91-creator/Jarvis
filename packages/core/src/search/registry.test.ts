import { describe, expect, it } from 'vitest';
import { createDefaultSearchRegistry } from './registry.js';

describe('SearchProviderRegistry', () => {
  it('liste Google, Wikipédia et Brave par défaut', () => {
    const registry = createDefaultSearchRegistry();
    const ids = registry.list().map((descriptor) => descriptor.id);
    expect(ids).toEqual(['google', 'wikipedia', 'brave']);
  });

  it('bascule sur Google quand le fournisseur demandé est inconnu', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'inexistant' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('google');
  });

  it('bascule sur Google quand Brave est demandé sans clé', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'brave', apiKey: '' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('google');
  });

  it('utilise Brave quand une clé est fournie', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'brave', apiKey: 'abc' });
    expect(fellBack).toBe(false);
    expect(provider.id).toBe('brave');
  });

  it('utilise Google sans clé', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'google' });
    expect(fellBack).toBe(false);
    expect(provider.id).toBe('google');
    expect(provider.requiresApiKey).toBe(false);
  });
});
