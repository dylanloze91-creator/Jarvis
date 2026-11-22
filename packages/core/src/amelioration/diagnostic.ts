/**
 * Boucle d'amélioration — diagnostic.
 *
 * Phase « Diagnose » de la recherche guidée d'OpenJarvis (LLM-guided spec search, Stanford,
 * Apache 2.0) : les ratés sont regroupés en familles, chacune avec son taux d'échec, et une piste
 * de correction. Ici les familles se calculent par règles, sans modèle : c'est ensuite Claude
 * Code (sur le PC) ou l'utilisateur qui décide quoi corriger.
 */
import { estRate, type TourObserve } from './tours.js';

/** Sous ce nombre de tours, une famille ou une équipe est dite « trop peu d'exemples ». */
export const MIN_TOURS_FIABLE = 5;

export type Piste = 'regle' | 'bogue-outil' | 'vitesse' | 'modele' | 'tri' | 'materiel' | 'a-voir';

export const PISTE_LIBELLES: Record<Piste, string> = {
  regle: 'Une règle express (sans modèle) réglerait ces demandes',
  'bogue-outil': 'Un outil qui rate : lire le journal d’audit',
  vitesse: 'Trop lent : voir où part le temps',
  modele: 'Le modèle de l’équipe se trompe : exemples pour un entraînement ciblé',
  tri: 'La demande part dans la mauvaise équipe',
  materiel: 'Matériel ou réseau',
  'a-voir': 'À regarder',
};

export interface FamilleDeRates {
  /** Clé stable : type|équipe|chemin|outil. */
  cle: string;
  type: string;
  equipe: string;
  chemin: string;
  outil: string;
  rates: number;
  /** Tours de la même équipe et du même chemin (ratés compris). */
  tours: number;
  /** rates / tours. */
  taux: number;
  piste: Piste;
  /** Jusqu'à 3 phrases, pour le fichier local seulement. */
  exemples: string[];
}

function pisteDe(type: string, chemin: string, categorie: string | null): Piste {
  if (categorie === 'regle') return 'regle';
  if (categorie === 'bogue') return 'bogue-outil';
  if (categorie === 'modele') return 'modele';
  if (categorie === 'materiel') return 'materiel';
  if (type === 'outil_echec') return 'bogue-outil';
  if (type === 'lenteur') return 'vitesse';
  if (type === 'chemin') return 'tri';
  if (type === 'correction' || type === 'repetition' || type === 'signale' || type === 'interruption') {
    return chemin === 'cerveau' || chemin === 'trieur' ? 'tri' : 'modele';
  }
  return 'a-voir';
}

function outilPrincipal(tour: TourObserve): string {
  const rate = tour.outils.find((outil) => !outil.ok);
  return (rate ?? tour.outils[0])?.name ?? '-';
}

/** Regroupe les ratés en familles, de la plus nombreuse à la moins nombreuse. */
export function famillesDeRates(tours: readonly TourObserve[]): FamilleDeRates[] {
  const parEquipeChemin = new Map<string, number>();
  for (const tour of tours) {
    const cle = `${tour.equipe ?? 'chat'}|${tour.chemin ?? '-'}`;
    parEquipeChemin.set(cle, (parEquipeChemin.get(cle) ?? 0) + 1);
  }
  const familles = new Map<string, FamilleDeRates>();
  for (const tour of tours) {
    if (!estRate(tour)) continue;
    const equipe = tour.equipe ?? 'chat';
    const chemin = tour.chemin ?? '-';
    const outil = outilPrincipal(tour);
    for (const type of tour.rates) {
      const cle = `${type}|${equipe}|${chemin}|${outil}`;
      let famille = familles.get(cle);
      if (!famille) {
        famille = {
          cle,
          type,
          equipe,
          chemin,
          outil,
          rates: 0,
          tours: parEquipeChemin.get(`${equipe}|${chemin}`) ?? 0,
          taux: 0,
          piste: pisteDe(type, chemin, tour.categorie),
          exemples: [],
        };
        familles.set(cle, famille);
      }
      famille.rates += 1;
      if (famille.exemples.length < 3 && !famille.exemples.includes(tour.texte)) famille.exemples.push(tour.texte);
    }
  }
  const liste = [...familles.values()];
  for (const famille of liste) famille.taux = famille.tours > 0 ? famille.rates / famille.tours : 0;
  return liste.sort((a, b) => b.rates - a.rates || b.taux - a.taux || a.cle.localeCompare(b.cle));
}

