import { describe, expect, it } from 'vitest';
import {
  announcedFolderPath,
  carryOutMissionRequest,
  isCarryOutOrder,
  isCreateOrBuildOrder,
  isRetryOrder,
  isExistingWebGameChange,
  newProjectMissionFromProjectChat,
  routeProjectChatOrder,
  sameFolderPath,
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
    expect(routeProjectChatOrder('jappuie sur quel touche pour respawn', OPEN)).toBe('discuss');
    expect(routeProjectChatOrder('tu me repond', OPEN)).toBe('discuss');
  });

  it('« réessaie » ou « tu as échoué » relance le Codeur sur le projet ouvert', () => {
    const retry = 'tu as echoue sur l ajout du bouton respawn reessaye';
    expect(isRetryOrder(retry)).toBe(true);
    expect(routeProjectChatOrder(retry, { jarvis: false, template: 'web-game' })).toBe('direct');
    expect(routeProjectChatOrder('reessaye le bouton', OPEN)).toBe('direct');
    expect(isRetryOrder('pourquoi les tests ont échoué ?')).toBe(false);
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

  it('« fait le toi » reprend l’ordre dans le dossier déjà annoncé', () => {
    expect(isCarryOutOrder('fait le toi')).toBe(true);
    expect(routeProjectChatOrder('fait le toi', { jarvis: false, template: 'web-game' })).toBe(
      'supervise-open',
    );
    const messages = [
      { role: 'user', content: 'Je souhaiterais un jeu type mario' },
      {
        role: 'assistant',
        content: 'Je le mets dans C:\\dev\\Projets\\nouveau-projet puis j’écris le niveau.',
      },
      { role: 'user', content: 'fait le toi' },
    ];
    expect(announcedFolderPath(messages)).toBe('C:\\dev\\Projets\\nouveau-projet');
    expect(sameFolderPath(announcedFolderPath(messages)!, 'C:/dev/Projets/nouveau-projet')).toBe(
      true,
    );
    const order = carryOutMissionRequest(messages, 'fait le toi');
    expect(order.toLowerCase()).not.toContain('mario');
    expect(order).toMatch(/plateforme/i);
  });

  it('« je souhaiterais un jeu type mario » est un ordre de plateforme, pas une discussion', () => {
    expect(
      routeProjectChatOrder('Je souhaiterais un jeu type mario', {
        jarvis: false,
        template: 'web-game',
      }),
    ).toBe('supervise-open');
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
