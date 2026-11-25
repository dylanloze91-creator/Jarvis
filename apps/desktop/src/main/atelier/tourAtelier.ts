/**
 * Atelier 3D dans la discussion de Jarvis Test, côté PC : la décision vient du cœur
 * (`deciderAtelier`, règles seules), ce fichier fait le travail.
 *
 * - pièce : OpenSCAD rend `v<N>.stl` (et `v<N>.png`) dans `<atelier>/<pièce>/`, le STL est
 *   contrôlé (fermé, aux cotes du gabarit) ; chaque changement crée une version, l'ancienne reste ;
 * - imprimer : jamais depuis une enceinte ; OrcaSlicer tranche avec les copies des préréglages de
 *   l'utilisateur (lus, jamais modifiés), temps et filament lus dans le fichier produit, puis
 *   **carte de confirmation**, et seulement après, envoi à Moonraker ;
 * - file d'attente (« mets-la dans la file », ou « imprime-la » quand l'imprimante est occupée) :
 *   même préparation, carte « Ajouter à la file d'attente », envoi **sans lancer**, ajout à la file de
 *   Moonraker, puis relecture de la file. Jamais l'impression en cours touchée, jamais le passage
 *   automatique activé (refus si moonraker.conf l'a), file toujours laissée en pause ;
 * - « le plateau est vide, lance la suivante » : seule façon de lancer une pièce de la file, après une
 *   carte, et seulement imprimante libre.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ajouterCoteTrouvee,
  ajouterMesure,
  mesuresContredites,
  SOURCE_LARGE,
  siteDeSource,
  ecrireFichierCotes,
  ecrireFichierMesures,
  fusionnerCotes,
  lireFichierCotes,
  lireFichierMesures,
  lireRecherchesCotes,
  type CotesTrouvees,
  type RecherchesCotes,
  type ResultatEtape,
  controlerStl,
  dernierAtelier,
  deciderAtelier,
  lireStl,
  phraseConfirmationAtelier,
  phraseConfirmationFile,
  phraseConfirmationSuivante,
  phraseTempsFilament,
  normaliserOrdre,
  plier,
  PHONE_CANNOT_START,
  SPEAKER_CANNOT_START,
  type AtelierEtat,
  type AtelierVersionInfo,
  type MesuresComposants,
  type ChatMessage,
  type InfosGcode,
  type PrintStatus,
  type QueueSettings,
  type QueueStatus,
  type VolumeImpression,
  type BoitierEcran,
  type ControleBoitier,
} from '@jarvis/core';

import { ATELIER_SANS_OPENSCAD, fabriquerVersion } from './etapes.js';
import { chercherCotes, type CotesCherchees, type DepsChercherCotes } from './chercherCotes.js';

type EtatPiece = Extract<AtelierEtat, { etape: 'piece' }>;

/** Ce que l'imprimante doit savoir faire pour l'atelier (le client Moonraker du lot B suffit). */
export interface ImprimanteAtelier {
  status(): Promise<PrintStatus>;
  upload(name: string, bytes: Uint8Array, print: boolean): Promise<void>;
  files(): Promise<{ path: string }[]>;
  /** Lance un fichier déjà sur l'imprimante (`/printer/print/start`), jamais par la file. */
  start(filename: string): Promise<PrintStatus>;
  queueSettings(): Promise<QueueSettings>;
  queueStatus(): Promise<QueueStatus>;
  queuePause(): Promise<QueueStatus>;
  queueAdd(filename: string): Promise<QueueStatus>;
  queueRemove(jobId: string): Promise<QueueStatus>;
}

export interface ProgrammesAtelier {
  /** Chemin d'OpenSCAD, ou `null` s'il n'est pas installé. */
  openscad(): string | null;
  /** `delaiMs` : plus long pour une grosse pièce (le socle d'un boîtier). */
  rendreStl(openscad: string, scad: string, stl: string, delaiMs?: number): Promise<{ ok: boolean; message: string }>;
  rendreImage(openscad: string, scad: string, png: string): Promise<{ ok: boolean }>;
  /**
   * Les deux vues lues dans le STL (trois quarts, dessus) : noms des images faites, ou `null`.
   * Absent : l'ancienne image de trois quarts par `rendreImage`.
   */
  rendreVues?(openscad: string, dossier: string, numero: number): Promise<{ troisQuarts: string | null; dessus: string | null }>;
  /** Tranche le STL ; `ok: false` avec une phrase si OrcaSlicer manque ou échoue. */
  trancher(stl: string, sortie: string): Promise<{ ok: boolean; message: string; gcode: string | null; infos: InfosGcode | null }>;
}

