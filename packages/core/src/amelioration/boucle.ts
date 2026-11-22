/**
 * Boucle d'amélioration — l'analyse complète et son rapport.
 *
 * Reprend la boucle « diagnostiquer → proposer → passer la porte → noter » de la recherche guidée
 * d'OpenJarvis (Stanford, Apache 2.0), sans modèle et sans réseau. Le « professeur » qui lit le
 * rapport et écrit les corrections, c'est Claude Code sur le PC (ou l'utilisateur) : les phrases
 * de l'utilisateur ne quittent jamais le PC.
 */
import { checkExpressRule, EXPRESS_RULES, type ExpressRule } from '../agent/expressRules.js';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { decouvrirRegles, type PropositionRegle } from './decouverte.js';
import {
  famillesDeRates,
  outilsQuiRatent,
  ouPartLeTemps,
  PISTE_LIBELLES,
  type BilanOutil,
  type FamilleDeRates,
  type OuPartLeTemps,
} from './diagnostic.js';
import { bilanDesEquipes, type BilanEquipe } from './equipes.js';
import { porteRegle, type VerdictPorte } from './porte.js';
import { estRate, type TourObserve } from './tours.js';

export interface Analyse {
  tours: number;
  toursAvecJournal: number;
  rates: number;
  parEquipe: Record<string, number>;
  parChemin: Record<string, number>;
  familles: FamilleDeRates[];
  temps: OuPartLeTemps;
  outils: BilanOutil[];
  equipes: BilanEquipe[];
  propositions: PropositionRegle[];
  /** Règles écrites à la main et passées à la porte (`--regle`). */
  reglesEssayees: { regle: ExpressRule; verdict: VerdictPorte; problemes: string[] }[];
}

function compter(map: Record<string, number>, cle: string): void {
  map[cle] = (map[cle] ?? 0) + 1;
}

/** Tout le diagnostic, sans rien lire ni écrire. */
export function analyser(
  tours: readonly TourObserve[],
  options: { existantes?: readonly ExpressRule[]; aEssayer?: readonly ExpressRule[] } = {},
): Analyse {
  const existantes = options.existantes ?? EXPRESS_RULES;
  const parEquipe: Record<string, number> = {};
  const parChemin: Record<string, number> = {};
  for (const tour of tours) {
    compter(parEquipe, tour.equipe ?? 'chat');
    compter(parChemin, tour.chemin ?? 'inconnu');
  }
  return {
    tours: tours.length,
    toursAvecJournal: tours.filter((tour) => tour.journal).length,
    rates: tours.filter(estRate).length,
    parEquipe,
    parChemin,
    familles: famillesDeRates(tours),
    temps: ouPartLeTemps(tours),
    outils: outilsQuiRatent(tours),
    equipes: bilanDesEquipes(tours),
    propositions: decouvrirRegles(tours, existantes),
    reglesEssayees: (options.aEssayer ?? []).map((regle) => ({
      regle,
      verdict: porteRegle(regle, tours, existantes),
      problemes: checkExpressRule(regle),
    })),
  };
}

/** Lit une règle écrite à la main (JSON). Rend la règle ou la raison du refus. */
export function lireRegle(raw: unknown): { regle: ExpressRule } | { erreur: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { erreur: 'la règle doit être un objet JSON' };
  const row = raw as Record<string, unknown>;
  const liste = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const team = typeof row.team === 'string' ? row.team : '';
  const declencheurs = liste(row.declencheurs);
  if (!id) return { erreur: 'il manque « id »' };
  if (!(ORCHESTRA_TEAMS as readonly string[]).includes(team)) return { erreur: `équipe inconnue : « ${team} »` };
  if (!declencheurs?.length) return { erreur: 'il manque « declencheurs »' };
  return {
    regle: {
      id,
      team: team as OrchestraTeam,
      declencheurs,
      empechements: liste(row.empechements) ?? [],
      pour: liste(row.pour) ?? [],
      contre: liste(row.contre) ?? [],
      ...(typeof row.outil === 'string' && row.outil ? { outil: row.outil } : {}),
      ...(typeof row.annonce === 'string' && row.annonce ? { annonce: row.annonce } : {}),
    },
  };
}

const pct = (valeur: number) => `${Math.round(valeur * 100)} %`;
const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

