import { describe, expect, it } from 'vitest';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import {
  missionRequestFromProjectChat,
  projectChatPrompt,
  projectChatSystemPrompt,
} from './projectChat.js';

describe('projectChat', () => {
  it('interdit les commandes à copier et le code à coller', () => {
    const prompt = projectChatSystemPrompt(
      JARVIS_PROJECT_PROFILE,
      'notes',
      [],
      ['qwen2.5-coder:14b'],
      true,
    );
    expect(prompt).toMatch(/Ne donne jamais de commandes à copier/i);
    expect(prompt).toMatch(/npm install/);
    expect(prompt).toMatch(/voulez-vous que je vous donne le code/i);
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
