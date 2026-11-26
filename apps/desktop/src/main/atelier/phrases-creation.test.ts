import { describe, expect, it } from 'vitest';
import { detectCreationRequest } from '@jarvis/core';
import { DISCUSSIONS, DISCUSSIONS_EXAMEN, DISCUSSIONS_EXAMEN_2 } from './phrasesAtelier.js';

/**
 * Dans Jarvis Test, une demande de création (Développeur facile) passe avant l'atelier 3D. Aucune
 * des phrases d'essai de l'atelier ne doit donc être prise pour une application à créer.
 */
describe('les phrases de l’atelier ne sont pas des créations d’application', () => {
  const phrases = [...DISCUSSIONS, ...DISCUSSIONS_EXAMEN, ...DISCUSSIONS_EXAMEN_2].flatMap((discussion) =>
    discussion.tours.map((tour) => tour.dire),
  );

  it('il y a bien des phrases à vérifier', () => {
    expect(phrases.length).toBeGreaterThan(250);
  });

  it('aucune n’est reconnue comme une création', () => {
    expect(phrases.filter((phrase) => detectCreationRequest(phrase) !== null)).toEqual([]);
  });
});
