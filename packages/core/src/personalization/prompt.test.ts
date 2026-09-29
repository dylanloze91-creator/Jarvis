import { describe, expect, it } from 'vitest';
import { buildPersonalizationPrompt } from './prompt.js';
import { emptyPersonalization } from './types.js';

describe('buildPersonalizationPrompt', () => {
  it('returns empty text for an empty profile', () => {
    expect(buildPersonalizationPrompt(emptyPersonalization())).toBe('');
  });

  it('renders assistant, user and rules', () => {
    const prompt = buildPersonalizationPrompt({
      version: 1,
      assistant: { tone: 'direct', name: 'Jarvis' },
      user: { preferredName: 'Monsieur' },
      rules: ['Répondre en français.'],
      updatedAt: Date.now(),
    });

    expect(prompt).toContain('PERSONNALISATION DE JARVIS');
    expect(prompt).toContain('tone: direct');
    expect(prompt).toContain('preferredName: Monsieur');
    expect(prompt).toContain('Répondre en français.');
    expect(prompt).toContain('MÉMOIRE DE PERSONNALISATION JARVIS');
  });
});
