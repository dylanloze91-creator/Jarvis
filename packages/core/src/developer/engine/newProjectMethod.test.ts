import { describe, expect, it } from 'vitest';
import { slugify } from '../taskPolicy.js';
import {
  briefWithoutTrademark,
  isPlatformerRequest,
  librariesForCreation,
  webResearchChatLine,
} from './newProjectMethod.js';
import { lockFactoryToRequest, projectNameFromRequest, projectNameNeedsQuestion } from './fallbacks.js';

describe('newProjectMethod', () => {
  it('détecte une demande plateforme 2D', () => {
    expect(isPlatformerRequest('Crée un jeu de plateforme 2D vue de côté')).toBe(true);
    expect(isPlatformerRequest('Crée un Snake')).toBe(false);
  });

  it('verrouille le gabarit et le nom contre Snake si la demande est plateforme', () => {
    const out = lockFactoryToRequest('Crée un jeu de plateforme 2D vue de côté', {
      template: 'vite-react',
      name: 'Snake',
      description: 'Jeu du serpent',
    });
    expect(out.template).toBe('web-game');
    expect(out.name.toLowerCase()).not.toBe('snake');
    expect(out.description).toMatch(/plateforme/i);
  });

  it('« type mario » est une plateforme originale, pas un titre de marque', () => {
    const raw = 'Je souhaiterais un jeu type mario';
    expect(isPlatformerRequest(raw)).toBe(true);
    const brief = briefWithoutTrademark(raw);
    expect(brief.toLowerCase()).not.toContain('mario');
    expect(isPlatformerRequest(brief)).toBe(true);
    const out = lockFactoryToRequest(brief, {
      template: 'node-cli',
      name: 'Je souhaiterais un',
      description: 'Mario',
    });
    expect(out.template).toBe('web-game');
    expect(out.name.toLowerCase()).not.toContain('souhaiterais');
    expect(slugify(out.name)).toBe('jeu-plateforme-2d');
    expect(out.description.toLowerCase()).not.toContain('mario');
  });

  it('« jeu type jeu de plateforme 2D » ne prend pas les premiers mots de politesse', () => {
    const raw = 'Je souhaiterais un jeu type jeu de plateforme 2D';
    expect(projectNameFromRequest(raw)).toBe('Jeu plateforme 2D');
    expect(slugify(projectNameFromRequest(raw))).toBe('jeu-plateforme-2d');
    expect(projectNameNeedsQuestion(raw)).toBeNull();
    expect(projectNameNeedsQuestion('Je souhaiterais un')).toBe('Quel nom court pour ce projet ?');
  });

  it('une longue demande plateforme ne garde pas « que tu crées »', () => {
    const raw =
      'Je voudrais que tu crées un jeu pour tester tes possibilités en plateforme 2D. Si tu veux des inspirations, tu peux aller voir des jeux classiques.';
    expect(projectNameFromRequest(raw)).toBe('Jeu plateforme 2D');
    expect(slugify(projectNameFromRequest(raw))).toBe('jeu-plateforme-2d');
    expect(projectNameFromRequest('Crée une petite CLI qui renomme des photos')).toBe(
      'CLI qui renomme',
    );
  });

  it('ne laisse pas un titre de marque dans le brief ni le nom', () => {
    const brief = briefWithoutTrademark('Génère un jeu Mario 2D vue de côté');
    expect(brief.toLowerCase()).not.toContain('mario');
    expect(isPlatformerRequest(brief)).toBe(true);
    const out = lockFactoryToRequest(brief, {
      template: 'web-game',
      name: 'Mario',
      description: 'Jeu Mario',
    });
    expect(slugify(out.name)).toBe('jeu-plateforme-2d');
    expect(out.description.toLowerCase()).not.toContain('mario');
  });

  it('nomme la bibliothèque à installer, sans la dicter', () => {
    expect(librariesForCreation('Un jeu avec Phaser et un peu de p5.js')).toEqual(['phaser', 'p5']);
    expect(librariesForCreation('Jeu de plateforme 2D')).toEqual([]);
  });

  it('résume la recherche web en une ligne', () => {
    const line = webResearchChatLine(
      'plateforme 2D',
      'Side scroller canvas gravity platforms game loop',
    );
    expect(line).toMatch(/^Recherche web :/);
    expect(line).not.toMatch(/Snake/i);
  });
});
