/**
 * Étapes de l'atelier appelables sans phrase ni fenêtre (cap « chef de projet », § 5) : la discussion
 * les appelle aujourd'hui, le chef de projet ou une autre équipe demain. Chacune rend un
 * `ResultatEtape` honnête, annonce son avancement, et reprend ce qui est déjà fait.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  agrandirPourTenir,
  ajoutsDe,
  composant,
  controlerImpression,
  controlerStl,
  fabriquer,
  fichePiece,
  fusionnerCotes,
  gabarit as gabaritNomme,
  provenanceCotes,
  type CotesTrouvees,
  geometrieCarte,
  lireStl,
  mesuresAffichees,
  nomDossierPiece,
  resultatEtape,
  type AtelierEtat,
  type AtelierVersionInfo,
  type Avancement,
  type Gabarit,
  type MesuresComposants,
  type ResultatEtape,
  type Valeurs,
} from '@jarvis/core';
import type { AtelierDeps } from './tourAtelier.js';

type EtatPiece = Extract<AtelierEtat, { etape: 'piece' }>;

export const ATELIER_SANS_OPENSCAD =
  "OpenSCAD n'est pas installé sur ce PC : je ne peux pas dessiner la pièce. Installe-le (winget install --id=OpenSCAD.OpenSCAD -e), puis redemande-la.";

/** Ce qu'il faut pour faire une version : le modèle, ses valeurs, et la pièce d'avant s'il y en a une. */
export interface EntreeVersion {
  /** Identifiant du modèle (`boite`, `boite_couvercle`…) ou le modèle lui-même. */
  gabarit: string | Gabarit;
  valeurs: Valeurs;
  /** La pièce à laquelle ajouter une version ; absente = nouvelle pièce. */
  base?: EtatPiece;
  /** « Hauteur : 30 → 38 mm », pour la fiche de la version. */
  changement?: string;
  /** Mesures de composants données par l'utilisateur (pour les cotes et leurs sources). */
  mesures?: MesuresComposants;
  /** Cotes trouvées ailleurs (recherche, fiches, autre équipe), chacune avec sa source. */
  cotes?: CotesTrouvees;
}

/** Ce que produit une version : la pièce à jour, ou des cotes proposées quand elle ne tenait pas. */
export interface VersionProduite {
  etat?: EtatPiece;
  version?: AtelierVersionInfo;
  /** La carte ne tenait pas : ces valeurs-là tiennent (vérifiées), à faire après « oui ». */
  proposition?: { valeurs: Valeurs; cotes: string };
  /** Le fichier .scad, quand le rendu a raté. */
  scad?: string;
}

function avecVersion(etat: EtatPiece, version: AtelierVersionInfo): EtatPiece {
  return {
    ...etat,
    versions: [...etat.versions.filter((v) => v.numero !== version.numero), version].sort((a, b) => a.numero - b.numero),
    versionChoisie: version.numero,
  };
}

async function dossierLibre(racine: string, base: (n: number) => string): Promise<string> {
  const pris = new Set(existsSync(racine) ? await readdir(racine) : []);
  for (let n = 1; ; n += 1) if (!pris.has(base(n))) return base(n);
}

/** Une version déjà rendue avec exactement le même .scad, dans le dossier de la pièce. */
async function dejaRendue(chemin: string, scad: string): Promise<number | null> {
  if (!existsSync(chemin)) return null;
  for (const nom of await readdir(chemin)) {
    const m = /^v(\d+)\.scad$/.exec(nom);
    if (!m || !existsSync(join(chemin, `v${m[1]}.stl`))) continue;
    if ((await readFile(join(chemin, nom), 'utf8')) === scad) return Number(m[1]);
  }
  return null;
}

/**
 * Sources et incertitudes des composants posés dans la pièce : la bibliothèque (plans officiels),
 * les mesures de l'utilisateur, les cotes trouvées ailleurs (sûres ou non).
 */
