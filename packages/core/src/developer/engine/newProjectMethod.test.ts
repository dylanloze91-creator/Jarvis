import { describe, expect, it } from 'vitest';
import { developerAgentSplitChatLines, isPlatformerRequest, webResearchChatLine } from './newProjectMethod.js';
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

  it('produit des lignes d’équipe en français', () => {
    const lines = developerAgentSplitChatLines('jeu de plateforme 2D');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join(' ')).toMatch(/Chercheur web/);
    expect(lines.join(' ')).toMatch(/Codeur/);
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
