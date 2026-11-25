/**
 * Atelier 3D — état d'une version de pièce, sans écran (testable sans navigateur) :
 * lecture et contrôle du STL, et ce qui empêche encore de proposer l'impression.
 */
import { controlerStl, lireStl, type ControleStl, type Maillage, type Vec3 } from '@jarvis/core';

/** Une version de la pièce : chaque « plus haut », « trou plus gros » en crée une nouvelle. */
export interface VersionAtelier {
  numero: number;
  /** « Boîte de 80 × 50 × 30 mm. » (`fichePiece`). */
  fiche: string;
  /** Mesures affichées : « Hauteur » → « 30 mm ». */
  mesures: { nom: string; valeur: string }[];
  /** STL rendu par OpenSCAD ; `null` tant qu'il n'est pas prêt. */
  stl: ArrayBuffer | Uint8Array | null;
  /** Taille annoncée par le gabarit, pour le contrôle. */
  tailleAttendue?: Vec3;
  /** Lus dans le fichier tranché (OrcaSlicer), s'il existe. */
  temps?: string;
  filament?: string;
  /** Ce que la version a changé : « Hauteur 30 → 45 mm ». */
  changement?: string;
  /** Un ensemble (boîtier à écran) : le boîtier éclaté, ses pièces et ses contrôles. */
  eclate?: ArrayBuffer | Uint8Array | null;
  pieces?: { titre: string; nombre: number; sens: string; temps?: string; filament?: string }[];
  controles?: { total: number; ok: number };
}

export interface EtatVersion {
  maillage: Maillage | null;
  controle: ControleStl | null;
  erreur: string | null;
}

/** Lit et contrôle le STL d'une version (pur : testable sans écran). */
export function etatVersion(version: VersionAtelier | undefined): EtatVersion {
  if (!version?.stl) return { maillage: null, controle: null, erreur: null };
  try {
    const maillage = lireStl(version.stl);
    return { maillage, controle: controlerStl(maillage, version.tailleAttendue), erreur: null };
  } catch (error) {
    return { maillage: null, controle: null, erreur: error instanceof Error ? error.message : String(error) };
  }
}

/** Raison pour laquelle on ne propose pas encore l'impression, ou `null` si on peut. */
export function raisonPasImprimable(version: VersionAtelier | undefined, etat: EtatVersion): string | null {
  if (!version) return 'Aucune version.';
  if (!version.stl) return 'La pièce n’est pas encore rendue.';
  if (etat.erreur) return 'Le fichier de la pièce est illisible.';
  if (etat.controle && !etat.controle.ok) return 'La pièce a un problème : regarde le contrôle ci-dessus.';
  return null;
}