function cotesDesComposants(valeurs: Valeurs, mesures: MesuresComposants, cotes: CotesTrouvees): { sources: string[]; incertitudes: string[] } {
  const sources: string[] = [];
  const incertitudes: string[] = [];
  for (const a of ajoutsDe(valeurs)) {
    if (a.genre !== 'composant' || !a.composant) continue;
    const c = composant(a.composant);
    if (!c) continue;
    if (c.etat === 'a_mesurer') {
      const p = provenanceCotes(c.id, mesures, cotes, { uneSource: true });
      sources.push(...p.sources);
      incertitudes.push(...p.incertitudes);
    } else sources.push(...c.sources.map((s) => `${c.nom} : ${s}`));
    const g = geometrieCarte(c, fusionnerCotes(mesures, cotes, { uneSource: true }));
    if (g) incertitudes.push(...g.incertitudes.map((i) => `${c.nom} — ${i}`));
  }
  return { sources: [...new Set(sources)], incertitudes: [...new Set(incertitudes)] };
}

/**
 * Faire une version d'une pièce : vérifier, écrire le .scad, rendre le STL (ou reprendre un rendu
 * identique), contrôler, faire les deux images. `ok` seulement si le STL est fermé et aux cotes.
 * Une carte qui ne tient pas rend une question (« agrandir ? ») et les cotes qui tiennent, rien d'autre.
 */
