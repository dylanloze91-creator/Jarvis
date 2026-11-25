import { describe, expect, it } from 'vitest';
import { ecrireStlBinaire, maillageBoiteCreuse } from '@jarvis/core';
import { atelierSampleVersions } from '../../preview/atelierSample';
import { etatVersion, raisonPasImprimable, type VersionAtelier } from './atelierEtat';

describe('écran Atelier : état d’une version', () => {
  it('une version rendue et juste peut être proposée à l’impression', () => {
    const [v1] = atelierSampleVersions();
    const etat = etatVersion(v1);
    expect(etat.controle?.ok).toBe(true);
    expect(etat.maillage?.triangles).toBeGreaterThan(0);
    expect(raisonPasImprimable(v1, etat)).toBeNull();
  });

  it('pas encore rendue : on attend, pas d’impression', () => {
    const v: VersionAtelier = { numero: 1, fiche: 'Boîte.', mesures: [], stl: null };
    expect(raisonPasImprimable(v, etatVersion(v))).toBe('La pièce n’est pas encore rendue.');
  });

  it('fichier illisible : dit, pas d’impression', () => {
    const v: VersionAtelier = { numero: 1, fiche: 'Boîte.', mesures: [], stl: new TextEncoder().encode('pas un STL du tout') };
    const etat = etatVersion(v);
    expect(etat.erreur).toBeTruthy();
    expect(raisonPasImprimable(v, etat)).toBe('Le fichier de la pièce est illisible.');
  });

  it('mesures fausses : le contrôle le dit et l’impression attend', () => {
    const v: VersionAtelier = {
      numero: 1,
      fiche: 'Boîte.',
      mesures: [],
      stl: ecrireStlBinaire(maillageBoiteCreuse(80, 50, 30, 2, 2)),
      tailleAttendue: [80, 50, 40],
    };
    const etat = etatVersion(v);
    expect(etat.controle?.problemes).toEqual(['hauteur : 30 mm au lieu de 40 mm.']);
    expect(raisonPasImprimable(v, etat)).toContain('problème');
  });

  it('pas de version : rien à imprimer', () => {
    expect(raisonPasImprimable(undefined, etatVersion(undefined))).toBe('Aucune version.');
  });
});
