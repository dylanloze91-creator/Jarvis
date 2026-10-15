import { describe, expect, it } from 'vitest';
import {
  isCreateOrBuildOrder,
  isExistingWebGameChange,
  newProjectMissionFromProjectChat,
  routeProjectChatOrder,
} from './projectChatMissionRoute.js';

const OPEN = { jarvis: false, template: null as string | null };

describe('newProjectMissionFromProjectChat', () => {
  it('un jeu dans le chat n’ouvre pas un autre dossier', () => {
    expect(
      newProjectMissionFromProjectChat(
        'Crée un jeu de plateforme 2D vue de côté : saut, collectable, piège, victoire.',
      ),
    ).toBe(false);
    expect(
      newProjectMissionFromProjectChat(
        'Pour thedexios : un jeu de plateforme 2D sur le gabarit, niveau jouable.',
      ),
    ).toBe(false);
  });

  it('les mots « nouveau projet » ouvrent un dossier neuf', () => {
    expect(newProjectMissionFromProjectChat('Nouveau projet : un site pour mes recettes')).toBe(
      true,
    );
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

describe('isCreateOrBuildOrder', () => {
  it('génère un jeu : ordre pour le Superviseur, même sans le mot plateforme', () => {
    expect(
      isCreateOrBuildOrder(
        'Génère un jeu 2D vue de côté, jouable dans le navigateur, avec saut et une arrivée.',
      ),
    ).toBe(true);
    expect(
      isCreateOrBuildOrder('Je veux une appli de notes qui tourne sur ce PC.'),
    ).toBe(true);
  });

  it('une question ou une retouche n’est pas un ordre de création', () => {
    expect(isCreateOrBuildOrder('Comment marche level.ts ?')).toBe(false);
    expect(isCreateOrBuildOrder('Augmente la vitesse de la balle dans Pong')).toBe(false);
    expect(isCreateOrBuildOrder('Nouveau projet : une petite CLI')).toBe(false);
  });
});

describe('routeProjectChatOrder', () => {
  it('ordre de jeu sur le projet ouvert → Superviseur dans ce dossier', () => {
    expect(
      routeProjectChatOrder(
        'Génère un jeu de plateforme 2D vue de côté avec saut, plateformes et une arrivée.',
        OPEN,
      ),
    ).toBe('supervise-open');
  });

  it('« nouveau projet » → dossier neuf', () => {
    expect(routeProjectChatOrder('Nouveau projet : une appli de recettes', OPEN)).toBe(
      'new-folder',
    );
  });

  it('retouche d’un jeu existant → direct', () => {
    expect(
      routeProjectChatOrder('Augmente la vitesse de saut', {
        jarvis: false,
        template: 'web-game',
      }),
    ).toBe('direct');
  });

  it('question → discussion', () => {
    expect(routeProjectChatOrder('Comment marche level.ts ?', OPEN)).toBe('discuss');
  });

  it('« Crée un jeu de plateforme 2D » part au Superviseur, pas en discussion', () => {
    expect(routeProjectChatOrder('Crée un jeu de plateforme 2D', OPEN)).toBe('supervise-open');
    expect(routeProjectChatOrder('Écris un jeu 2D jouable', OPEN)).toBe('supervise-open');
    expect(routeProjectChatOrder('Comment créer un jeu de plateforme', OPEN)).toBe(
      'supervise-open',
    );
  });

  it('une retouche n’est pas une création', () => {
    expect(
      isCreateOrBuildOrder('Augmente la vitesse de la balle dans Pong', 'web-game'),
    ).toBe(false);
  });

  it('Jarvis n’est pas le dossier cible d’un jeu', () => {
    expect(
      routeProjectChatOrder('Génère un jeu de plateforme 2D', { jarvis: true, template: null }),
    ).toBe('jarvis-not-target');
  });
});

describe('isExistingWebGameChange', () => {
  it('web-game + demande claire → direct', () => {
    expect(isExistingWebGameChange('Augmente la vitesse de saut', 'web-game')).toBe(true);
  });

  it('créer un jeu sur un gabarit web-game reste un ordre Superviseur', () => {
    expect(
      isExistingWebGameChange('Génère un jeu de plateforme 2D jouable', 'web-game'),
    ).toBe(false);
  });
});
