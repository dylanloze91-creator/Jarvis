import { describe, expect, it } from 'vitest';
import {
  emptyPersonalization,
  type PersonalizationProfile,
  type PersonalizationScope,
} from '@jarvis/core';
import { createPersonalizationTools } from './personalization.js';
import type { PersonalizationStore } from '../personalization.js';
import type { ToolContext } from '@jarvis/core';

class MemoryStore {
  profile: PersonalizationProfile = emptyPersonalization();

  async get(): Promise<PersonalizationProfile> {
    return structuredClone(this.profile);
  }

  async set(
    scope: PersonalizationScope,
    key: string,
    value: string,
  ): Promise<PersonalizationProfile> {
    const target = scope === 'assistant' ? this.profile.assistant : this.profile.user;
    target[key] = value;
    this.profile.updatedAt = Date.now();
    return structuredClone(this.profile);
  }

  async addRule(rule: string): Promise<PersonalizationProfile> {
    if (!this.profile.rules.includes(rule)) this.profile.rules.push(rule);
    this.profile.updatedAt = Date.now();
    return structuredClone(this.profile);
  }

  async forget(scope: PersonalizationScope, key: string): Promise<PersonalizationProfile> {
    const target = scope === 'assistant' ? this.profile.assistant : this.profile.user;
    delete target[key];
    this.profile.updatedAt = Date.now();
    return structuredClone(this.profile);
  }

  async removeRule(rule: string): Promise<PersonalizationProfile> {
    this.profile.rules = this.profile.rules.filter((item) => item !== rule);
    return structuredClone(this.profile);
  }

  async reset(): Promise<PersonalizationProfile> {
    this.profile = emptyPersonalization();
    return structuredClone(this.profile);
  }
}

function fakeContext(): ToolContext {
  return { requestConfirmation: async () => true };
}

describe('createPersonalizationTools', () => {
  it('déclare les cinq outils, get en lecture seule et le reste en confirmation', () => {
    const tools = createPersonalizationTools(new MemoryStore() as unknown as PersonalizationStore);
    expect(tools.map((tool) => tool.name)).toEqual([
      'get_jarvis_personalization',
      'set_jarvis_personalization',
      'add_jarvis_personalization_rule',
      'forget_jarvis_personalization',
      'reset_jarvis_personalization',
    ]);
    expect(tools[0]?.risk).toBe('safe');
    expect(tools.slice(1).every((tool) => tool.risk === 'confirm')).toBe(true);
  });

  it('enregistre une préférence et la relit', async () => {
    const store = new MemoryStore();
    const tools = createPersonalizationTools(store as unknown as PersonalizationStore);
    const setTool = tools.find((tool) => tool.name === 'set_jarvis_personalization')!;
    const getTool = tools.find((tool) => tool.name === 'get_jarvis_personalization')!;

    const written = await setTool.run(
      { scope: 'user', key: 'preferredName', value: 'Monsieur' },
      fakeContext(),
    );
    expect(written.ok).toBe(true);

    const read = await getTool.run({}, fakeContext());
    expect(read.ok).toBe(true);
    expect(read.content).toContain('preferredName=Monsieur');
  });

  it('ajoute une règle persistante sans la dupliquer', async () => {
    const store = new MemoryStore();
    const ruleTool = createPersonalizationTools(store as unknown as PersonalizationStore).find(
      (tool) => tool.name === 'add_jarvis_personalization_rule',
    )!;

    await ruleTool.run({ rule: 'Réponses courtes.' }, fakeContext());
    await ruleTool.run({ rule: 'Réponses courtes.' }, fakeContext());
    expect(store.profile.rules).toEqual(['Réponses courtes.']);
  });

  it('oublie une clé précise sans tout effacer', async () => {
    const store = new MemoryStore();
    store.profile.user.preferredName = 'Monsieur';
    store.profile.assistant.tone = 'direct';
    const forgetTool = createPersonalizationTools(store as unknown as PersonalizationStore).find(
      (tool) => tool.name === 'forget_jarvis_personalization',
    )!;

    await forgetTool.run({ scope: 'user', key: 'preferredName' }, fakeContext());
    expect(store.profile.user.preferredName).toBeUndefined();
    expect(store.profile.assistant.tone).toBe('direct');
  });

  it('efface toute la mémoire persistante', async () => {
    const store = new MemoryStore();
    store.profile.user.preferredName = 'Monsieur';
    store.profile.rules = ['Réponses courtes.'];
    const resetTool = createPersonalizationTools(store as unknown as PersonalizationStore).find(
      (tool) => tool.name === 'reset_jarvis_personalization',
    )!;

    const result = await resetTool.run({}, fakeContext());
    expect(result.ok).toBe(true);
    expect(store.profile.user).toEqual({});
    expect(store.profile.rules).toEqual([]);
  });
});
