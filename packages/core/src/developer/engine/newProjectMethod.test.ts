import { describe, expect, it } from 'vitest';
import {
  briefWithoutTrademark,
  isPlatformerRequest,
  platformerProjectTitle,
  webResearchChatLine,
} from './newProjectMethod.js';
import { lockFactoryToRequest } from './fallbacks.js';

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

  it('ne laisse pas un titre de marque dans le brief ni le nom', () => {
    const brief = briefWithoutTrademark('Génère un jeu Mario 2D vue de côté');
    expect(brief.toLowerCase()).not.toContain('mario');
    expect(isPlatformerRequest(brief)).toBe(true);
    const out = lockFactoryToRequest(brief, {
      template: 'web-game',
      name: 'Mario',
      description: 'Jeu Mario',
    });
    expect(out.name).toBe(platformerProjectTitle());
    expect(out.description.toLowerCase()).not.toContain('mario');
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
