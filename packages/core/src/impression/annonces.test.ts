import { describe, expect, it } from 'vitest';
import { ANNONCES_DEFAUT, annoncer, heuresCalmes, ligneEcran } from './annonces.js';

const jour = new Date(2026, 10, 19, 15, 0);
const nuit = new Date(2026, 10, 19, 23, 30);
const matin = new Date(2026, 10, 20, 6, 59);

const etape = { level: 'etape' as const, text: 'Impression de cube : 50 %. Tout va bien. Reste environ 20 min.', photo: true };
const alerte = { level: 'alerte' as const, text: "Problème sur l'impression : la buse refroidit. Je la mets en pause.", photo: true };
const doute = { level: 'doute' as const, text: "Je ne vois plus l'imprimante.", photo: false };
const info = { level: 'info' as const, text: "Je surveille l'impression de cube.", photo: false };

describe('annonces de l’imprimante', () => {
  it('heures calmes : 23 h → 7 h par défaut, en passant minuit', () => {
    expect(heuresCalmes(22, ANNONCES_DEFAUT)).toBe(false);
    expect(heuresCalmes(23, ANNONCES_DEFAUT)).toBe(true);
    expect(heuresCalmes(3, ANNONCES_DEFAUT)).toBe(true);
    expect(heuresCalmes(7, ANNONCES_DEFAUT)).toBe(false);
    expect(heuresCalmes(3, { ...ANNONCES_DEFAUT, calmeDebut: 0, calmeFin: 0 })).toBe(false);
    expect(heuresCalmes(13, { ...ANNONCES_DEFAUT, calmeDebut: 12, calmeFin: 14 })).toBe(true);
  });

  it('le jour : un point d’avancement est dit et sonne sur le téléphone, avec la photo', () => {
    const a = annoncer(etape, jour);
    expect(a.voix).toBe(etape.text);
    expect(a.telephone).toBe('sonne');
    expect(a.photo).toBe(true);
    expect(a.titre).toBe('Imprimante — avancement');
    expect(a.ecran).toEqual({ titre: 'Imprimante — avancement', ligne: 'cube : 50 % · Tout va bien.', secondes: 60 });
  });

  it('la nuit : le point s’affiche seulement et arrive sans sonner', () => {
    for (const quand of [nuit, matin]) {
      const a = annoncer(etape, quand);
      expect(a.voix).toBeNull();
      expect(a.ecran).not.toBeNull();
      expect(a.telephone).toBe('silencieuse');
    }
    expect(annoncer(doute, nuit).voix).toBeNull();
  });

  it('une alerte est toujours dite et sonne, même la nuit, et reste à l’écran', () => {
    for (const quand of [jour, nuit]) {
      const a = annoncer(alerte, quand);
      expect(a.voix).toBe(alerte.text);
      expect(a.telephone).toBe('sonne');
      expect(a.ecran!.secondes).toBe(0);
      expect(a.titre).toBe('Imprimante — ALERTE');
    }
  });

  it('une simple information ne parle pas et ne sonne pas', () => {
    const a = annoncer(info, jour);
    expect(a.voix).toBeNull();
    expect(a.telephone).toBe('silencieuse');
    expect(a.ecran!.secondes).toBe(15);
  });

  it('enceinte ou téléphone coupés dans les réglages', () => {
    const sansEnceinte = annoncer(alerte, jour, { ...ANNONCES_DEFAUT, enceinte: false });
    expect(sansEnceinte.voix).toBeNull();
    expect(sansEnceinte.ecran).toBeNull();
    expect(sansEnceinte.telephone).toBe('sonne');
    expect(annoncer(alerte, jour, { ...ANNONCES_DEFAUT, telephone: false }).telephone).toBe('aucune');
  });

  it('ligne d’écran courte, jamais plus de 60 caractères', () => {
    expect(ligneEcran("Impression de cube terminée en 40 min. Tout s'est bien passé.")).toBe("cube terminée en 40 min. Tout s'est bien passé.");
    const long = ligneEcran(`Impression de ${'x'.repeat(100)} : 25 %. Tout va bien.`);
    expect(long.length).toBe(60);
    expect(long.endsWith('…')).toBe(true);
  });
});
