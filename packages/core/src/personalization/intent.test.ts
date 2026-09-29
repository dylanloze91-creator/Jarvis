import { describe, expect, it } from 'vitest';
import { extractPersonalizationIntent } from './intent.js';

describe('extractPersonalizationIntent', () => {
  it('routes « appelle-moi Monsieur » to set preferredName', () => {
    expect(extractPersonalizationIntent('Appelle-moi Monsieur.')).toEqual({
      tool: 'set_jarvis_personalization',
      args: { scope: 'user', key: 'preferredName', value: 'Monsieur' },
    });
  });

  it('routes « à partir de maintenant, sois direct et professionnel » to assistant tone', () => {
    expect(
      extractPersonalizationIntent('À partir de maintenant, sois direct et professionnel.'),
    ).toEqual({
      tool: 'set_jarvis_personalization',
      args: { scope: 'assistant', key: 'tone', value: 'direct et professionnel' },
    });
  });

  it('routes « retiens que … » to a persistent rule', () => {
    expect(extractPersonalizationIntent('Retiens que je veux des réponses courtes.')).toEqual({
      tool: 'add_jarvis_personalization_rule',
      args: { rule: 'je veux des réponses courtes' },
    });
  });

  it('routes « retiens que je préfère utiliser Ollama » to a rule', () => {
    expect(extractPersonalizationIntent('Retiens que je préfère utiliser Ollama.')).toEqual({
      tool: 'add_jarvis_personalization_rule',
      args: { rule: 'je préfère utiliser Ollama' },
    });
  });

  it('routes « oublie ma préférence sur le ton » to forget assistant.tone', () => {
    expect(extractPersonalizationIntent('Oublie ma préférence sur le ton.')).toEqual({
      tool: 'forget_jarvis_personalization',
      args: { scope: 'assistant', key: 'tone' },
    });
  });

  it('routes « montre-moi ta personnalisation actuelle » to get', () => {
    expect(extractPersonalizationIntent('Montre-moi ta personnalisation actuelle.')).toEqual({
      tool: 'get_jarvis_personalization',
      args: {},
    });
  });

  it('routes « efface toute ta personnalisation » to reset', () => {
    expect(extractPersonalizationIntent('Efface toute ta personnalisation.')).toEqual({
      tool: 'reset_jarvis_personalization',
      args: {},
    });
  });

  it('does not treat an ordinary request as personalization', () => {
    expect(extractPersonalizationIntent('Ouvre Chrome')).toBeNull();
    expect(extractPersonalizationIntent('écouter On Verra de Nekfeu')).toBeNull();
    expect(extractPersonalizationIntent('Quelle heure est-il ?')).toBeNull();
  });
});
