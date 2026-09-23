import { FinnhubMarketDataProvider, finnhubDescriptor } from './providers/finnhub.js';
import {
  YahooFinanceMarketDataProvider,
  yahooFinanceDescriptor,
} from './providers/yahooFinance.js';
import type {
  MarketDataProvider,
  MarketDataProviderConfig,
  MarketDataProviderDescriptor,
  MarketDataProviderFactory,
} from './types.js';

interface Entry {
  descriptor: MarketDataProviderDescriptor;
  factory: MarketDataProviderFactory;
}

/**
 * Point d'extension du choix de fournisseur de données boursières : un
 * nouveau fournisseur s'ajoute avec un `register()`, sans modifier l'outil
 * `get_stock_quote` ni l'interface de réglages.
 */
export class MarketDataProviderRegistry {
  private readonly entries = new Map<string, Entry>();

  register(descriptor: MarketDataProviderDescriptor, factory: MarketDataProviderFactory): this {
    this.entries.set(descriptor.id, { descriptor, factory });
    return this;
  }

  list(): MarketDataProviderDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  describe(id: string): MarketDataProviderDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  create(config: MarketDataProviderConfig): MarketDataProvider {
    const entry = this.entries.get(config.provider);
    if (!entry) {
      throw new Error(`Fournisseur de données boursières inconnu : ${config.provider}`);
    }
    return entry.factory(config);
  }

  /**
   * Bascule sur Yahoo Finance plutôt que d'échouer quand la configuration est
   * incomplète (fournisseur inconnu ou clé manquante), pour que l'outil reste
   * utilisable sans configuration.
   */
  createOrFallback(config: MarketDataProviderConfig): {
    provider: MarketDataProvider;
    fellBack: boolean;
  } {
    const entry = this.entries.get(config.provider);
    if (!entry) return { provider: new YahooFinanceMarketDataProvider(), fellBack: true };
    if (entry.descriptor.requiresApiKey && !config.apiKey?.trim()) {
      return { provider: new YahooFinanceMarketDataProvider(), fellBack: true };
    }
    return { provider: entry.factory(config), fellBack: false };
  }
}

export function createDefaultMarketDataRegistry(): MarketDataProviderRegistry {
  return new MarketDataProviderRegistry()
    .register(yahooFinanceDescriptor, () => new YahooFinanceMarketDataProvider())
    .register(finnhubDescriptor, (config) => new FinnhubMarketDataProvider(config));
}