export interface AtelierDeps {
  /** Dossier de l'atelier (`C:\dev\jarvis-data\atelier`). */
  racine: string;
  programmes: ProgrammesAtelier;
  /** Limite de la pièce : la surface réglée dans le préréglage OrcaSlicer de l'utilisateur. */
  volume(): Promise<VolumeImpression>;
  /** Imprimante réglée et activée, sinon `null`. */
  imprimante(): ImprimanteAtelier | null;
  /** Jour local `AAAA-MM-JJ`. */
  jour(): string;
  /**
   * Mesures de composants données par l'utilisateur. Absent : `composants-mesures.json` dans le
   * dossier de l'atelier (`C:\dev\jarvis-data\atelier\composants-mesures.json`).
   */
  mesures?: {
    lire(): Promise<MesuresComposants>;
    ecrire(m: MesuresComposants): Promise<void>;
    /** Met de côté des mesures (gardées dans le fichier, plus utilisées), avec la raison. */
    mettreDeCote?(id: string, champs: Record<string, number>, raison: string): Promise<void>;
  };
  /**
   * Réglage `printer.phoneStart` : faux = depuis le téléphone, ni « imprime-la » ni « lance la
   * suivante » ; « mets-la dans la file » reste permis. Absent : oui, comme avant.
   */
  telephonePeutLancer?: () => boolean;
  /**
   * Cotes de composants trouvées ailleurs (recherche, fiches), chacune avec sa source. Absent :
   * `composants-cotes.json` dans le dossier de l'atelier, lu seulement.
   */
  cotes?: {
    lire(): Promise<CotesTrouvees>;
    /** Recherches déjà faites, par composant. Absent : aucune. */
    lireRecherches?(): Promise<RecherchesCotes>;
    /** Garde les cotes trouvées et les recherches. Absent : rien n'est gardé. */
    ecrire?(cotes: CotesTrouvees, recherches: RecherchesCotes): Promise<void>;
  };
  /**
   * Chercher les cotes d'un composant sur Internet (recherche, lecture des pages, modèle local qui
   * propose, Jarvis qui vérifie). Absent : le pied à coulisse, comme avant.
   */
  chercherCotes?: DepsChercherCotes;
  /**
   * Les contrôles du boîtier à écran (64 pour le hub, environ une minute). Absent : ceux du cœur,
   * dans ce processus. Les essais en passent un plus court.
   */
  controlerBoitier?: (b: BoitierEcran, avancement: (part: number, quoi: string) => void) => Promise<ControleBoitier[]>;
  /**
   * Vrai (Jarvis Live) : l'atelier est le seul à parler à l'imprimante ; « imprime-la » sans pièce dans
   * la discussion reçoit sa réponse au lieu de partir à un modèle. Absent (Jarvis Test) : le lot B.
   */
  sansAutreImprimante?: boolean;
}

/** Fichier des mesures de composants, dans le dossier de l'atelier. */
export const FICHIER_MESURES = 'composants-mesures.json';
/** Fichier des cotes trouvées ailleurs, à côté (jamais mêlées aux mesures de l'utilisateur). */
export const FICHIER_COTES = 'composants-cotes.json';

function cotesParFichier(racine: string): NonNullable<AtelierDeps['cotes']> {
  const chemin = join(racine, FICHIER_COTES);
  return {
    lire: async () => (existsSync(chemin) ? lireFichierCotes(await readFile(chemin, 'utf8')) : {}),
    lireRecherches: async () => (existsSync(chemin) ? lireRecherchesCotes(await readFile(chemin, 'utf8')) : {}),
    ecrire: async (cotes, recherches) => {
      await mkdir(racine, { recursive: true });
      const temp = `${chemin}.tmp`;
      await writeFile(temp, ecrireFichierCotes(cotes, recherches), 'utf8');
      await rename(temp, chemin);
    },
  };
}

/** Une phrase sans adresses complètes : le site seulement, une fois (« dl.espressif.com »). */
function sansAdresses(texte: string): string {
  return texte
    .replace(/https?:\/\/[^\s;)]+/g, (u) => siteDeSource(u))
    .replace(/\(([^()]*)\)/g, (_, dedans: string) => `(${[...new Set(dedans.split(' ; '))].join(' ; ')})`);
}

