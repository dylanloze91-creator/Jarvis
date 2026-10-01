import { BraveSearchProvider, braveDescriptor } from './providers/brave.js';
import { WikipediaSearchProvider, wikipediaDescriptor } from './providers/wikipedia.js';
import { GoogleSearchProvider, googleDescriptor } from './providers/google.js';
import { DuckDuckGoSearchProvider, duckDuckGoDescriptor } from './providers/duckduckgo.js';
import { BingSearchProvider, bingDescriptor } from './providers/bing.js';
import {
  BingNewsRssProvider,
  GoogleNewsRssProvider,
  bingNewsDescriptor,
  googleNewsDescriptor,
} from './providers/newsRss.js';
import { TavilySearchProvider, tavilyDescriptor } from './providers/tavily.js';
import type {
  SearchProvider,
  SearchProviderConfig,
  SearchProviderDescriptor,
  SearchProviderFactory,
} from './types.js';

interface Entry {
  descriptor: SearchProviderDescriptor;
  factory: SearchProviderFactory;
}

/**
 * Point d'extension du choix de moteur de recherche : un nouveau fournisseur
 * s'ajoute avec un `register()`, sans modifier l'outil `web_search` ni
 * l'interface de réglages.
 */
export class SearchProviderRegistry {
  private readonly entries = new Map<string, Entry>();

  register(descriptor: SearchProviderDescriptor, factory: SearchProviderFactory): this {
    this.entries.set(descriptor.id, { descriptor, factory });
    return this;
  }

  list(): SearchProviderDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  describe(id: string): SearchProviderDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  create(config: SearchProviderConfig): SearchProvider {
    const entry = this.entries.get(config.provider);
    if (!entry) {
      throw new Error(`Fournisseur de recherche inconnu : ${config.provider}`);
    }
    return entry.factory(config);
  }

  /**
   * Bascule sur Google (sans clé) plutôt que d'échouer quand la configuration
   * est incomplète (fournisseur inconnu ou clé manquante), pour que l'outil
   * reste utilisable sans configuration payante.
   */
  createOrFallback(config: SearchProviderConfig): { provider: SearchProvider; fellBack: boolean } {
    const entry = this.entries.get(config.provider);
    if (!entry) return { provider: new GoogleSearchProvider(), fellBack: true };
    if (entry.descriptor.requiresApiKey && !config.apiKey?.trim()) {
      return { provider: new GoogleSearchProvider(), fellBack: true };
    }
    return { provider: entry.factory(config), fellBack: false };
  }
}

export function createDefaultSearchRegistry(): SearchProviderRegistry {
  return new SearchProviderRegistry()
    .register(googleDescriptor, () => new GoogleSearchProvider())
    .register(wikipediaDescriptor, () => new WikipediaSearchProvider())
    .register(braveDescriptor, (config) => new BraveSearchProvider(config));
}

/**
 * Registre de l'application : celui par défaut, plus les fournisseurs de la
 * chaîne de repli (DuckDuckGo, Bing, Google Actualités, Bing Actualités) et
 * Tavily (clé gratuite). Google reste le choix par défaut des réglages.
 */
export function createWebSearchRegistry(): SearchProviderRegistry {
  return createDefaultSearchRegistry()
    .register(duckDuckGoDescriptor, () => new DuckDuckGoSearchProvider())
    .register(bingDescriptor, () => new BingSearchProvider())
    .register(googleNewsDescriptor, () => new GoogleNewsRssProvider())
    .register(bingNewsDescriptor, () => new BingNewsRssProvider())
    .register(tavilyDescriptor, (config) => new TavilySearchProvider(config));
}
