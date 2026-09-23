import { AnthropicProvider, anthropicDescriptor } from './anthropic.js';
import { MockProvider, mockDescriptor } from './mock.js';
import { OpenAIProvider, openAIDescriptor } from './openai.js';
import type { LLMProvider, ProviderConfig, ProviderDescriptor, ProviderFactory } from './types.js';

interface Entry {
  descriptor: ProviderDescriptor;
  factory: ProviderFactory;
}

/**
 * Point d'extension du choix de modèle : un nouveau fournisseur s'ajoute avec
 * un `register()`, sans modifier l'agent, l'IPC ni l'interface.
 */
export class ProviderRegistry {
  private readonly entries = new Map<string, Entry>();

  register(descriptor: ProviderDescriptor, factory: ProviderFactory): this {
    this.entries.set(descriptor.id, { descriptor, factory });
    return this;
  }

  list(): ProviderDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  describe(id: string): ProviderDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  create(config: ProviderConfig): LLMProvider {
    const entry = this.entries.get(config.provider);
    if (!entry) {
      throw new Error(`Provider inconnu : ${config.provider}`);
    }
    return entry.factory(config);
  }

  /**
   * Bascule sur le provider de démonstration plutôt que d'échouer quand la
   * configuration est incomplète, pour que l'application reste utilisable.
   */
  createOrFallback(config: ProviderConfig): { provider: LLMProvider; fellBack: boolean } {
    const entry = this.entries.get(config.provider);
    if (!entry) return { provider: new MockProvider(), fellBack: true };
    if (entry.descriptor.requiresApiKey && !config.apiKey?.trim()) {
      return { provider: new MockProvider(), fellBack: true };
    }
    return { provider: entry.factory(config), fellBack: false };
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(mockDescriptor, (config) => new MockProvider(config))
    .register(openAIDescriptor, (config) => new OpenAIProvider(config))
    .register(anthropicDescriptor, (config) => new AnthropicProvider(config));
}
