/**
 * Boucle d'amélioration — lecture des fichiers du PC et écriture du rapport.
 * Les sources sont lues, jamais écrites. Les sorties vont dans `<dir>/amelioration/<date>/`,
 * jamais dans le dépôt.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DIR_DEFAUT, refuserSortie } from '../conversations/preparer.js';
import type { ExpressRule } from '../agent/expressRules.js';
import { analyser, lireRegle, rapportMarkdown, type Analyse } from './boucle.js';
import { lireLigneCarnet, rattacherRates, toursDeConversation, type RateLu, type TourObserve } from './tours.js';

export interface OptionsAmelioration {
  conversations?: readonly string[];
  carnet?: string;
  /** Fichiers JSON de règles écrites à la main, à passer à la porte. */
  regles?: readonly string[];
  dir?: string;
  depot?: string;
  /** `false` : rien n'est écrit (essais). */
  ecrire?: boolean;
  now?: Date;
}

export interface ResultatAmelioration {
  analyse: Analyse;
  lecture: {
    conversations: number;
    sautees: number;
    dossiersAbsents: number;
    carnet: { lignes: number; rattaches: number; orphelins: number; absent: boolean };
    reglesRefusees: string[];
  };
  fichiers: { rapport: string; exemples: string; analyse: string } | null;
}

function dateDu(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** Ce qui peut sortir du PC sans risque : des comptes, des noms d'équipe et d'outil, jamais une phrase. */
function analyseSansPhrases(analyse: Analyse): unknown {
  return {
    tours: analyse.tours,
    toursAvecJournal: analyse.toursAvecJournal,
    rates: analyse.rates,
    parEquipe: analyse.parEquipe,
    parChemin: analyse.parChemin,
    familles: analyse.familles.map(({ exemples: _exemples, ...reste }) => reste),
    temps: analyse.temps,
    outils: analyse.outils,
    equipes: analyse.equipes,
    propositions: analyse.propositions.map((proposition) => ({
      equipe: proposition.equipe,
      couvertes: proposition.couvertes,
      outilFrequent: proposition.outilFrequent,
      outilPermis: proposition.outilPermis,
      verdict: { ...proposition.verdict, exemplesVoles: [] },
      nombreDeclencheurs: proposition.regle.declencheurs.length,
    })),
    reglesEssayees: analyse.reglesEssayees.map((essai) => ({
      id: essai.regle.id,
      equipe: essai.regle.team,
      verdict: { ...essai.verdict, exemplesVoles: [] },
      problemes: essai.problemes,
    })),
  };
}

export async function ameliorer(options: OptionsAmelioration = {}): Promise<ResultatAmelioration> {
  const now = options.now ?? new Date();
  const dir = options.dir ?? DIR_DEFAUT;
  const sortie = join(resolve(dir), 'amelioration', dateDu(now));
  const sources = [...(options.conversations ?? [])];
  if (options.carnet) sources.push(options.carnet);
  if (options.ecrire !== false) refuserSortie(sortie, sources, options.depot);

  const tours: TourObserve[] = [];
  let conversations = 0;
  let sautees = 0;
  let dossiersAbsents = 0;
  for (const dossier of options.conversations ?? []) {
    let entries: string[];
    try {
      entries = await readdir(dossier);
    } catch {
      dossiersAbsents += 1;
      continue;
    }
    for (const name of entries.sort()) {
      if (!name.endsWith('.json')) continue;
      try {
        const buf = await readFile(join(dossier, name));
        if (buf.length > 0 && buf.every((octet) => octet === 0)) {
          sautees += 1;
          continue;
        }
        const lus = toursDeConversation(JSON.parse(new TextDecoder('utf-8').decode(buf)) as unknown);
        conversations += 1;
        tours.push(...lus);
      } catch {
        sautees += 1;
      }
    }
  }

  if (conversations === 0) {
    // Essai du 23 novembre : `npm run ameliorer -- --conversations "%APPDATA%\Jarvis Test\…"` coupait
    // le chemin à l'espace, et le script écrivait un rapport vide au lieu de le dire.
    throw new Error(
      `Aucune conversation lue (${dossiersAbsents} dossier(s) introuvable(s), ${sautees} fichier(s) illisible(s)). ` +
        'Vérifie le chemin. S’il contient un espace (« Jarvis Test »), lance le script directement : ' +
        'cd packages/core puis node scripts/ameliorer.mjs --conversations "<dossier>".',
    );
  }

  const rates: RateLu[] = [];
  let carnetLignes = 0;
  let carnetAbsent = false;
  if (options.carnet) {
    try {
      for (const line of (await readFile(options.carnet, 'utf8')).split(/\r?\n/)) {
        if (!line.trim()) continue;
        carnetLignes += 1;
        const rate = lireLigneCarnet(line);
        if (rate) rates.push(rate);
      }
    } catch {
      carnetAbsent = true;
    }
  }
  const rattachement = rattacherRates(tours, rates);

  const aEssayer: ExpressRule[] = [];
  const reglesRefusees: string[] = [];
  for (const fichier of options.regles ?? []) {
    try {
      const brut = JSON.parse(await readFile(fichier, 'utf8')) as unknown;
      for (const item of Array.isArray(brut) ? brut : [brut]) {
        const lu = lireRegle(item);
        if ('regle' in lu) aEssayer.push(lu.regle);
        else reglesRefusees.push(`${fichier} : ${lu.erreur}`);
      }
    } catch (error) {
      reglesRefusees.push(`${fichier} : illisible (${String((error as Error)?.message ?? error)})`);
    }
  }

  const analyse = analyser(tours, { aEssayer });
  const lecture = {
    conversations,
    sautees,
    dossiersAbsents,
    carnet: { lignes: carnetLignes, ...rattachement, absent: carnetAbsent },
    reglesRefusees,
  };
  if (options.ecrire === false) return { analyse, lecture, fichiers: null };

  await mkdir(sortie, { recursive: true });
  const date = dateDu(now);
  const fichiers = {
    rapport: join(sortie, 'rapport.md'),
    exemples: join(sortie, 'exemples.md'),
    analyse: join(sortie, 'analyse.json'),
  };
  await writeFile(fichiers.rapport, rapportMarkdown(analyse, { date }), 'utf8');
  await writeFile(fichiers.exemples, rapportMarkdown(analyse, { date, avecPhrases: true }), 'utf8');
  await writeFile(fichiers.analyse, `${JSON.stringify(analyseSansPhrases(analyse), null, 2)}\n`, 'utf8');
  return { analyse, lecture, fichiers };
}
