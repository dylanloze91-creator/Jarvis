import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import {
  emptyPersonalization,
  normalizePersonalization,
  type PersonalizationProfile,
  type PersonalizationScope,
} from '@jarvis/core';

const FILE_NAME = 'personalization.json';

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

export class PersonalizationStore {
  private profile: PersonalizationProfile | null = null;

  async get(): Promise<PersonalizationProfile> {
    if (this.profile) return structuredClone(this.profile);

    try {
      const raw = await readFile(filePath(), 'utf8');
      this.profile = normalizePersonalization(JSON.parse(raw));
    } catch {
      this.profile = emptyPersonalization();
    }

    return structuredClone(this.profile);
  }

  async set(
    scope: PersonalizationScope,
    key: string,
    value: string,
  ): Promise<PersonalizationProfile> {
    const profile = await this.get();
    const target = scope === 'assistant' ? profile.assistant : profile.user;

    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) {
      throw new Error('La clé et la valeur de personnalisation sont obligatoires.');
    }

    target[normalizedKey] = normalizedValue;
    profile.updatedAt = Date.now();
    await this.save(profile);
    return structuredClone(profile);
  }

  async addRule(rule: string): Promise<PersonalizationProfile> {
    const profile = await this.get();
    const normalized = rule.trim();
    if (!normalized) throw new Error('La règle de personnalisation est vide.');

    if (!profile.rules.includes(normalized)) {
      profile.rules.push(normalized);
    }
    profile.updatedAt = Date.now();
    await this.save(profile);
    return structuredClone(profile);
  }

  async forget(scope: PersonalizationScope, key: string): Promise<PersonalizationProfile> {
    const profile = await this.get();
    const target = scope === 'assistant' ? profile.assistant : profile.user;
    delete target[key.trim()];
    profile.updatedAt = Date.now();
    await this.save(profile);
    return structuredClone(profile);
  }

  async removeRule(rule: string): Promise<PersonalizationProfile> {
    const profile = await this.get();
    profile.rules = profile.rules.filter((item) => item !== rule.trim());
    profile.updatedAt = Date.now();
    await this.save(profile);
    return structuredClone(profile);
  }

  async reset(): Promise<PersonalizationProfile> {
    const profile = emptyPersonalization();
    await this.save(profile);
    return structuredClone(profile);
  }

  private async save(profile: PersonalizationProfile): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(filePath(), JSON.stringify(profile, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    this.profile = profile;
  }
}
