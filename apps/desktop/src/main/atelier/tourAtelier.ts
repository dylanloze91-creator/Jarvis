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
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  agrandirPourTenir,
  ajouterMesure,
  controlerImpression,
  ecrireFichierMesures,
  lireFichierMesures,
  controlerStl,
  dernierAtelier,
  deciderAtelier,
  fabriquer,
  fichePiece,
  lireStl,
  mesuresAffichees,
  nomDossierPiece,
  phraseConfirmationAtelier,
  phraseConfirmationFile,
  phraseConfirmationSuivante,
  phraseTempsFilament,
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
} from '@jarvis/core';

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
  rendreStl(openscad: string, scad: string, stl: string): Promise<{ ok: boolean; message: string }>;
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
  mesures?: { lire(): Promise<MesuresComposants>; ecrire(m: MesuresComposants): Promise<void> };
  /**
   * Réglage `printer.phoneStart` : faux = depuis le téléphone, ni « imprime-la » ni « lance la
   * suivante » ; « mets-la dans la file » reste permis. Absent : oui, comme avant.
   */
  telephonePeutLancer?: () => boolean;
}

/** Fichier des mesures de composants, dans le dossier de l'atelier. */
export const FICHIER_MESURES = 'composants-mesures.json';

function mesuresParFichier(racine: string): NonNullable<AtelierDeps['mesures']> {
  const chemin = join(racine, FICHIER_MESURES);
  return {
    lire: async () => (existsSync(chemin) ? lireFichierMesures(await readFile(chemin, 'utf8')) : {}),
    ecrire: async (m) => {
      await mkdir(racine, { recursive: true });
      const temp = `${chemin}.tmp`;
      await writeFile(temp, ecrireFichierMesures(m), 'utf8');
      await rename(temp, chemin);
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

export const ATELIER_SANS_OPENSCAD =
  "OpenSCAD n'est pas installé sur ce PC : je ne peux pas dessiner la pièce. Installe-le (winget install --id=OpenSCAD.OpenSCAD -e), puis redemande-la.";
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

async function dossierLibre(racine: string, base: (n: number) => string): Promise<string> {
  const pris = new Set(existsSync(racine) ? await readdir(racine) : []);
  for (let n = 1; ; n += 1) {
    const nom = base(n);
    if (!pris.has(nom)) return nom;
  }
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
  let decision = deciderAtelier(input.text, precedent, { mesures });
  // Une mesure de composant donnée : gardée tout de suite (elle sert ensuite partout), puis la
  // phrase d'avant est relue (question suivante, ou la pièce).
  for (let i = 0; decision.kind === 'mesure' && i < 3; i += 1) {
    const ajout = ajouterMesure(mesures, decision.composant, decision.champ, decision.valeur);
    if (ajout.erreur) return precedent ? { texte: ajout.erreur, etat: precedent } : { texte: ajout.erreur };
    mesures = ajout.mesures;
    await fichierMesures.ecrire(mesures);
    decision = deciderAtelier(decision.reprise.texte, decision.reprise.piece, { mesures });
  }
  const voix = input.place === 'enceinte';

  switch (decision.kind) {
    case 'mesure':
      return { texte: 'Mesure gardée.' };
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
      const volume = await deps.volume();
      const piece = fabriquer(decision.gabarit, decision.valeurs, volume);
      if (!piece.ok) {
        const reste = decision.base ? ` La version ${decision.base.versionChoisie} reste à l'écran.` : '';
        // Une carte qui ne tient pas : Jarvis propose des cotes qui marchent (vérifiées), et attend « oui ».
        const plus = agrandirPourTenir(decision.gabarit, decision.valeurs, piece.erreurs);
        if (plus && fabriquer(decision.gabarit, plus.valeurs, volume).ok) {
          return {
            texte: `${piece.erreurs.join(' ')} Je l'agrandis à ${plus.texte} ? Dis « oui », ou redis-moi la pièce autrement.${reste}`,
            etat: {
              etape: 'proposition',
              gabarit: decision.gabarit.id,
              valeurs: plus.valeurs,
              base: decision.base ?? null,
              ...(decision.changement ? { changement: decision.changement } : {}),
            },
          };
        }
        return { texte: `${piece.erreurs.join(' ')}${reste}` };
      }
      const openscad = deps.programmes.openscad();
      if (!openscad) return { texte: ATELIER_SANS_OPENSCAD };

      const dossier =
        decision.base?.dossier ?? (await dossierLibre(deps.racine, (n) => nomDossierPiece(decision.gabarit, deps.jour(), n)));
      const chemin = join(deps.racine, dossier);
      await mkdir(chemin, { recursive: true });
      const numero = decision.base ? Math.max(...decision.base.versions.map((v) => v.numero)) + 1 : 1;
      const scad = join(chemin, `v${numero}.scad`);
      const stl = join(chemin, `v${numero}.stl`);
      await writeFile(scad, piece.scad, 'utf8');

      input.progress?.('OpenSCAD dessine la pièce…');
      const rendu = await deps.programmes.rendreStl(openscad, scad, stl);
      if (!rendu.ok) return { texte: `${rendu.message} Le fichier .scad est gardé dans ${chemin}.` };
      const maillage = lireStl(new Uint8Array(await readFile(stl)));
      const controle = controlerStl(maillage, piece.taille);
      // Imprimable sans support, posée telle quelle ? (surplombs de plus de 45°, ponts de plus de 25 mm)
      const impression = controlerImpression(maillage, decision.gabarit.nom);
      input.progress?.('OpenSCAD fait les images de la pièce…');
      const vues = deps.programmes.rendreVues
        ? await deps.programmes.rendreVues(openscad, chemin, numero).catch(() => ({ troisQuarts: null, dessus: null }))
        : null;
      const image = vues
        ? (vues.troisQuarts ?? undefined)
        : (await deps.programmes.rendreImage(openscad, scad, join(chemin, `v${numero}.png`))).ok
          ? `v${numero}.png`
          : undefined;
      const imageDessus = vues?.dessus ?? undefined;

      const version: AtelierVersionInfo = {
        numero,
        valeurs: piece.valeurs,
        fiche: fichePiece(piece),
        mesures: mesuresAffichees(decision.gabarit, piece.valeurs),
        taille: piece.taille,
        stl: `v${numero}.stl`,
        ...(image ? { image } : {}),
        ...(imageDessus ? { imageDessus } : {}),
        ...(decision.changement ? { changement: decision.changement } : {}),
      };
      // Le modèle a changé (boîte → boîte à couvercle) : la pièce prend le nouveau, les anciennes
      // versions gardent le leur.
      const base =
        decision.base && decision.base.gabarit !== decision.gabarit.id
          ? {
              ...decision.base,
              gabarit: decision.gabarit.id,
              nom: decision.gabarit.nom,
              versions: decision.base.versions.map((v) => (v.gabarit ? v : { ...v, gabarit: decision.base!.gabarit })),
            }
          : decision.base;
      const etat: EtatPiece = base
        ? avecVersion(base, version)
        : {
            etape: 'piece',
            gabarit: decision.gabarit.id,
            nom: decision.gabarit.nom,
            dossier,
            versions: [version],
            versionChoisie: numero,
            plateau: { x: volume.x, y: volume.y },
          };
      const probleme = [
        controle.ok ? '' : ` Attention : ${controle.problemes.join(' ')}`,
        impression.ok ? '' : ` Sans support, ça risque de mal s’imprimer : ${impression.problemes.join(' ')}`,
      ].join('');
      if (voix) return { texte: `C'est prêt : ${version.fiche} Regarde l'écran du PC.${probleme}`, etat };
      const quoi = decision.changement ? `Version ${numero} (${decision.changement}). ` : '';
      const suite = controle.ok
        ? ' La pièce est à l’écran : tourne-la à la souris. Dis-moi ce qu’il faut changer, ou « imprime-la ».'
        : '';
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
      if (!version.stl) return { texte: `La version ${numero} n'a pas de fichier de pièce.` };
      const chemin = join(deps.racine, etat.dossier);
      const stl = join(chemin, version.stl);
      if (!existsSync(stl)) return { texte: `Je ne retrouve plus le fichier de la version ${numero} dans ${chemin}.` };
      const controle = controlerStl(lireStl(new Uint8Array(await readFile(stl))), version.taille);
      if (!controle.ok) return { texte: `Je n'imprime pas la version ${numero} : ${controle.problemes.join(' ')}` };

      input.progress?.('OrcaSlicer prépare le fichier d’impression…');
      const tranche = await deps.programmes.trancher(stl, join(chemin, `v${numero}-tranche`));
      if (!tranche.ok || !tranche.gcode) return { texte: tranche.message };
      const detail = detailCarte(tranche.infos);
      const misAJour = avecVersion(
        etat,
        {
          ...version,
          ...(tranche.infos?.dureeTexte ? { temps: tranche.infos.dureeTexte } : {}),
          ...(tranche.infos?.filamentG != null ? { filament: `${String(Math.round(tranche.infos.filamentG * 10) / 10).replace('.', ',')} g` } : {}),
        },
        numero,
      );

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
          nom: etat.nom,
          numero,
          base: `${etat.dossier}-v${numero}`,
          gcode: tranche.gcode,
          detail,
          occupee: decision.kind === 'imprimer',
        });
        return { texte, etat: misAJour };
      }
      if (!(await input.confirm(phraseConfirmationAtelier(etat.nom, numero, detail)))) {
        return { texte: "Rien n'a été lancé.", etat: misAJour };
      }
      const nomFichier = `${etat.dossier}-v${numero}.gcode`;
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
