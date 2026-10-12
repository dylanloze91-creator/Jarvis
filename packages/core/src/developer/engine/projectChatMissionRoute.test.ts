import { describe, expect, it } from 'vitest';
import {
  isExistingWebGameChange,
  newProjectMissionFromProjectChat,
} from './projectChatMissionRoute.js';

describe('newProjectMissionFromProjectChat', () => {
  it('plateforme 2D depuis le chat → nouveau projet', () => {
    expect(
      newProjectMissionFromProjectChat(
        'Crée un jeu de plateforme 2D vue de côté : saut, collectable, piège, victoire.',
      ),
    ).toBe(true);
    expect(
      newProjectMissionFromProjectChat(
        'Pour thedexios : un jeu de plateforme 2D sur le gabarit, niveau jouable.',
      ),
    ).toBe(true);
  });

  it('modification Pong sur gabarit existant → pas nouveau projet', () => {
    expect(newProjectMissionFromProjectChat('Augmente la vitesse de la balle dans Pong')).toBe(
      false,
    );
  });

  it('question → pas nouveau projet', () => {
    expect(newProjectMissionFromProjectChat('Comment marche level.ts ?')).toBe(false);
  });
});

describe('isExistingWebGameChange', () => {
  it('web-game + demande claire → direct', () => {
    expect(
      isExistingWebGameChange('Augmente la vitesse de saut', 'web-game'),
    ).toBe(true);
  });
});
