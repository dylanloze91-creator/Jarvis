import { describe, expect, it } from 'vitest';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import { projectChatPrompt, projectChatSystemPrompt } from './projectChat.js';

describe('projectChat', () => {
  it('rappelle qu’aucune écriture directe n’est faite', () => {
    expect(projectChatSystemPrompt(JARVIS_PROJECT_PROFILE, 'notes')).toMatch(/mission « Modifier »/);
  });

  it('inclut l’historique dans le prompt', () => {
    const prompt = projectChatPrompt(
      [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Salut' }],
      'Et maintenant ?',
    );
    expect(prompt).toMatch(/Utilisateur :\nBonjour/);
    expect(prompt).toMatch(/Et maintenant \?/);
  });
});
