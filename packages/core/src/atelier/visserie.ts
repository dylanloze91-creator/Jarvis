/**
 * Atelier 3D : la visserie (inserts laiton, vis, avant-trous) et la règle de prise des vis.
 *
 * Valeurs reprises de `donnees/composants.json` de la mission des boîtiers (section `visserie`,
 * état « sûr » : les mêmes inserts que le rover V3.7 de l'utilisateur). Aucune valeur de mémoire.
 * Pur : aucune dépendance.
 */

export const INSERT_M3 = {
  /** Perçage du logement de l'insert (mm). */
  percage: 4.0,
  /** Profondeur du logement (mm). */
  profondeur: 6.0,
  /** Diamètre de bossage conseillé (mm). */
  bossageMini: 8.0,
} as const;

/** Matière au moins autour d'un insert (mm), demandée par la mission. */
export const PAROI_INSERT_MIN = 1.5;

export const VIS_M3_PASSAGE = 3.4;
export const VIS_M3_LAMAGE = { diametre: 6.5, profondeur: 3.0 } as const;
export const VIS_M3_FRAISEE = { diametreTete: 6.4, angle: 90 } as const;

/** Avant-trous des vis autotaraudeuses (mm). */
export const AVANT_TROU = { M2: 1.6, 'M2.5': 2.1 } as const;
export type VisCarte = keyof typeof AVANT_TROU;

/** Longueurs de vis M3 courantes (mm). */
export const LONGUEURS_M3 = [6, 8, 10, 12, 16, 20] as const;

/** Règle de prise : une vis M3 entre de 3,5 mm au moins dans l'insert, et pas plus que sa profondeur − 0,3. */
export const PRISE_MIN = 3.5;
export const PRISE_MAX = INSERT_M3.profondeur - 0.3;

export interface VisChoisie {
  longueur: number;
  /** Longueur vissée dans l'insert (mm). */
  prise: number;
}

/**
 * La vis M3 la plus longue de la liste courante qui respecte la règle de prise, quand elle
 * traverse `traversee` mm de matière avant l'insert (tête fraisée : la tête est comptée dans la
 * longueur et noyée dans la matière ; tête cylindrique : la tête est au-dessus). `null` : aucune.
 */
export function choisirVisM3(traversee: number): VisChoisie | null {
  let choix: VisChoisie | null = null;
  for (const longueur of LONGUEURS_M3) {
    const prise = longueur - traversee;
    if (prise >= PRISE_MIN - 1e-9 && prise <= PRISE_MAX + 1e-9) choix = { longueur, prise };
  }
  return choix;
}
