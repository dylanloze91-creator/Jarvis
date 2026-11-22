/**
 * Boucle d'amélioration — quel modèle pour quelle équipe.
 *
 * Idée reprise du « routeur appris » d'OpenJarvis (Stanford, Apache 2.0) : pour chaque famille de
 * demandes, le modèle qui réussit le mieux d'après les traces, avec une note composée
 * (0,6 × réussite + 0,4 × vitesse) et un minimum de 5 exemples avant de conclure.
 *
 * Ici la famille est l'équipe du chef d'orchestre. Rien n'est changé tout seul : le module rend
 * des suggestions, l'utilisateur choisit dans Réglages → Chef d'orchestre.
 */
import { MIN_TOURS_FIABLE, repartition } from './diagnostic.js';
import { estRate, type TourObserve } from './tours.js';

export const POIDS_REUSSITE = 0.6;
export const POIDS_VITESSE = 0.4;
/** Écart de note en dessous duquel on ne propose pas de changer. */
export const ECART_SUGGESTION = 0.05;

export interface BilanModele {
  modele: string;
  tours: number;
  reussite: number;
  /** Médiane du premier mot si elle existe, sinon de la durée du tour (millisecondes). */
  medianeMs: number | null;
  note: number;
}

export interface BilanEquipe {
  equipe: string;
  tours: number;
  modeles: BilanModele[];
  /** Le modèle le plus utilisé aujourd'hui. */
  actuel: string | null;
  /** Le meilleur d'après la note, s'il a assez d'exemples. */
  meilleur: string | null;
  suggestion: string | null;
}

function temps(tour: TourObserve): number | null {
  return tour.premierMotMs ?? tour.dureeMs;
}

/** Bilan de chaque équipe et de chaque modèle qui l'a servie. */
export function bilanDesEquipes(tours: readonly TourObserve[]): BilanEquipe[] {
  const parEquipe = new Map<string, TourObserve[]>();
  for (const tour of tours) {
    if (!tour.equipe || !tour.modele) continue;
    const liste = parEquipe.get(tour.equipe) ?? [];
    liste.push(tour);
    parEquipe.set(tour.equipe, liste);
  }
  const bilans: BilanEquipe[] = [];
  for (const [equipe, liste] of parEquipe) {
    const parModele = new Map<string, TourObserve[]>();
    for (const tour of liste) {
      const sous = parModele.get(tour.modele!) ?? [];
      sous.push(tour);
      parModele.set(tour.modele!, sous);
    }
    const bruts = [...parModele.entries()].map(([modele, sous]) => {
      const durees = sous.map(temps).filter((valeur): valeur is number => valeur !== null);
      return {
        modele,
        tours: sous.length,
        reussite: sous.filter((tour) => !estRate(tour)).length / sous.length,
        medianeMs: repartition(durees).mediane,
      };
    });
    const fiables = bruts.filter((bilan) => bilan.tours >= MIN_TOURS_FIABLE);
    const plusRapide = Math.min(
      ...fiables.map((bilan) => bilan.medianeMs).filter((valeur): valeur is number => valeur !== null && valeur > 0),
    );
    const modeles: BilanModele[] = bruts
      .map((bilan) => {
        const vitesse = bilan.medianeMs && Number.isFinite(plusRapide) ? plusRapide / bilan.medianeMs : 0;
        return { ...bilan, note: POIDS_REUSSITE * bilan.reussite + POIDS_VITESSE * Math.min(1, vitesse) };
      })
      .sort((a, b) => b.tours - a.tours || a.modele.localeCompare(b.modele));
    const actuel = modeles[0]?.modele ?? null;
    const classes = modeles.filter((bilan) => bilan.tours >= MIN_TOURS_FIABLE).sort((a, b) => b.note - a.note);
    const meilleur = classes[0]?.modele ?? null;
    let suggestion: string | null = null;
    const noteActuel = modeles.find((bilan) => bilan.modele === actuel);
    const noteMeilleur = classes[0];
    if (
      meilleur &&
      actuel &&
      meilleur !== actuel &&
      noteActuel &&
      noteMeilleur &&
      noteActuel.tours >= MIN_TOURS_FIABLE &&
      noteMeilleur.note - noteActuel.note >= ECART_SUGGESTION
    ) {
      const pct = (valeur: number) => `${Math.round(valeur * 100)} %`;
      const sec = (valeur: number | null) => (valeur === null ? '?' : `${(valeur / 1000).toFixed(1).replace('.', ',')} s`);
      suggestion =
        `L’équipe ${equipe} répond mieux avec ${meilleur} (réussite ${pct(noteMeilleur.reussite)}, ${sec(noteMeilleur.medianeMs)}) ` +
        `qu’avec ${actuel} (réussite ${pct(noteActuel.reussite)}, ${sec(noteActuel.medianeMs)}).`;
    }
    bilans.push({ equipe, tours: liste.length, modeles, actuel, meilleur, suggestion });
  }
  return bilans.sort((a, b) => b.tours - a.tours || a.equipe.localeCompare(b.equipe));
}
