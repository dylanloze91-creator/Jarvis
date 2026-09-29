import { describe, expect, it } from 'vitest';
import { emptyPersonalization, normalizePersonalization } from './types.js';

describe('normalizePersonalization', () => {
  it('returns an empty profile for invalid input', () => {
    expect(normalizePersonalization(null).version).toBe(1);
    expect(normalizePersonalization('nope').assistant).toEqual({});
    expect(normalizePersonalization(undefined).rules).toEqual([]);
  });

  it('keeps well-formed assistant, user and rules entries', () => {
    const profile = normalizePersonalization({
      version: 1,
      assistant: { tone: 'direct' },
      user: { preferredName: 'Monsieur' },
      rules: ['Réponses courtes.', '', 12],
      updatedAt: 42,
    });

    expect(profile).toEqual({
      version: 1,
      assistant: { tone: 'direct' },
      user: { preferredName: 'Monsieur' },
      rules: ['Réponses courtes.'],
      updatedAt: 42,
    });
  });

  it('drops non-string record values', () => {
    const profile = normalizePersonalization({
      assistant: { tone: 'calme', extra: 3 },
      user: ['Monsieur'],
    });
    expect(profile.assistant).toEqual({});
    expect(profile.user).toEqual({});
  });

  it('emptyPersonalization is a valid v1 profile', () => {
    const profile = emptyPersonalization();
    expect(profile.version).toBe(1);
    expect(profile.assistant).toEqual({});
    expect(profile.user).toEqual({});
    expect(profile.rules).toEqual([]);
  });
});
