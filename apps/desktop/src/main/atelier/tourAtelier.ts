/**
 * Atelier 3D dans la discussion de Jarvis Test, côté PC : la décision vient du cœur
 * (`deciderAtelier`, règles seules), ce fichier fait le travail.
 *
 * - pièce : OpenSCAD rend `v<N>.stl` (et `v<N>.png`) dans `<atelier>/<pièce>/`, le STL est
 *   contrôlé (fermé, aux cotes du gabarit) ; chaque changement crée une version, l'ancienne reste ;
 * - imprimer : jamais depuis une enceinte ; OrcaSlicer tranche avec les copies des préréglages de
 *   l'utilisateur (lus, jamais modifiés), temps et filament lus dans le fichier produit, puis
 *   **carte de confirmation**, et seulement après, envoi à Moonraker. Une impression déjà en cours
 *   bloque l'envoi.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  controlerStl,
  dernierAtelier,
  deciderAtelier,
  fabriquer,
  fichePiece,
  lireStl,
  mesuresAffichees,
  nomDossierPiece,
  phraseConfirmationAtelier,
  phraseTempsFilament,
  SPEAKER_CANNOT_START,
  type AtelierEtat,
  type AtelierVersionInfo,
  type ChatMessage,
  type InfosGcode,
  type PrintStatus,
  type VolumeImpression,
} from '@jarvis/core';

type EtatPiece = Extract<AtelierEtat, { etape: 'piece' }>;

/** Ce que l'imprimante doit savoir faire pour l'atelier (le client Moonraker du lot B suffit). */
export interface ImprimanteAtelier {
  status(): Promise<PrintStatus>;
  upload(name: string, bytes: Uint8Array, print: boolean): Promise<void>;
}

export interface ProgrammesAtelier {
  /** Chemin d'OpenSCAD, ou `null` s'il n'est pas installé. */
  openscad(): string | null;
  rendreStl(openscad: string, scad: string, stl: string): Promise<{ ok: boolean; message: string }>;
  rendreImage(openscad: string, scad: string, png: string): Promise<{ ok: boolean }>;
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

/** Un tour d'atelier. `null` : la phrase n'est pas pour l'atelier, le tour suit son chemin. */
export async function tourAtelier(input: AtelierEntree, deps: AtelierDeps): Promise<AtelierSortie | null> {
  const precedent = dernierAtelier(input.messages);
  const decision = deciderAtelier(input.text, precedent);
  const voix = input.place === 'enceinte';

  switch (decision.kind) {
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
      const controle = controlerStl(lireStl(new Uint8Array(await readFile(stl))), piece.taille);
      const image = (await deps.programmes.rendreImage(openscad, scad, join(chemin, `v${numero}.png`))).ok ? `v${numero}.png` : undefined;

      const version: AtelierVersionInfo = {
        numero,
        valeurs: piece.valeurs,
        fiche: fichePiece(piece),
        mesures: mesuresAffichees(decision.gabarit, piece.valeurs),
        taille: piece.taille,
        stl: `v${numero}.stl`,
        ...(image ? { image } : {}),
        ...(decision.changement ? { changement: decision.changement } : {}),
      };
      const etat: EtatPiece = decision.base
        ? avecVersion(decision.base, version)
        : {
            etape: 'piece',
            gabarit: decision.gabarit.id,
            nom: decision.gabarit.nom,
            dossier,
            versions: [version],
            versionChoisie: numero,
            plateau: { x: volume.x, y: volume.y },
          };
      const probleme = controle.ok ? '' : ` Attention : ${controle.problemes.join(' ')}`;
      if (voix) return { texte: `C'est prêt : ${version.fiche} Regarde l'écran du PC.${probleme}`, etat };
      const quoi = decision.changement ? `Version ${numero} (${decision.changement}). ` : '';
      const suite = controle.ok
        ? ' Elle est à l’écran : tourne-la à la souris. Dis-moi ce qu’il faut changer, ou « imprime-la ».'
        : '';
      return { texte: `${quoi}${version.fiche}${probleme}${suite}`, etat };
    }
    case 'imprimer': {
      if (input.place === 'enceinte') return { texte: SPEAKER_CANNOT_START };
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
      if (statut.state === 'printing' || statut.state === 'paused') {
        return { texte: "Une impression est déjà en cours sur l'imprimante : je n'envoie rien.", etat: misAJour };
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
