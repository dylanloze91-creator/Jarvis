import { describe, expect, it } from 'vitest';
import { createDefaultSearchRegistry } from './registry.js';

describe('SearchProviderRegistry', () => {
  it('liste Wikipédia et Brave par défaut', () => {
    const registry = createDefaultSearchRegistry();
    const ids = registry.list().map((descriptor) => descriptor.id);
    expect(ids).toEqual(['wikipedia', 'brave']);
  });

  it('bascule sur Wikipédia quand le fournisseur demandé est inconnu', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'inexistant' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('wikipedia');
  });

  it('bascule sur Wikipédia quand Brave est demandé sans clé', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'brave', apiKey: '' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('wikipedia');
  });

  it('utilise Brave quand une clé est fournie', () => {
    const registry = createDefaultSearchRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'brave', apiKey: 'abc' });
    expect(fellBack).toBe(false);
    expect(provider.id).toBe('brave');
  });
});