function regleEnCode(regle: ExpressRule): string {
  const liste = (valeurs: readonly string[]) => (valeurs.length ? `[\n${valeurs.map((v) => `      ${JSON.stringify(v)},`).join('\n')}\n    ]` : '[]');
  return [
    '  {',
    `    id: ${JSON.stringify(regle.id)},`,
    `    team: ${JSON.stringify(regle.team)},`,
    ...(regle.outil ? [`    outil: ${JSON.stringify(regle.outil)},`] : []),
    `    declencheurs: ${liste(regle.declencheurs)},`,
    `    empechements: ${liste(regle.empechements)},`,
    '    // À écrire à la main : 3 phrases au moins de chaque côté, jamais recopiées des conversations.',
    '    pour: [],',
    '    contre: [],',
    '  },',
  ].join('\n');
}

/**
 * Rapport en français simple. `avecPhrases` : ajoute les exemples tirés des conversations
 * (pour le fichier local `exemples.md` seulement).
 */
export function rapportMarkdown(analyse: Analyse, options: { date: string; avecPhrases?: boolean } = { date: '' }): string {
  const lignes: string[] = [];
  const titre = options.avecPhrases ? 'Exemples (fichier local, ne jamais copier dans le dépôt)' : 'Boucle d’amélioration';
  lignes.push(`# ${titre} — ${options.date}`, '');
  lignes.push(
    options.avecPhrases
      ? 'Ce fichier contient tes phrases : il reste sur le PC.'
      : 'Ce rapport contient des groupes de mots tirés de tes demandes (règles proposées) : il reste sur le PC. Seul `analyse.json` (des comptes) peut être envoyé.',
    '',
  );
  lignes.push(
    `${analyse.tours} demandes lues, ${analyse.toursAvecJournal} avec le journal du tour (Jarvis Test), ${analyse.rates} avec un raté noté par le carnet.`,
    '',
  );

  lignes.push('## 1. Où partent les demandes', '');
  lignes.push('| Équipe | Demandes |', '| --- | ---: |');
  for (const [equipe, n] of Object.entries(analyse.parEquipe).sort((a, b) => b[1] - a[1])) lignes.push(`| ${equipe} | ${n} |`);
  lignes.push('', '| Chemin | Demandes |', '| --- | ---: |');
  for (const [chemin, n] of Object.entries(analyse.parChemin).sort((a, b) => b[1] - a[1])) lignes.push(`| ${chemin} | ${n} |`);
  lignes.push('');

  lignes.push('## 2. Où part le temps', '');
  const temps = analyse.temps;
  lignes.push(
    `${temps.toursMesures} demandes chronométrées. ${pct(temps.partTriParModele)} des demandes ont attendu un modèle pour choisir l’équipe, ` +
      `soit ${sec(temps.triParModeleTotalMs)} en tout : c’est ce que les règles express peuvent faire gagner.`,
    '',
    '| Étape | Mesures | Médiane | 9 fois sur 10 sous |',
    '| --- | ---: | ---: | ---: |',
  );
  const noms: Record<string, string> = {
    tri: 'Choix de l’équipe',
    chargement: 'Chargement du modèle',
    lecture: 'Lecture de la demande',
    ecriture: 'Écriture de la réponse',
    outils: 'Outils',
    premierMot: 'Premier mot affiché',
    voix: 'Premier son',
  };
  for (const [cle, valeur] of Object.entries(temps.etapes)) {
    lignes.push(`| ${noms[cle] ?? cle} | ${valeur.n} | ${sec(valeur.mediane)} | ${sec(valeur.p90)} |`);
  }
  lignes.push('');

  lignes.push('## 3. Familles de ratés', '');
  if (analyse.familles.length === 0) lignes.push('Aucun raté rattaché à une demande.', '');
  else {
    lignes.push('| Raté | Équipe | Chemin | Outil | Ratés | Part | Piste |', '| --- | --- | --- | --- | ---: | ---: | --- |');
    for (const famille of analyse.familles.slice(0, 20)) {
      lignes.push(
        `| ${famille.type} | ${famille.equipe} | ${famille.chemin} | ${famille.outil} | ${famille.rates} | ${pct(famille.taux)} | ${PISTE_LIBELLES[famille.piste]} |`,
      );
    }
    lignes.push('');
    if (options.avecPhrases) {
      for (const famille of analyse.familles.slice(0, 20)) {
        lignes.push(`- **${famille.cle}** : ${famille.exemples.map((texte) => `« ${texte} »`).join(' ; ')}`);
      }
      lignes.push('');
    }
  }

  lignes.push('## 4. Outils qui ratent', '');
  if (analyse.outils.length === 0) lignes.push('Aucun outil en échec.', '');
  else {
    lignes.push('| Outil | Appels | Échecs | Part |', '| --- | ---: | ---: | ---: |');
    for (const outil of analyse.outils.slice(0, 15)) lignes.push(`| ${outil.name} | ${outil.appels} | ${outil.echecs} | ${pct(outil.taux)} |`);
    lignes.push('');
  }

  lignes.push('## 5. Quel modèle pour quelle équipe', '');
  const suggestions = analyse.equipes.filter((bilan) => bilan.suggestion);
  if (suggestions.length === 0) lignes.push('Pas de changement à proposer (ou pas encore assez d’exemples : 5 par modèle).', '');
  else {
    for (const bilan of suggestions) lignes.push(`- ${bilan.suggestion}`);
    lignes.push('', 'Suggestion seulement : rien n’est changé tout seul (Réglages → Chef d’orchestre).', '');
  }

  lignes.push('## 6. Règles express proposées', '');
  if (analyse.propositions.length === 0) lignes.push('Aucune proposition : pas assez de demandes répétées triées par un modèle.', '');
  for (const proposition of analyse.propositions) {
    const verdict = proposition.verdict;
    lignes.push(
      `### ${proposition.equipe} — ${verdict.acceptee ? 'passe la porte' : 'ne passe pas la porte'}`,
      '',
      `- Demandes couvertes qui attendaient un modèle : ${proposition.couvertes} ; temps de tri épargné sur l’historique : ${sec(verdict.gainTriMs)}.`,
      `- Prises : ${verdict.prises} (justes ${verdict.justes}, réparées ${verdict.reparees}, volées à d’autres équipes ${verdict.volees}) ; précision ${pct(verdict.precision)} ; régression ${(verdict.regression * 100).toFixed(1)} %.`,
      ...(proposition.outilFrequent
        ? [
            `- Outil presque toujours appelé : ${proposition.outilFrequent}${proposition.outilPermis ? ' (permis sans modèle : mis dans la règle)' : ' (pas dans la liste des outils de lecture sans argument)'}.`,
          ]
        : []),
      ...(verdict.raisons.length ? [`- Pourquoi elle ne passe pas : ${verdict.raisons.join(' ; ')}.`] : []),
      '',
      '```ts',
      regleEnCode(proposition.regle),
      '```',
      '',
    );
    if (options.avecPhrases) {
      lignes.push(`Demandes couvertes : ${proposition.exemples.map((texte) => `« ${texte} »`).join(' ; ')}`, '');
      if (verdict.exemplesVoles.length) lignes.push(`Demandes volées : ${verdict.exemplesVoles.map((texte) => `« ${texte} »`).join(' ; ')}`, '');
    }
  }

  if (analyse.reglesEssayees.length) {
    lignes.push('## 7. Règles écrites à la main, passées à la porte', '');
    for (const essai of analyse.reglesEssayees) {
      const verdict = essai.verdict;
      lignes.push(
        `- **${essai.regle.id}** (${essai.regle.team}) : ${verdict.acceptee ? 'passe la porte' : 'ne passe pas'} — prises ${verdict.prises}, précision ${pct(verdict.precision)}, régression ${(verdict.regression * 100).toFixed(1)} %, tri épargné ${sec(verdict.gainTriMs)}.` +
          (verdict.raisons.length ? ` Raisons : ${verdict.raisons.join(' ; ')}.` : '') +
          (essai.problemes.length ? ` À compléter avant d’entrer dans Jarvis : ${essai.problemes.join(' ; ')}.` : ''),
      );
    }
    lignes.push('');
  }

  lignes.push(
    '## Comment s’en servir',
    '',
    '1. Une règle qui passe la porte : Claude Code l’écrit dans `EXPRESS_RULES` (`packages/core/src/agent/expressRules.ts`) avec ses propres phrases d’essai, puis relance cette analyse avec `--regle` pour confirmer.',
    '2. Une famille « le modèle se trompe » : ses phrases vont dans le jeu d’entraînement de l’équipe (`conversations:preparer`), jamais corrigées par Claude.',
    '3. Une famille « outil qui rate » : lire le journal d’audit du PC.',
    '',
  );
  return lignes.join('\n');
}
