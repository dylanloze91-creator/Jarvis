import type {
  SpeechProviderConfig,
  SpeechToTextDescriptor,
  SpeechToTextFactory,
  SpeechToTextProvider,
  TextToSpeechDescriptor,
  TextToSpeechFactory,
  TextToSpeechProvider,
} from './types.js';

interface SttEntry {
  descriptor: SpeechToTextDescriptor;
  factory: SpeechToTextFactory;
}

interface TtsEntry {
  descriptor: TextToSpeechDescriptor;
  factory: TextToSpeechFactory;
}

/**
 * Registre des moteurs de reconnaissance vocale. Même principe que
 * `ProviderRegistry` pour les modèles de langage : un nouveau moteur
 * s'ajoute avec un `register()`, sans toucher au reste de l'application.
 *
 * À la différence de `ProviderRegistry`, le repli en l'absence de clé API
 * n'est pas câblé sur une implémentation précise : il retombe sur le premier
 * moteur enregistré qui ne demande pas de clé (le moteur local). C'est ce
 * moteur-là qui varie selon la plateforme (navigateur, mobile…), alors que
 * `packages/core` ne peut pas en connaître l'implémentation.
 */
export class SpeechToTextRegistry {
  private readonly entries = new Map<string, SttEntry>();

  register(descriptor: SpeechToTextDescriptor, factory: SpeechToTextFactory): this {
    this.entries.set(descriptor.id, { descriptor, factory });
    return this;
  }

  list(): SpeechToTextDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  describe(id: string): SpeechToTextDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  create(config: SpeechProviderConfig): SpeechToTextProvider {
    const entry = this.entries.get(config.provider);
    if (!entry) {
      throw new Error(`Moteur de reconnaissance vocale inconnu : ${config.provider}`);
    }
    return entry.factory(config);
  }

  createOrFallback(config: SpeechProviderConfig): {
    provider: SpeechToTextProvider;
    fellBack: boolean;
  } {
    const entry = this.entries.get(config.provider);
    const needsFallback = !entry || (entry.descriptor.requiresApiKey && !config.apiKey?.trim());
    if (!needsFallback && entry) {
      return { provider: entry.factory(config), fellBack: false };
    }
    const local = [...this.entries.values()].find(
      (candidate) => !candidate.descriptor.requiresApiKey,
    );
    if (!local) {
      throw new Error('Aucun moteur de reconnaissance vocale local disponible en repli.');
    }
    return { provider: local.factory(config), fellBack: true };
  }
}

/** Registre des moteurs de synthèse vocale, symétrique à `SpeechToTextRegistry`. */
export class TextToSpeechRegistry {
  private readonly entries = new Map<string, TtsEntry>();

  register(descriptor: TextToSpeechDescriptor, factory: TextToSpeechFactory): this {
    this.entries.set(descriptor.id, { descriptor, factory });
    return this;
  }

  list(): TextToSpeechDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  describe(id: string): TextToSpeechDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  create(config: SpeechProviderConfig): TextToSpeechProvider {
    const entry = this.entries.get(config.provider);
    if (!entry) {
      throw new Error(`Moteur de synthèse vocale inconnu : ${config.provider}`);
    }
    return entry.factory(config);
  }

  createOrFallback(config: SpeechProviderConfig): {
    provider: TextToSpeechProvider;
    fellBack: boolean;
  } {
    const entry = this.entries.get(config.provider);
    const needsFallback = !entry || (entry.descriptor.requiresApiKey && !config.apiKey?.trim());
    if (!needsFallback && entry) {
      return { provider: entry.factory(config), fellBack: false };
    }
    const local = [...this.entries.values()].find(
      (candidate) => !candidate.descriptor.requiresApiKey,
    );
    if (!local) {
      throw new Error('Aucun moteur de synthèse vocale local disponible en repli.');
    }
    return { provider: local.factory(config), fellBack: true };
  }
}