/** Ce que la recherche a donné, en quelques phrases courtes (la suite dit ce qui se passe ensuite). */
export function phraseRecherche(r: ResultatEtape<CotesCherchees>, voix: boolean): string {
  if (!r.ok) return r.raison ?? "Je n'ai rien trouvé.";
  if (voix) return `${r.raison} Le détail est sur le PC.`;
  const morceaux = [r.raison ?? ''];
  // Les plans : ce qu'ils ont donné, une fois par site (deux versions du même plan) — le plus complet.
  const plans = [...new Map([...(r.produit?.plans ?? [])].sort((a, b) => a.resume.length - b.resume.length).map((p) => [siteDeSource(p.url), p])).values()];
  for (const p of plans) morceaux.push(`Plan du fabricant (${siteDeSource(p.url)}) : ${p.resume}.`);
  const sures = r.sources.filter((s) => !s.startsWith('plan du fabricant'));
  if (sures.length) morceaux.push(`Sûres : ${sansAdresses(sures.join(' ; '))}.`);
  if (r.incertitudes.length) morceaux.push(`À vérifier quand tu auras la pièce : ${sansAdresses(r.incertitudes.join(' ; '))}.`);
  return morceaux.join(' ');
}

function mesuresParFichier(racine: string): NonNullable<AtelierDeps['mesures']> {
  const chemin = join(racine, FICHIER_MESURES);
  /** Le fichier tel quel (pour garder ce qui a été mis de côté). */
  const brut = async (): Promise<Record<string, unknown>> => {
    try {
      return existsSync(chemin) ? (JSON.parse(await readFile(chemin, 'utf8')) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const ecrireTout = async (m: MesuresComposants, deCote: unknown) => {
    await mkdir(racine, { recursive: true });
    const texte = ecrireFichierMesures(m);
    const avecDeCote = deCote && typeof deCote === 'object' && Object.keys(deCote).length ? `${JSON.stringify({ ...JSON.parse(texte), mises_de_cote: deCote }, null, 2)}\n` : texte;
    const temp = `${chemin}.tmp`;
    await writeFile(temp, avecDeCote, 'utf8');
    await rename(temp, chemin);
  };
  return {
    lire: async () => (existsSync(chemin) ? lireFichierMesures(await readFile(chemin, 'utf8')) : {}),
    ecrire: async (m) => ecrireTout(m, (await brut()).mises_de_cote),
    mettreDeCote: async (id, champs, raison) => {
      const avant = await brut();
      const actives = lireFichierMesures(JSON.stringify(avant));
      const reste = Object.fromEntries(Object.entries(actives[id] ?? {}).filter(([k]) => !(k in champs)));
      const m: MesuresComposants = { ...actives, [id]: reste };
      if (!Object.keys(reste).length) delete m[id];
      const deCote = { ...((avant.mises_de_cote as Record<string, unknown> | undefined) ?? {}) } as Record<string, { champs: Record<string, number>; raison: string }[]>;
      deCote[id] = [...(Array.isArray(deCote[id]) ? deCote[id] : []), { champs, raison }];
      await ecrireTout(m, deCote);
    },
  };
}

export interface AtelierEntree {
  text: string;
  messages: readonly ChatMessage[];
  place: 'fenetre' | 'telephone' | 'enceinte';
  confirm: (summary: string) => Promise<boolean>;
  /** « OpenSCAD dessine la pièce… », pour la discussion. */
  progress?: (message: string) => void;
}

export interface AtelierSortie {
  texte: string;
  /** État à poser sur la réponse : question en cours, ou pièce à afficher en 3D. */
  etat?: AtelierEtat;
}

export { ATELIER_SANS_OPENSCAD };
export const ATELIER_IMPRIMANTE_ABSENTE =
  "Le fichier est prêt, mais l'imprimante n'est pas réglée dans Jarvis (Réglages → Services → Imprimante) : je n'envoie rien.";
export const ATELIER_IMPRIMANTE_MUETTE = "L'imprimante ne répond pas : je n'envoie rien.";
export const ATELIER_FILE_ABSENTE =
  "La file d'attente n'est pas activée dans Moonraker (section [job_queue] de moonraker.conf) : je n'envoie rien.";
export const ATELIER_FILE_AUTO =
  "La file d'attente de Moonraker est réglée pour lancer une pièce toute seule (automatic_transition ou load_on_startup dans moonraker.conf) : je n'y ajoute rien. Mets ces deux réglages à False, puis redemande-le-moi.";
const OCCUPEE = new Set(['printing', 'paused']);

/** Nom libre sur l'imprimante : jamais le fichier en cours, jamais un fichier déjà là. */
function nomLibre(base: string, pris: Set<string>): string {
  if (!pris.has(`${base}.gcode`)) return `${base}.gcode`;
  for (let n = 2; ; n += 1) if (!pris.has(`${base}-${n}.gcode`)) return `${base}-${n}.gcode`;
}

function position(file: QueueStatus, nom: string): string {
  const i = file.jobs.findIndex((j) => j.filename === nom);
  return file.jobs.length > 1 ? ` (place ${i + 1} sur ${file.jobs.length})` : '';
}

/** Nom de fichier simple : ni chemin, ni `..`. */
export function nomSimple(nom: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(nom) && !nom.includes('..');
}


function detailCarte(infos: InfosGcode | null): string | null {
  if (!infos) return null;
  const morceaux = [phraseTempsFilament(infos)];
  const reglages = [
    infos.plateau ? `Plaque : ${infos.plateau}` : null,
    infos.lit !== null ? `lit ${infos.lit} °C` : null,
    infos.buse !== null ? `buse ${infos.buse} °C` : null,
    infos.filament ? `filament ${infos.filament}` : null,
  ].filter(Boolean);
  if (reglages.length) morceaux.push(`${reglages.join(', ')}.`);
  return morceaux.filter(Boolean).join(' ') || null;
}

function avecVersion(etat: EtatPiece, version: AtelierVersionInfo, choisie = version.numero): EtatPiece {
  return {
    ...etat,
    versions: [...etat.versions.filter((v) => v.numero !== version.numero), version].sort((a, b) => a.numero - b.numero),
    versionChoisie: choisie,
  };
}

/** Lancement refusé depuis le téléphone quand le réglage le coupe. */
function telephoneBloque(input: AtelierEntree, deps: AtelierDeps): boolean {
  return input.place === 'telephone' && deps.telephonePeutLancer?.() === false;
}

/** Un tour d'atelier. `null` : la phrase n'est pas pour l'atelier, le tour suit son chemin. */
export async function tourAtelier(input: AtelierEntree, deps: AtelierDeps): Promise<AtelierSortie | null> {
  const precedent = dernierAtelier(input.messages);
  const fichierMesures = deps.mesures ?? mesuresParFichier(deps.racine);
  let mesures = await fichierMesures.lire();
  // Cotes trouvées sur Internet : elles comblent ce que l'utilisateur n'a pas mesuré (sûres, ou d'une
  // seule source et dites « à vérifier »).
  const fichierCotes = deps.cotes ?? cotesParFichier(deps.racine);
  const cotes: CotesTrouvees = await fichierCotes.lire().catch(() => ({}));
  const recherches: RecherchesCotes = await (fichierCotes.lireRecherches?.() ?? Promise.resolve({})).catch(() => ({}));
  const contexte = () => ({
    mesures: fusionnerCotes(mesures, cotes, { uneSource: true }),
    rechercheCotes: Boolean(deps.chercherCotes),
    ...(deps.sansAutreImprimante ? { sansAutreImprimante: true } : {}),
    cherches: Object.keys(recherches),
    produits: Object.fromEntries(Object.entries(recherches).map(([id, r]) => [id, { produit: r.produit, ...(r.plans ? { plans: true } : {}) }])),
  });
  let decision = deciderAtelier(input.text, precedent, contexte());
  // Une mesure de composant donnée : gardée tout de suite (elle sert ensuite partout), puis la
  // phrase d'avant est relue (question suivante, ou la pièce).
  let phraseLarges = '';
  for (let i = 0; decision.kind === 'mesure' && i < 3; i += 1) {
    if (decision.large) {
      // « prends large » : gardée avec les cotes trouvées, comme une valeur d'une seule source, jamais
      // comme une mesure de l'utilisateur (la fiche dira « à vérifier quand tu auras la pièce »).
      const larges = decision.larges ?? [{ composant: decision.composant, champ: decision.champ, valeur: decision.valeur }];
      for (const l of larges) {
        const ajout = ajouterCoteTrouvee(cotes, l.composant, l.champ, { valeur: l.valeur, source: SOURCE_LARGE, choisie: true });
        if (ajout.erreur) return precedent ? { texte: ajout.erreur, etat: precedent } : { texte: ajout.erreur };
        Object.assign(cotes, ajout.cotes);
      }
      try {
        await fichierCotes.ecrire?.(cotes, recherches);
      } catch {
        /* gardée pour ce tour seulement */
      }
      phraseLarges =
        larges.length > 1
          ? `D'accord, je prends large pour les ${larges.length} cotes qui manquaient, sans savoir si c'est juste : tout sera marqué « à vérifier quand tu auras la pièce ». `
          : decision.valeur < 0
            ? "D'accord, j'ouvre la fenêtre au plus large. "
            : `D'accord, je prends ${String(decision.valeur).replace('.', ',')} mm, sans savoir si c'est juste. `;
    } else {
      const ajout = ajouterMesure(mesures, decision.composant, decision.champ, decision.valeur);
      if (ajout.erreur) return precedent ? { texte: ajout.erreur, etat: precedent } : { texte: ajout.erreur };
      mesures = ajout.mesures;
      await fichierMesures.ecrire(mesures);
    }
    decision = deciderAtelier(decision.reprise.texte, decision.reprise.piece, contexte());
  }
  if (phraseLarges && decision.kind === 'dire') decision = { ...decision, texte: `${phraseLarges}${decision.texte}` };
  // Le modèle exact donné : les cotes sont cherchées sur Internet, gardées avec leurs sources, puis la
  // demande d'avant est relue (la pièce, ou ce qui manque encore au pied à coulisse).
  if (decision.kind === 'chercherCotes' && deps.chercherCotes) {
    const d = decision;
    const resumes: string[] = [];
    // Chaque composant à son tour : la recherche, ses plans, puis les cotes gardées avec leurs sources.
    for (const { composant: id, produit } of d.recherches) {
      input.progress?.(`Je cherche les cotes de « ${produit} » sur Internet…`);
      const r = await chercherCotes({ composant: id, produit, cotes }, deps.chercherCotes, (a) => {
        if (a.etape === 'recherche' || a.etape === 'lecture' || a.etape === 'plan') input.progress?.(a.message);
      });
      const apres = r.produit?.cotes ?? cotes;
      recherches[id] = { produit, jour: deps.jour(), manquants: r.produit?.manquants ?? [], ...(deps.chercherCotes.lirePlan ? { plans: true } : {}) };
      Object.assign(cotes, apres);
      try {
        await fichierCotes.ecrire?.(cotes, recherches);
      } catch {
        /* gardées pour ce tour seulement */
      }
      resumes.push(phraseRecherche(r, input.place === 'enceinte'));
      // D'anciennes mesures (sans référence) qui contredisent ce qui est sûr pour cette référence : mises de côté.
      const contre = mesuresContredites(id, mesures, cotes);
      if (contre.length) {
        const champs = Object.fromEntries(contre.map((x) => [x.champ, x.mesure]));
        try {
          await fichierMesures.mettreDeCote?.(id, champs, `contredites par les cotes sûres de « ${produit} » (${deps.jour()})`);
          const reste = Object.fromEntries(Object.entries(mesures[id] ?? {}).filter(([k]) => !(k in champs)));
          mesures = { ...mesures, [id]: reste };
          resumes.push(
            `J'ai mis de côté tes anciennes mesures (${contre.map((x) => `${String(x.mesure).replace('.', ',')} mm`).join(', ')}) : elles ne collent pas avec « ${produit} » (${contre.map((x) => `${String(x.trouvee).replace('.', ',')} mm`).join(', ')}). Elles restent dans le fichier des mesures.`,
          );
        } catch {
          /* le fichier n'a pas pu être écrit : les mesures restent */
        }
      }
    }
    const resume = resumes.join(' ');
    const suite = await tourAtelier(
      { ...input, text: d.reprise.texte, messages: d.reprise.piece ? [{ role: 'assistant', content: '', atelier: d.reprise.piece } as ChatMessage] : [] },
      { ...deps, cotes: { lire: async () => cotes, lireRecherches: async () => recherches } },
    );
    if (!suite) return { texte: resume };
    return { ...suite, texte: `${resume} ${suite.texte}` };
  }
  const voix = input.place === 'enceinte';

  switch (decision.kind) {
    case 'mesure':
      return { texte: 'Mesure gardée.' };
    case 'chercherCotes':
      // Pas de recherche sur ce PC : le pied à coulisse.
      return { texte: "Je ne peux pas chercher sur Internet d'ici. Si tu as la pièce, dis « je la mesure »." };
    case 'rien':
      return null;
    case 'dire':
      return decision.etat ? { texte: decision.texte, etat: decision.etat } : { texte: decision.texte };
    case 'choisir':
      return {
        texte: `Version ${decision.numero} à l'écran.`,
        etat: { ...decision.etat, versionChoisie: decision.numero },
      };
    case 'fabriquer': {
      // L'étape appelable (la même que celle du futur chef de projet) ; ici, elle devient des phrases.
      const r = await fabriquerVersion(
        { gabarit: decision.gabarit, valeurs: decision.valeurs, ...(decision.base ? { base: decision.base } : {}), ...(decision.changement ? { changement: decision.changement } : {}), mesures, cotes },
        deps,
        (a) => {
          if (a.etape === 'dessin' || a.etape === 'images' || (a.etape === 'controle' && decision.gabarit.id === 'boitier_ecran')) input.progress?.(a.message);
        },
      );
      const reste = decision.base ? ` La version ${decision.base.versionChoisie} reste à l'écran.` : '';
      const proposition = r.produit?.proposition;
      if (proposition) {
        // Une carte qui ne tient pas : Jarvis propose des cotes qui marchent (vérifiées), et attend « oui ».
        return {
          texte: `${r.raison} Je l'agrandis à ${proposition.cotes} ? Dis « oui », ou redis-moi la pièce autrement.${reste}`,
          etat: {
            etape: 'proposition',
            gabarit: decision.gabarit.id,
            valeurs: proposition.valeurs,
            base: decision.base ?? null,
            ...(decision.changement ? { changement: decision.changement } : {}),
          },
        };
      }
      const etat = r.produit?.etat;
      const version = r.produit?.version;
      if (!etat || !version) {
        const texte = r.raison === ATELIER_SANS_OPENSCAD || r.produit?.scad ? (r.raison ?? '') : `${r.raison ?? ''}${reste}`;
        // Une nouvelle pièce refusée pour ses cotes (trop grande pour le plateau, hors limites) : la
        // question reste ouverte, « bon alors 250 par 200 par 100 » la refait (sinon la phrase partait
        // à un modèle, qui répondait comme si la boîte existait).
        const premiere = decision.gabarit.suite[0];
        if (!decision.base && premiere && r.raison !== ATELIER_SANS_OPENSCAD && !r.produit?.scad) {
          return { texte: `${texte} Redis-moi les cotes.`, etat: { etape: 'question', gabarit: decision.gabarit.id, valeurs: {}, mesure: premiere } };
        }
        // Un changement refusé sur la pièce à l'écran (« un trou de 50 : il ne tient pas ») : la phrase est
        // gardée, « bon alors de 10 » la redemande avec ce nombre.
        if (decision.base && r.raison !== ATELIER_SANS_OPENSCAD && !r.produit?.scad) {
          return { texte, etat: { ...decision.base, refus: normaliserOrdre(plier(input.text)) } };
        }
        return { texte };
      }
      const probleme = [r.ok ? '' : ` Attention : ${r.raison}`, ...r.avertissements.filter((a) => a.startsWith('Sans support')).map((a) => ` ${a}`)].join('');
      if (voix) {
        // À l'oreille : la première phrase de la fiche seulement (les vis, le ventilateur et les marges
        // restent à l'écran), et le changement quand c'en est un.
        const courte = /^[^.]*\./.exec(version.fiche)?.[0] ?? version.fiche;
        const dit = decision.changement ? `C'est fait, version ${version.numero} : ${decision.changement}. ${courte}` : `C'est prêt : ${courte}`;
        return { texte: `${dit} Regarde l'écran du PC.${probleme}`, etat };
      }
      const quoi = decision.changement ? `Version ${version.numero} (${decision.changement}). ` : '';
      const ensemble = Boolean(version.pieces?.length);
      const suite = !r.ok
        ? ''
        : ensemble
          ? input.place === 'telephone'
            ? ' Les images arrivent ci-dessous ; « Voir en 3D » pour le tourner au doigt. Dis-moi ce qu’il faut changer (« l’écran plus incliné », « les ports sur le côté »), ou « imprime la façade ».'
            : ' Le boîtier est à l’écran : tourne-le à la souris. Dis-moi ce qu’il faut changer (« l’écran plus incliné », « les ports sur le côté »), ou quelle pièce imprimer (« imprime la façade »).'
          : input.place === 'telephone'
          ? ' Les images arrivent ci-dessous ; « Voir en 3D » pour la tourner au doigt. Dis-moi ce qu’il faut changer.'
          : ' La pièce est à l’écran : tourne-la à la souris. Dis-moi ce qu’il faut changer, ou « imprime-la ».';
      return { texte: `${quoi}${version.fiche}${probleme}${suite}`, etat };
    }
    case 'lancerSuivante':
      return lancerSuivante(input, deps);
    case 'file':
    case 'imprimer': {
      if (input.place === 'enceinte') return { texte: SPEAKER_CANNOT_START };
      if (decision.kind === 'imprimer' && telephoneBloque(input, deps)) return { texte: PHONE_CANNOT_START, etat: decision.etat };
      const { etat, numero } = decision;
      const version = etat.versions.find((v) => v.numero === numero)!;
      // Un ensemble (boîtier à écran) : la pièce nommée, avec son propre fichier.
      const piece = decision.piece ? version.pieces?.find((p) => p.nom === decision.piece) : undefined;
      if (decision.piece && !piece) return { texte: `Je ne trouve pas cette pièce dans la version ${numero}.`, etat };
      const fichierStl = piece ? piece.stl : version.stl;
      if (!fichierStl) return { texte: `La version ${numero} n'a pas de fichier de pièce.` };
      const chemin = join(deps.racine, etat.dossier);
      const stl = join(chemin, fichierStl);
      if (!existsSync(stl)) return { texte: `Je ne retrouve plus le fichier de la version ${numero} dans ${chemin}.` };
      const controle = controlerStl(lireStl(new Uint8Array(await readFile(stl))), piece ? piece.taille : version.taille);
      if (!controle.ok) return { texte: `Je n'imprime pas ${piece ? `la pièce « ${piece.titre} »` : `la version ${numero}`} : ${controle.problemes.join(' ')}` };

      input.progress?.('OrcaSlicer prépare le fichier d’impression…');
      const suffixe = piece ? `-${piece.nom}` : '';
      const tranche = await deps.programmes.trancher(stl, join(chemin, `v${numero}${suffixe}-tranche`));
      if (!tranche.ok || !tranche.gcode) return { texte: tranche.message };
      const detail = detailCarte(tranche.infos);
      const lus = {
        ...(tranche.infos?.dureeTexte ? { temps: tranche.infos.dureeTexte } : {}),
        ...(tranche.infos?.filamentG != null ? { filament: `${String(Math.round(tranche.infos.filamentG * 10) / 10).replace('.', ',')} g` } : {}),
      };
      const misAJour = avecVersion(
        etat,
        piece ? { ...version, pieces: version.pieces!.map((p) => (p.nom === piece.nom ? { ...p, ...lus } : p)) } : { ...version, ...lus },
        numero,
      );
      const nomCarte = piece ? `${etat.nom} — ${piece.titre}${piece.nombre > 1 ? ` (1 sur ${piece.nombre})` : ''}` : etat.nom;

      const imprimante = deps.imprimante();
      if (!imprimante) return { texte: `${detail ? `${detail} ` : ''}${ATELIER_IMPRIMANTE_ABSENTE} (${tranche.gcode})`, etat: misAJour };
      let statut: PrintStatus;
      try {
        statut = await imprimante.status();
      } catch {
        return { texte: ATELIER_IMPRIMANTE_MUETTE, etat: misAJour };
      }
      if (decision.kind === 'file' || OCCUPEE.has(statut.state)) {
        const texte = await mettreEnFile(input, imprimante, {
          nom: nomCarte,
          numero,
          base: `${etat.dossier}-v${numero}${suffixe}`,
          gcode: tranche.gcode,
          detail,
          occupee: decision.kind === 'imprimer',
        });
        return { texte, etat: misAJour };
      }
      if (!(await input.confirm(phraseConfirmationAtelier(nomCarte, numero, detail)))) {
        return { texte: "Rien n'a été lancé.", etat: misAJour };
      }
      const nomFichier = `${etat.dossier}-v${numero}${suffixe}.gcode`;
      try {
        await imprimante.upload(nomFichier, new Uint8Array(await readFile(tranche.gcode)), true);
      } catch {
        return { texte: ATELIER_IMPRIMANTE_MUETTE, etat: misAJour };
      }
      // « Lancée » seulement si l'imprimante le dit.
      try {
        const apres = await imprimante.status();
        if (apres.state === 'printing') return { texte: `Impression lancée : ${nomFichier}.`, etat: misAJour };
        return { texte: `Fichier envoyé (${nomFichier}), mais l'imprimante dit « ${apres.state} » : vérifie sur l'imprimante.`, etat: misAJour };
      } catch {
        return { texte: `Fichier envoyé (${nomFichier}), mais l'imprimante ne répond plus : vérifie sur l'imprimante.`, etat: misAJour };
      }
    }
  }
}

/** Ajout à la file d'attente : carte, envoi sans lancer, ajout, relecture. Renvoie la phrase de fin. */
async function mettreEnFile(
  input: AtelierEntree,
  imprimante: ImprimanteAtelier,
  piece: { nom: string; numero: number; base: string; gcode: string; detail: string | null; occupee: boolean },
): Promise<string> {
  let avant: QueueStatus;
  let pris: Set<string>;
  try {
    const reglages = await imprimante.queueSettings();
    if (!reglages.active) return ATELIER_FILE_ABSENTE;
    if (reglages.passageAuto || reglages.chargeAuDemarrage) return ATELIER_FILE_AUTO;
    avant = await imprimante.queueStatus();
    const statut = await imprimante.status();
    pris = new Set([...(await imprimante.files()).map((f) => f.path), statut.filename].filter(Boolean));
  } catch {
    return ATELIER_IMPRIMANTE_MUETTE;
  }
  // « loading » ou « starting » : Moonraker est en train de lancer une pièce de la file ; on n'y touche pas.
  if (avant.state !== 'paused' && avant.state !== 'ready') {
    return `La file d'attente est en train de lancer une pièce (« ${avant.state} ») : je n'y touche pas. Redemande-le-moi dans un instant.`;
  }
  if (!(await input.confirm(phraseConfirmationFile(piece.nom, piece.numero, piece.detail, piece.occupee)))) {
    return "Rien n'a été ajouté à la file.";
  }

  const nomFichier = nomLibre(piece.base, pris);
  let pauseFaite = false;
  try {
    // Une file « ready » pourrait lancer une pièce seule ; la pause ne touche pas l'impression en cours.
    if (avant.state !== 'paused') {
      await imprimante.queuePause();
      pauseFaite = true;
    }
    await imprimante.upload(nomFichier, new Uint8Array(await readFile(piece.gcode)), false);
  } catch {
    return ATELIER_IMPRIMANTE_MUETTE;
  }
  try {
    await imprimante.queueAdd(nomFichier);
  } catch {
    return `Le fichier ${nomFichier} est sur l'imprimante, mais Moonraker a refusé de l'ajouter à la file : rien n'est lancé.`;
  }

  let apres: QueueStatus;
  try {
    apres = await imprimante.queueStatus();
  } catch {
    return `Fichier ${nomFichier} envoyé et ajouté, mais je n'ai pas pu relire la file : vérifie dans Mainsail.`;
  }
  const compte = (file: QueueStatus) => file.jobs.filter((j) => j.filename === nomFichier).length;
  if (compte(apres) <= compte(avant)) {
    return `Fichier ${nomFichier} envoyé, mais je ne le vois pas dans la file : vérifie dans Mainsail. Rien n'est lancé.`;
  }
  if (apres.state !== 'paused') {
    try {
      apres = await imprimante.queuePause();
    } catch {
      /* dit ci-dessous */
    }
    if (apres.state !== 'paused') {
      return `« ${piece.nom} », version ${piece.numero}, est dans la file, mais la file n'est pas en pause (« ${apres.state} ») : mets-la en pause dans Mainsail.`;
    }
    pauseFaite = true;
  }
  const pause = pauseFaite ? " J'ai mis la file en pause pour qu'aucune pièce ne parte seule." : '';
  return `« ${piece.nom} », version ${piece.numero}, est dans la file d'attente${position(apres, nomFichier)} : ${nomFichier}. Rien n'est lancé, la file reste en pause.${pause} Quand le plateau sera vide, dis-moi « le plateau est vide, lance la suivante ».`;
}

/** « le plateau est vide, lance la suivante » : la première pièce de la file, après une carte. */
async function lancerSuivante(input: AtelierEntree, deps: AtelierDeps): Promise<AtelierSortie> {
  if (input.place === 'enceinte') return { texte: SPEAKER_CANNOT_START };
  if (telephoneBloque(input, deps)) return { texte: PHONE_CANNOT_START };
  const imprimante = deps.imprimante();
  if (!imprimante) return { texte: "L'imprimante n'est pas réglée dans Jarvis (Réglages → Services → Imprimante) : je ne lance rien." };
  let file: QueueStatus;
  try {
    const statut = await imprimante.status();
    if (OCCUPEE.has(statut.state)) {
      return { texte: 'Une impression est encore en cours : je ne lance rien. Redis-le-moi quand elle sera finie et le plateau vide.' };
    }
    if (!(await imprimante.queueSettings()).active) return { texte: ATELIER_FILE_ABSENTE };
    file = await imprimante.queueStatus();
  } catch {
    return { texte: "L'imprimante ne répond pas : je ne lance rien." };
  }
  const premier = file.jobs[0];
  if (!premier) return { texte: "La file d'attente est vide : il n'y a rien à lancer." };
  if (file.state !== 'paused' && file.state !== 'ready') {
    return { texte: `La file d'attente est déjà en train de lancer une pièce (« ${file.state} ») : je n'y touche pas.` };
  }
  if (!(await input.confirm(phraseConfirmationSuivante(premier.filename)))) return { texte: "Rien n'a été lancé." };

  let statut: PrintStatus;
  try {
    // Lancée directement, sans `job_queue/start` : la file reste en pause, la suivante ne partira pas seule.
    statut = await imprimante.start(premier.filename);
  } catch {
    return { texte: "L'imprimante n'a pas accepté le lancement : rien n'est parti, la pièce reste dans la file." };
  }
  let retiree: boolean;
  try {
    retiree = !(await imprimante.queueRemove(premier.jobId)).jobs.some((j) => j.jobId === premier.jobId);
  } catch {
    retiree = false;
  }
  const encore = retiree ? '' : " Attention : elle est encore dans la file, retire-la dans Mainsail pour ne pas l'imprimer deux fois.";
  const reste = file.jobs.length - 1;
  const suite = reste > 0 ? ` Il reste ${reste} pièce${reste > 1 ? 's' : ''} dans la file, en pause.` : '';
  if (statut.state === 'printing') return { texte: `Impression lancée : ${premier.filename}.${suite}${encore}` };
  return { texte: `Demande envoyée pour ${premier.filename}, mais l'imprimante dit « ${statut.state} » : vérifie sur l'imprimante.${encore}` };
}
