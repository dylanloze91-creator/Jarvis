/**
 * Boucle d'amélioration — découverte de règles express.
 *
 * Idée reprise d'OpenJarvis (Stanford, Apache 2.0) : « skill discovery » cherche dans les traces
 * ce qui revient souvent et marche bien, et le propose comme compétence. Ici, on cherche les
 * groupes de mots qui reviennent dans les demandes qu'une même équipe a bien traitées **après un
 * tri par modèle** (cerveau ou trieur, la partie lente) : une règle express les enverrait tout de
 * suite au bon endroit, sans modèle.
 *
 * Ce module **propose** seulement. Chaque proposition passe la porte (`porte.ts`) sur tout
 * l'historique, puis quelqu'un (Claude Code sur le PC, ou l'utilisateur) l'écrit dans
 * `EXPRESS_RULES` avec ses propres phrases d'essai (jamais celles de l'utilisateur).
 */
import { EXPRESS_RULE_TOOLS, type ExpressRule } from '../agent/expressRules.js';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { porteRegle, type VerdictPorte } from './porte.js';
import { estRate, plier, type TourObserve } from './tours.js';

/** Une proposition doit couvrir au moins ce nombre de demandes triées par un modèle. */
export const DECOUVERTE_MIN_SUPPORT = 4;
/** Précision d'un groupe de mots seul, sur tout l'historique. */
export const DECOUVERTE_PRECISION_MIN = 0.97;
export const DECOUVERTE_MAX_DECLENCHEURS = 10;
export const DECOUVERTE_MAX_EMPECHEMENTS = 8;

/** Petits mots qui ne disent rien de l'équipe. Comparés après `plier` (sans accent). */
const MOTS_VIDES = new Set(
  (
    'le la les l un une des de du d et ou a au aux en dans sur pour par avec sans ce cet cette ces ' +
    'mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs je j tu il elle on nous vous ils elles ' +
    'me m te t se s moi toi lui y est es suis sont ai as ont c ca qu que qui quoi quel quelle quels quelles ' +
    'ne n pas plus jarvis stp plait peux peut pourrais pourriez veux voudrais fais fait faire dis dire ' +
    'donne donner bonjour salut merci oui non ok bon alors juste encore aussi tout tous toute toutes tres bien ' +
    'est ce estce svp hey eh euh ben bah la voila maintenant'
  ).split(/\s+/),
);

function mots(texte: string): string[] {
  return plier(texte).split(' ').filter(Boolean);
}

/** Groupes de 1 à 3 mots qui portent du sens (pas que des petits mots, pas que des chiffres). */
export function groupesDeMots(texte: string): Set<string> {
  const liste = mots(texte);
  const groupes = new Set<string>();
  for (let taille = 1; taille <= 3; taille += 1) {
    for (let debut = 0; debut + taille <= liste.length; debut += 1) {
      const morceau = liste.slice(debut, debut + taille);
      if (morceau.every((mot) => MOTS_VIDES.has(mot))) continue;
      if (morceau.every((mot) => /^\d+$/.test(mot))) continue;
      if (MOTS_VIDES.has(morceau[0]!) && MOTS_VIDES.has(morceau[morceau.length - 1]!) && taille > 1) continue;
      if (taille === 1 && morceau[0]!.length < 4) continue;
      groupes.add(morceau.join(' '));
    }
  }
  return groupes;
}

function contient(texte: string, groupe: string): boolean {
  return ` ${plier(texte)} `.includes(` ${groupe} `);
}

export interface PropositionRegle {
  equipe: OrchestraTeam;
  regle: ExpressRule;
  verdict: VerdictPorte;
  /** Outil le plus appelé par l'équipe sur ces demandes, s'il y en a un net. */
  outilFrequent: string | null;
  /** Vrai si cet outil est dans la liste des outils qu'une règle peut appeler sans modèle. */
  outilPermis: boolean;
  /** Demandes triées par un modèle que la règle couvre. */
  couvertes: number;
  /** Jusqu'à 5 phrases couvertes (fichier local seulement). */
  exemples: string[];
}

interface Candidat {
  groupe: string;
  support: Set<number>;
  precision: number;
}

function sansRateDeTri(tour: TourObserve): boolean {
  return !estRate(tour) || !tour.rates.some((type) => type === 'chemin' || type === 'correction' || type === 'repetition');
}

function outilDominant(tours: readonly TourObserve[]): string | null {
  if (tours.length === 0) return null;
  const compte = new Map<string, number>();
  for (const tour of tours) {
    const noms = [...new Set(tour.outils.map((outil) => outil.name))];
    if (noms.length !== 1) continue;
    compte.set(noms[0]!, (compte.get(noms[0]!) ?? 0) + 1);
  }
  let meilleur: string | null = null;
  let meilleurCompte = 0;
  for (const [nom, n] of compte) {
    if (n > meilleurCompte || (n === meilleurCompte && meilleur !== null && nom < meilleur)) {
      meilleur = nom;
      meilleurCompte = n;
    }
  }
  return meilleur && meilleurCompte / tours.length >= 0.9 ? meilleur : null;
}

