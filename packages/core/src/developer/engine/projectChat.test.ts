import { describe, expect, it } from 'vitest';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import {
  missionRequestFromProjectChat,
  projectChatPrompt,
  projectChatSystemPrompt,
} from './projectChat.js';

describe('projectChat', () => {
  it('rappelle qu’aucune écriture directe n’est faite', () => {
    expect(
      projectChatSystemPrompt(JARVIS_PROJECT_PROFILE, 'notes', [], ['qwen2.5-coder:14b'], true),
    ).toMatch(/mission « Modifier »/);
  });

  it('inclut l’historique dans le prompt', () => {
    const prompt = projectChatPrompt(
      [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Salut' }],
      'Et maintenant ?',
      false,
    );
    expect(prompt).toMatch(/Utilisateur :\nBonjour/);
    expect(prompt).toMatch(/Et maintenant \?/);
  });

  it('transmet le fil complet pour une mission', () => {
    const { summary, discussionContext } = missionRequestFromProjectChat(
      [
        { role: 'user', content: 'Ralentis le jeu' },
        { role: 'assistant', content: 'OK' },
        { role: 'user', content: 'Encore plus lent' },
      ],
      ['vitesse max 600'],
    );
    expect(summary).toContain('Encore plus lent');
    expect(discussionContext).toMatch(/Ralentis le jeu/);
    expect(discussionContext).toMatch(/vitesse max 600/);
  });
});
