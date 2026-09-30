import { describe, expect, it } from 'vitest';
import {
  classifyClaim,
  formatVideoAnalysis,
  importanceBand,
  scoreSegment,
  visionHook,
} from './analysis.js';

describe('score vidéo', () => {
  it('place un chiffre et une conclusion au-dessus d’une transition', () => {
    const strong = scoreSegment('En conclusion, le bénéfice atteint 12 milliards.', 0);
    const weak = scoreSegment('Bonjour à tous, passons à la suite de cette introduction.', 1);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.band === 'important' || strong.band === 'critique').toBe(true);
    expect(importanceBand(20)).toBe('faible');
    expect(importanceBand(45)).toBe('moyen');
    expect(importanceBand(70)).toBe('important');
    expect(importanceBand(90)).toBe('critique');
  });

  it('baisse le score d’une répétition', () => {
    const first = scoreSegment('La marge opérationnelle reste à 18 pour cent cette année.', 0);
    const again = scoreSegment('La marge opérationnelle reste à 18 pour cent cette année.', 1, first.text);
    expect(again.signals).toContain('répétition');
    expect(again.score).toBeLessThan(first.score);
  });

  it('ne transforme pas une opinion en fait', () => {
    expect(classifyClaim("L'analyste considère cette croissance suffisante.").kind).toBe('OPINION');
    expect(classifyClaim("L'analyste prévoit une hausse du titre.").kind).toBe('PREDICTION');
    expect(classifyClaim("L'entreprise annonce 12 milliards de chiffre d'affaires.").kind).toBe('FACT');
    expect(classifyClaim('Cette prévision dépend du marché.').kind).toBe('UNCERTAINTY');
  });

  it('dit que la vision est indisponible sans prétendre lire un graphique', () => {
    const hook = visionHook('À 18:42 le graphique montre la marge.', [
      {
        index: 0,
        text: 'le graphique montre la marge',
        timestamp: '18:42',
        score: 70,
        band: 'important',
        signals: ['chiffre'],
      },
    ]);
    expect(hook.available).toBe(false);
    expect(hook.message).toMatch(/Vision indisponible/);
    expect(hook.message).toMatch(/n'a été lu/);
    expect(hook.message).toMatch(/18:42/);
  });

  it('produit un résumé pédagogique borné, avec horodatage', () => {
    const transcript = '[12:04 → 12:40] En conclusion, la marge atteint 18 %. Le risque de dette reste élevé.';
    const text = formatVideoAnalysis(transcript, 'La marge et la dette sont les deux points.');
    expect(text).toMatch(/Ce qu’il faut comprendre/);
    expect(text).toMatch(/5 points essentiels/);
    expect(text).toMatch(/12:04/);
    expect(text.length).toBeLessThan(4000);
    expect(text).not.toMatch(/transcript complet est envoyé/i);
  });
});
