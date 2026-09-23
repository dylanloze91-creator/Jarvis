import { describe, expect, it } from 'vitest';
import { createDefaultMarketDataRegistry } from './registry.js';

describe('MarketDataProviderRegistry', () => {
  it('liste Yahoo Finance et Finnhub par défaut', () => {
    const registry = createDefaultMarketDataRegistry();
    const ids = registry.list().map((descriptor) => descriptor.id);
    expect(ids).toEqual(['yahoo-finance', 'finnhub']);
  });

  it('bascule sur Yahoo Finance quand le fournisseur demandé est inconnu', () => {
    const registry = createDefaultMarketDataRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'inexistant' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('yahoo-finance');
  });

  it('bascule sur Yahoo Finance quand Finnhub est demandé sans clé', () => {
    const registry = createDefaultMarketDataRegistry();
    const { provider, fellBack } = registry.createOrFallback({ provider: 'finnhub', apiKey: '' });
    expect(fellBack).toBe(true);
    expect(provider.id).toBe('yahoo-finance');
  });

  it('utilise Finnhub quand une clé est fournie', () => {
    const registry = createDefaultMarketDataRegistry();
    const { provider, fellBack } = registry.createOrFallback({
      provider: 'finnhub',
      apiKey: 'abc',
    });
    expect(fellBack).toBe(false);
    expect(provider.id).toBe('finnhub');
  });
});