export interface Repartition {
  n: number;
  mediane: number | null;
  p90: number | null;
  total: number;
}

function centile(valeurs: readonly number[], part: number): number | null {
  if (valeurs.length === 0) return null;
  const tries = [...valeurs].sort((a, b) => a - b);
  const index = Math.min(tries.length - 1, Math.max(0, Math.ceil(part * tries.length) - 1));
  return tries[index]!;
}

export function repartition(valeurs: readonly number[]): Repartition {
  return {
    n: valeurs.length,
    mediane: centile(valeurs, 0.5),
    p90: centile(valeurs, 0.9),
    total: valeurs.reduce((somme, valeur) => somme + valeur, 0),
  };
}

export interface OuPartLeTemps {
  /** Tours qui ont un chronomètre par étape. */
  toursMesures: number;
  etapes: Record<'tri' | 'chargement' | 'lecture' | 'ecriture' | 'outils' | 'premierMot' | 'voix', Repartition>;
  /** Temps passé à trier par un modèle, sur tous les tours (ce qu'une règle express épargnerait). */
  triParModeleTotalMs: number;
  /** Part des tours triés par un modèle. */
  partTriParModele: number;
}

/** Où part le temps, d'après le chronomètre par étape du journal du tour. */
export function ouPartLeTemps(tours: readonly TourObserve[]): OuPartLeTemps {
  const valeurs: Record<keyof OuPartLeTemps['etapes'], number[]> = {
    tri: [],
    chargement: [],
    lecture: [],
    ecriture: [],
    outils: [],
    premierMot: [],
    voix: [],
  };
  let mesures = 0;
  let triModele = 0;
  let triModeleMs = 0;
  for (const tour of tours) {
    if (tour.triParModele) {
      triModele += 1;
      triModeleMs += tour.triMs ?? 0;
    }
    const etapes = tour.etapes;
    if (!etapes) continue;
    mesures += 1;
    if (etapes.tri) valeurs.tri.push(etapes.tri.ms);
    if (typeof etapes.chargement === 'number') valeurs.chargement.push(etapes.chargement);
    if (etapes.lecture) valeurs.lecture.push(etapes.lecture.ms);
    if (etapes.ecriture) valeurs.ecriture.push(etapes.ecriture.ms);
    if (etapes.outils?.length) valeurs.outils.push(etapes.outils.reduce((somme, outil) => somme + outil.ms, 0));
    if (typeof etapes.premierMot === 'number') valeurs.premierMot.push(etapes.premierMot);
    if (typeof etapes.voix === 'number') valeurs.voix.push(etapes.voix);
  }
  return {
    toursMesures: mesures,
    etapes: {
      tri: repartition(valeurs.tri),
      chargement: repartition(valeurs.chargement),
      lecture: repartition(valeurs.lecture),
      ecriture: repartition(valeurs.ecriture),
      outils: repartition(valeurs.outils),
      premierMot: repartition(valeurs.premierMot),
      voix: repartition(valeurs.voix),
    },
    triParModeleTotalMs: triModeleMs,
    partTriParModele: tours.length > 0 ? triModele / tours.length : 0,
  };
}

export interface BilanOutil {
  name: string;
  appels: number;
  echecs: number;
  taux: number;
}

/** Outils qui ratent le plus souvent (au moins un échec), du pire au moins pire. */
export function outilsQuiRatent(tours: readonly TourObserve[]): BilanOutil[] {
  const parOutil = new Map<string, BilanOutil>();
  for (const tour of tours) {
    for (const outil of tour.outils) {
      const bilan = parOutil.get(outil.name) ?? { name: outil.name, appels: 0, echecs: 0, taux: 0 };
      bilan.appels += 1;
      if (!outil.ok) bilan.echecs += 1;
      parOutil.set(outil.name, bilan);
    }
  }
  return [...parOutil.values()]
    .filter((bilan) => bilan.echecs > 0)
    .map((bilan) => ({ ...bilan, taux: bilan.echecs / bilan.appels }))
    .sort((a, b) => b.echecs - a.echecs || b.taux - a.taux || a.name.localeCompare(b.name));
}
