import { describe, expect, it } from 'vitest';
import {
  developerAgentFinished,
  developerAgentStarted,
  developerStepSentence,
} from './missionAgents.js';

describe('missionAgents', () => {
  it('formate début et fin en français', () => {
    expect(developerAgentStarted('web', 'cherche une méthode')).toMatch(/▶ Recherche web/);
    expect(developerAgentFinished('testeur', 'tests OK')).toMatch(/✓ Tests npm/);
  });

  it('une étape finie tient en une phrase concrète', () => {
    expect(
      developerStepSentence({
        name: 'Préparateur',
        status: 'done',
        detail: 'C:\\dev\\Projets\\jeu-rpg',
      }),
    ).toBe('Dossier créé : C:\\dev\\Projets\\jeu-rpg.');
    expect(
      developerStepSentence({
        name: 'Codeur',
        status: 'done',
        files: ['src/game.ts'],
      }),
    ).toBe('Codeur : src/game.ts modifié.');
    expect(
      developerStepSentence({
        name: 'Testeur',
        status: 'done',
        detail: 'test : 6 tests réussis',
      }),
    ).toBe('Testeur : 6 tests passés.');
    expect(
      developerStepSentence({
        name: 'Codeur',
        status: 'failed',
        error: 'le fichier n’a pas changé',
      }),
    ).toBe('Échec du codeur : le fichier n’a pas changé.');
  });
});