/** Propose une règle par équipe quand l'historique la justifie. */
export function decouvrirRegles(
  tours: readonly TourObserve[],
  existantes: readonly ExpressRule[] = [],
): PropositionRegle[] {
  const propositions: PropositionRegle[] = [];
  const groupesParTour = tours.map((tour) => groupesDeMots(tour.texte));

  for (const equipe of ORCHESTRA_TEAMS) {
    const indexModele: number[] = [];
    tours.forEach((tour, index) => {
      if (tour.equipe === equipe && tour.triParModele && sansRateDeTri(tour)) indexModele.push(index);
    });
    if (indexModele.length < DECOUVERTE_MIN_SUPPORT) continue;

    // 1. Groupes de mots fréquents dans ces demandes.
    const support = new Map<string, Set<number>>();
    for (const index of indexModele) {
      for (const groupe of groupesParTour[index]!) {
        const ensemble = support.get(groupe) ?? new Set<number>();
        ensemble.add(index);
        support.set(groupe, ensemble);
      }
    }

    // 2. Précision de chaque groupe sur tout l'historique.
    const candidats: Candidat[] = [];
    for (const [groupe, ensemble] of support) {
      if (ensemble.size < DECOUVERTE_MIN_SUPPORT) continue;
      let pour = 0;
      let contre = 0;
      tours.forEach((tour, index) => {
        if (tour.equipe === null || !groupesParTour[index]!.has(groupe)) return;
        if (tour.equipe === equipe && sansRateDeTri(tour)) pour += 1;
        else if (tour.equipe !== equipe && !estRate(tour)) contre += 1;
      });
      const precision = pour + contre > 0 ? pour / (pour + contre) : 0;
      if (precision >= DECOUVERTE_PRECISION_MIN) candidats.push({ groupe, support: ensemble, precision });
    }
    if (candidats.length === 0) continue;

    // 3. Choix glouton : le groupe qui couvre le plus de demandes encore libres ; à égalité,
    //    le plus court (plus général), puis l'ordre alphabétique (résultat stable).
    const couvertes = new Set<number>();
    const choisis: string[] = [];
    const restants = [...candidats];
    while (choisis.length < DECOUVERTE_MAX_DECLENCHEURS && restants.length > 0) {
      restants.sort((a, b) => {
        const gainA = [...a.support].filter((index) => !couvertes.has(index)).length;
        const gainB = [...b.support].filter((index) => !couvertes.has(index)).length;
        return gainB - gainA || a.groupe.split(' ').length - b.groupe.split(' ').length || a.groupe.localeCompare(b.groupe);
      });
      const meilleur = restants.shift()!;
      const gain = [...meilleur.support].filter((index) => !couvertes.has(index)).length;
      if (gain < 2) break;
      if (choisis.some((deja) => ` ${meilleur.groupe} `.includes(` ${deja} `))) continue;
      choisis.push(meilleur.groupe);
      for (const index of meilleur.support) couvertes.add(index);
    }
    if (choisis.length === 0 || couvertes.size < DECOUVERTE_MIN_SUPPORT) continue;

    // 4. Empêchements : les mots des demandes d'autres équipes que ces déclencheurs prendraient,
    //    absents (ou presque) des demandes de l'équipe.
    const faux: number[] = [];
    tours.forEach((tour, index) => {
      if (tour.equipe === null || tour.equipe === equipe || estRate(tour)) return;
      if (choisis.some((groupe) => contient(tour.texte, groupe))) faux.push(index);
    });
    const equipeTextes = tours.filter((tour) => tour.equipe === equipe).map((tour) => ` ${plier(tour.texte)} `);
    const compteFaux = new Map<string, number>();
    for (const index of faux) {
      for (const mot of new Set(mots(tours[index]!.texte))) {
        if (MOTS_VIDES.has(mot) || mot.length < 3 || choisis.some((groupe) => groupe.split(' ').includes(mot))) continue;
        compteFaux.set(mot, (compteFaux.get(mot) ?? 0) + 1);
      }
    }
    const empechements = [...compteFaux.entries()]
      .filter(([mot]) => equipeTextes.filter((texte) => texte.includes(` ${mot} `)).length <= Math.floor(equipeTextes.length * 0.02))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, DECOUVERTE_MAX_EMPECHEMENTS)
      .map(([mot]) => mot);

    const toursCouverts = [...couvertes].sort((a, b) => a - b).map((index) => tours[index]!);
    const outilFrequent = outilDominant(toursCouverts);
    const outilPermis = outilFrequent !== null && EXPRESS_RULE_TOOLS.includes(outilFrequent);
    const regle: ExpressRule = {
      id: `decouverte-${equipe}`,
      team: equipe,
      declencheurs: choisis,
      empechements,
      pour: [],
      contre: [],
      ...(outilPermis && outilFrequent ? { outil: outilFrequent } : {}),
    };
    propositions.push({
      equipe,
      regle,
      verdict: porteRegle(regle, tours, existantes),
      outilFrequent,
      outilPermis,
      couvertes: couvertes.size,
      exemples: toursCouverts.slice(0, 5).map((tour) => tour.texte),
    });
  }

  return propositions.sort(
    (a, b) => Number(b.verdict.acceptee) - Number(a.verdict.acceptee) || b.verdict.gainTriMs - a.verdict.gainTriMs || b.couvertes - a.couvertes,
  );
}
