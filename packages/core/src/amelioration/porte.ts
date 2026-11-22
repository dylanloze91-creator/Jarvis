/**
 * Boucle d'amélioration — la porte.
 *
 * Reprise du « GateOK » d'OpenJarvis (recherche guidée, Stanford, Apache 2.0) : une modification
 * n'est acceptée que si elle améliore ce qu'elle vise **sans abîmer le reste** au-delà d'une petite
 * marge (1 %). Ici la modification est une règle express (`ExpressRule`), et l'examen est
 * l'historique réel des tours : on rejoue la règle sur toutes les phrases déjà dites.
 *
 * - prise juste : la phrase était allée dans l'équipe de la règle, sans raté ;
 * - prise réparée : la phrase était allée ailleurs **et** ce tour est un raté de tri ou une
 *   correction (la règle l'aurait envoyée au bon endroit, à vérifier) ;
 * - prise volée : la phrase était allée dans une autre équipe sans raté : c'est une régression.
 */
import { expressRuleMatches, matchExpressRules, type ExpressRule } from '../agent/expressRules.js';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { estRate, type TourObserve } from './tours.js';

/** Part maximale des tours des autres équipes qu'une règle a le droit de prendre (1 %). */
export const PORTE_REGRESSION_MAX = 0.01;
/** Précision minimale : parmi les phrases prises, part qui allait déjà dans la bonne équipe. */
export const PORTE_PRECISION_MIN = 0.95;
/** Une règle qui ne prend presque rien ne vaut pas le risque. */
export const PORTE_MIN_PRISES = 5;

/** Ratés qui disent « la demande est mal partie ou la réponse était fausse ». */
const RATES_REPARABLES = new Set(['chemin', 'correction', 'repetition', 'signale']);

export interface VerdictPorte {
  regle: string;
  equipe: string;
  acceptee: boolean;
  prises: number;
  justes: number;
  reparees: number;
  volees: number;
  voleesParEquipe: Record<string, number>;
  /** Tours d'autres équipes, sans raté (la base de la régression). */
  autres: number;
  precision: number;
  regression: number;
  /** Temps de tri par un modèle épargné sur l'historique (millisecondes). */
  gainTriMs: number;
  /** Tours pris qui étaient triés par un modèle (ceux qui iront plus vite). */
  accelerees: number;
  /** Règles déjà en place, d'une autre équipe, qui prennent aussi des phrases de celle-ci. */
  conflits: string[];
  raisons: string[];
  /** Phrases volées (fichier local seulement), 5 au plus. */
  exemplesVoles: string[];
}

function estEquipe(value: string | null): value is OrchestraTeam {
  return value !== null && (ORCHESTRA_TEAMS as readonly string[]).includes(value);
}

/** Rejoue une règle sur l'historique et dit si elle passe la porte. */
export function porteRegle(
  regle: ExpressRule,
  tours: readonly TourObserve[],
  existantes: readonly ExpressRule[] = [],
): VerdictPorte {
  let prises = 0;
  let justes = 0;
  let reparees = 0;
  let volees = 0;
  let autres = 0;
  let gainTriMs = 0;
  let accelerees = 0;
  const voleesParEquipe: Record<string, number> = {};
  const exemplesVoles: string[] = [];
  const conflits = new Set<string>();
  const toutes = new Set<OrchestraTeam>(ORCHESTRA_TEAMS);

  for (const tour of tours) {
    const autreEquipe = tour.equipe !== null && tour.equipe !== regle.team;
    if (autreEquipe && !estRate(tour)) autres += 1;
    if (!expressRuleMatches(regle, tour.texte)) continue;
    prises += 1;
    if (tour.triParModele) {
      accelerees += 1;
      gainTriMs += tour.triMs ?? 0;
    }
    for (const autre of existantes) {
      if (autre.id === regle.id || autre.team === regle.team) continue;
      if (expressRuleMatches(autre, tour.texte)) conflits.add(autre.id);
    }
    if (tour.equipe === regle.team) {
      if (!estRate(tour) || !tour.rates.some((type) => RATES_REPARABLES.has(type))) justes += 1;
      continue;
    }
    if (tour.rates.some((type) => RATES_REPARABLES.has(type))) {
      reparees += 1;
      continue;
    }
    if (tour.equipe === null) {
      // Chat d'avant (orchestre coupé) : on ne sait pas où la demande serait allée.
      continue;
    }
    // Une règle déjà en place qui la prenait pour son équipe garde la main : pas de régression
    // de plus, mais c'est un conflit à régler.
    const deja = matchExpressRules(existantes, tour.texte, toutes);
    if (deja && deja.team !== regle.team) {
      conflits.add(deja.rule);
    }
    volees += 1;
    voleesParEquipe[tour.equipe] = (voleesParEquipe[tour.equipe] ?? 0) + 1;
    if (exemplesVoles.length < 5) exemplesVoles.push(tour.texte);
  }

  const utiles = justes + reparees;
  const precision = prises > 0 ? utiles / prises : 0;
  const regression = autres > 0 ? volees / autres : volees > 0 ? 1 : 0;
  const raisons: string[] = [];
  if (!estEquipe(regle.team)) raisons.push(`équipe inconnue : ${regle.team}`);
  if (prises < PORTE_MIN_PRISES) raisons.push(`elle ne prend que ${prises} phrase(s) de l’historique (il en faut ${PORTE_MIN_PRISES})`);
  if (precision < PORTE_PRECISION_MIN) {
    raisons.push(`précision ${Math.round(precision * 100)} % (il faut ${Math.round(PORTE_PRECISION_MIN * 100)} %)`);
  }
  if (regression > PORTE_REGRESSION_MAX) {
    raisons.push(`elle prendrait ${volees} demande(s) d’autres équipes, soit ${(regression * 100).toFixed(1)} % (1 % au plus)`);
  }
  if (conflits.size > 0) raisons.push(`en conflit avec ${[...conflits].sort().join(', ')}`);

  return {
    regle: regle.id,
    equipe: regle.team,
    acceptee: raisons.length === 0,
    prises,
    justes,
    reparees,
    volees,
    voleesParEquipe,
    autres,
    precision,
    regression,
    gainTriMs,
    accelerees,
    conflits: [...conflits].sort(),
    raisons,
    exemplesVoles,
  };
}
