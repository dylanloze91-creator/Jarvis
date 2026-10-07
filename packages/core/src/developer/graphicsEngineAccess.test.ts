import { describe, expect, it } from 'vitest';
import {
  commandTargetsGraphicsEngine,
  userGrantsGraphicsEngineInMessage,
  hasGraphicsEngineGrant,
} from './graphicsEngineAccess.js';

describe('graphicsEngineAccess', () => {
  it('détecte un oui après une question sur Godot', () => {
    expect(
      userGrantsGraphicsEngineInMessage('Oui', 'Veux-tu que j’installe Godot pour ce jeu ?'),
    ).toBe(true);
  });

  it('ignore un oui sans contexte moteur', () => {
    expect(userGrantsGraphicsEngineInMessage('Oui', 'Veux-tu ralentir la balle ?')).toBe(false);
  });

  it('reconnaît une commande Godot', () => {
    expect(commandTargetsGraphicsEngine('Godot_v4.2-stable_win64.exe --path .')).toBe(true);
    expect(commandTargetsGraphicsEngine('npm test')).toBe(false);
  });

  it('décisions mémorisées comptent comme accord', () => {
    expect(hasGraphicsEngineGrant(false, ['Accès moteur graphique accordé dans le chat'])).toBe(true);
  });
});