export async function fabriquerVersion(
  entree: EntreeVersion,
  deps: Pick<AtelierDeps, 'racine' | 'programmes' | 'volume' | 'jour'>,
  avancement: (a: Avancement) => void = () => undefined,
): Promise<ResultatEtape<VersionProduite>> {
  const g = typeof entree.gabarit === 'string' ? gabaritNomme(entree.gabarit) : entree.gabarit;
  if (!g) return resultatEtape({ ok: false, raison: `Je ne connais pas la pièce « ${String(entree.gabarit)} ».` });
  const volume = await deps.volume();
  const piece = fabriquer(g, entree.valeurs, volume);
  const { sources, incertitudes } = cotesDesComposants(entree.valeurs, entree.mesures ?? {}, entree.cotes ?? {});
  if (!piece.ok) {
    const plus = agrandirPourTenir(g, entree.valeurs, piece.erreurs);
    if (plus && fabriquer(g, plus.valeurs, volume).ok) {
      return resultatEtape({
        ok: false,
        raison: piece.erreurs.join(' '),
        produit: { proposition: { valeurs: plus.valeurs, cotes: plus.texte } },
        questions: [{ id: 'agrandir', texte: `Je l'agrandis à ${plus.texte} ?`, reponses: ['oui', 'non'] }],
        sources,
        incertitudes,
      });
    }
    return resultatEtape({ ok: false, raison: piece.erreurs.join(' '), sources, incertitudes });
  }
  const openscad = deps.programmes.openscad();
  if (!openscad) return resultatEtape({ ok: false, raison: ATELIER_SANS_OPENSCAD, sources, incertitudes });

  const dossier = entree.base?.dossier ?? (await dossierLibre(deps.racine, (n) => nomDossierPiece(g, deps.jour(), n)));
  const chemin = join(deps.racine, dossier);
  await mkdir(chemin, { recursive: true });
  const numero = entree.base ? Math.max(...entree.base.versions.map((v) => v.numero)) + 1 : 1;
  const scad = join(chemin, `v${numero}.scad`);
  const stl = join(chemin, `v${numero}.stl`);
  const repris: string[] = [];

  // Reprise : un rendu identique déjà fait (relance après une coupure, ou retour aux mêmes valeurs).
  const meme = await dejaRendue(chemin, piece.scad);
  await writeFile(scad, piece.scad, 'utf8');
  if (meme !== null) {
    if (meme !== numero) await copyFile(join(chemin, `v${meme}.stl`), stl);
    repris.push(`v${meme}.stl`);
    avancement({ etape: 'dessin', message: `Même pièce que la version ${meme} : je reprends son dessin.`, part: 0.6 });
  } else {
    avancement({ etape: 'dessin', message: 'OpenSCAD dessine la pièce…', part: 0.1 });
    const rendu = await deps.programmes.rendreStl(openscad, scad, stl);
    if (!rendu.ok) {
      return resultatEtape({ ok: false, raison: `${rendu.message} Le fichier .scad est gardé dans ${chemin}.`, produit: { scad }, fichiers: [scad], sources, incertitudes });
    }
  }

  avancement({ etape: 'controle', message: 'Je contrôle la pièce…', part: 0.65 });
  const maillage = lireStl(new Uint8Array(await readFile(stl)));
  const controle = controlerStl(maillage, piece.taille);
  // Imprimable sans support, posée telle quelle ? (surplombs de plus de 45°, ponts de plus de 25 mm)
  const impression = controlerImpression(maillage, g.nom);

  let image: string | undefined;
  let imageDessus: string | undefined;
  const pngs = meme !== null && existsSync(join(chemin, `v${meme}.png`));
  if (pngs) {
    for (const [de, vers] of [[`v${meme}.png`, `v${numero}.png`], [`v${meme}-dessus.png`, `v${numero}-dessus.png`]] as const) {
      if (!existsSync(join(chemin, de))) continue;
      if (de !== vers) await copyFile(join(chemin, de), join(chemin, vers));
      repris.push(de);
    }
    image = `v${numero}.png`;
    imageDessus = existsSync(join(chemin, `v${numero}-dessus.png`)) ? `v${numero}-dessus.png` : undefined;
  } else {
    avancement({ etape: 'images', message: 'OpenSCAD fait les images de la pièce…', part: 0.75 });
    const vues = deps.programmes.rendreVues
      ? await deps.programmes.rendreVues(openscad, chemin, numero).catch(() => ({ troisQuarts: null, dessus: null }))
      : null;
    image = vues ? (vues.troisQuarts ?? undefined) : (await deps.programmes.rendreImage(openscad, scad, join(chemin, `v${numero}.png`))).ok ? `v${numero}.png` : undefined;
    imageDessus = vues?.dessus ?? undefined;
  }

  const version: AtelierVersionInfo = {
    numero,
    valeurs: piece.valeurs,
    fiche: fichePiece(piece),
    mesures: mesuresAffichees(g, piece.valeurs),
    taille: piece.taille,
    stl: `v${numero}.stl`,
    ...(image ? { image } : {}),
    ...(imageDessus ? { imageDessus } : {}),
    ...(entree.changement ? { changement: entree.changement } : {}),
  };
  // Le modèle a changé (boîte → boîte à couvercle) : la pièce prend le nouveau, les anciennes
  // versions gardent le leur.
  const base =
    entree.base && entree.base.gabarit !== g.id
      ? {
          ...entree.base,
          gabarit: g.id,
          nom: g.nom,
          versions: entree.base.versions.map((v) => (v.gabarit ? v : { ...v, gabarit: entree.base!.gabarit })),
        }
      : entree.base;
  const etat: EtatPiece = base
    ? avecVersion(base, version)
    : { etape: 'piece', gabarit: g.id, nom: g.nom, dossier, versions: [version], versionChoisie: numero, plateau: { x: volume.x, y: volume.y } };

  avancement({ etape: 'fini', message: controle.ok ? 'La pièce est prête.' : 'La pièce est dessinée, mais un contrôle a raté.', part: 1 });
  const fichiers = [scad, stl, ...(image ? [join(chemin, image)] : []), ...(imageDessus ? [join(chemin, imageDessus)] : [])];
  return resultatEtape({
    ok: controle.ok,
    ...(controle.ok ? {} : { raison: controle.problemes.join(' ') }),
    produit: { etat, version },
    fichiers,
    sources,
    incertitudes,
    avertissements: [
      ...(impression.ok ? [] : [`Sans support, ça risque de mal s’imprimer : ${impression.problemes.join(' ')}`]),
      ...(image ? [] : ["OpenSCAD n'a pas pu faire l'image de la pièce."]),
    ],
    repris,
  });
}
