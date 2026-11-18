import { describe, expect, it } from 'vitest';
import { parseSpeakerScreenRequest } from './screen.js';

describe('demande simple d’affichage lue par règles (sans modèle)', () => {
  it('« Affiche X sur l’enceinte de la Y » : titre et enceinte', () => {
    expect(parseSpeakerScreenRequest('Affiche Terminé sur l’enceinte de la chambre')).toEqual({ titre: 'Terminé', enceinte: 'chambre' });
    expect(parseSpeakerScreenRequest("Affiche Test sur l'enceinte de la cuisine.")).toEqual({ titre: 'Test', enceinte: 'cuisine' });
    expect(parseSpeakerScreenRequest('Jarvis, affiche-moi « Minuteur » sur l’enceinte du salon')).toEqual({ titre: 'Minuteur', enceinte: 'salon' });
  });

  it('phrase venue de la voix (minuscules, point final) : première lettre en majuscule', () => {
    expect(parseSpeakerScreenRequest("affiche terminée sur l'enceinte de la chambre.")).toEqual({ titre: 'Terminée', enceinte: 'chambre' });
  });

  it('sans nom d’enceinte : toutes', () => {
    expect(parseSpeakerScreenRequest('Affiche Test sur l’enceinte')).toEqual({ titre: 'Test' });
    expect(parseSpeakerScreenRequest('Écris Bravo sur les enceintes')).toEqual({ titre: 'Bravo' });
  });

  it('titre et ligne : virgule, ou « le titre … et la ligne … »', () => {
    expect(parseSpeakerScreenRequest('Affiche Dîner, à table ! sur l’enceinte')).toEqual({ titre: 'Dîner', ligne: 'à table !' });
    expect(parseSpeakerScreenRequest('Affiche sur l’enceinte de la chambre le titre Dîner et la ligne à table !')).toEqual({
      titre: 'Dîner',
      ligne: 'à table !',
      enceinte: 'chambre',
    });
  });

  it('« Affiche sur l’enceinte : … » ; un texte long est partagé entre le titre et la ligne, à un mot', () => {
    expect(parseSpeakerScreenRequest('Affiche sur l’enceinte de la chambre : Test')).toEqual({ titre: 'Test', enceinte: 'chambre' });
    const long = parseSpeakerScreenRequest(
      'Affiche Ceci est un texte volontairement très long pour vérifier que la coupe se fait proprement à un mot sur l’enceinte',
    )!;
    expect(new TextEncoder().encode(long.titre).length).toBeLessThanOrEqual(47);
    expect(`${long.titre} ${long.ligne}`).toBe('Ceci est un texte volontairement très long pour vérifier que la coupe se fait proprement à un mot');
  });

  it('autre chose : rien, le modèle ou les autres règles s’en occupent', () => {
    for (const text of [
      'Mets du jazz sur l’enceinte',
      'Affiche la météo',
      'Qu’est-ce qui est affiché sur l’enceinte ?',
      'Affiche sur l’enceinte',
      'Bonjour',
      '',
    ]) {
      expect(parseSpeakerScreenRequest(text), text).toBeNull();
    }
  });
});
