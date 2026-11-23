/**
 * Aperçu de l'écran « Atelier » sans OpenSCAD : deux versions d'une boîte, dont les STL sont
 * fabriqués par le cœur (`maillageBoiteCreuse`). Sert à la scène d'aperçu et aux essais.
 */
import { ecrireStlBinaire, maillageBoiteCreuse } from '@jarvis/core';
import type { VersionAtelier } from '../components/atelier/atelierEtat';

export function atelierSampleVersions(): VersionAtelier[] {
  return [
    {
      numero: 1,
      fiche: 'Boîte de 80 × 50 × 30 mm.',
      mesures: [
        { nom: 'Longueur', valeur: '80 mm' },
        { nom: 'Largeur', valeur: '50 mm' },
        { nom: 'Hauteur', valeur: '30 mm' },
        { nom: 'Parois', valeur: '2 mm' },
        { nom: 'Fond', valeur: '2 mm' },
      ],
      stl: ecrireStlBinaire(maillageBoiteCreuse(80, 50, 30, 2, 2)),
      tailleAttendue: [80, 50, 30],
      temps: '1 h 12',
      filament: '18 g',
    },
    {
      numero: 2,
      fiche: 'Boîte de 80 × 50 × 45 mm.',
      mesures: [
        { nom: 'Longueur', valeur: '80 mm' },
        { nom: 'Largeur', valeur: '50 mm' },
        { nom: 'Hauteur', valeur: '45 mm' },
        { nom: 'Parois', valeur: '2 mm' },
        { nom: 'Fond', valeur: '2 mm' },
      ],
      stl: ecrireStlBinaire(maillageBoiteCreuse(80, 50, 45, 2, 2)),
      tailleAttendue: [80, 50, 45],
      changement: 'Hauteur 30 → 45 mm',
    },
  ];
}
