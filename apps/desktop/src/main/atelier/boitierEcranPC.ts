/**
 * Atelier 3D, côté PC : faire une version du boîtier à écran (un ensemble de pièces).
 *
 * 1. Le boîtier est dessiné par règles (`dessinerBoitierEcran`, cœur).
 * 2. Chaque pièce est écrite en OpenSCAD et rendue à part (`v1-Facade.stl`…), plusieurs à la fois ;
 *    une pièce identique à une version d'avant est reprise sans être redessinée.
 * 3. Pendant ce temps, tous les contrôles du boîtier tournent (`controlerBoitierEcran` : 64 pour le
 *    hub) ; ils rendent la main souvent, Jarvis reste réactif.
 * 4. Chaque STL est contrôlé (fermé, aux cotes, imprimable sans support).
 * 5. Le boîtier monté (`v1.stl`) et éclaté (`v1-eclate.stl`) sont assemblés à partir des pièces, pour
 *    l'écran 3D et les images.
 *
 * Un boîtier dont un contrôle échoue n'est jamais montré comme bon : la version n'est pas proposée,
 * et la raison est dite.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  appliquerMatrice,
  choixBoitierEcran,
  controlerBoitierEcran,
  controlerImpression,
  controlerStl,
  dessinerBoitierEcran,
  ecrireStlBinaire,
  fichierScad,
  lireStl,
  mesuresAffichees,
  nomDossierPiece,
  resultatEtape,
  composant,
  type AtelierEtat,
  type AtelierVersionInfo,
  type Avancement,
  type ControleBoitier,
  type Gabarit,
  type PieceBoitier,
  type PieceVersionInfo,
  type ResultatEtape,
  type Valeurs,
  type VolumeImpression,
} from '@jarvis/core';
import type { AtelierDeps } from './tourAtelier.js';
import type { EntreeVersion, VersionProduite } from './etapes.js';

type EtatPiece = Extract<AtelierEtat, { etape: 'piece' }>;

/** Pièces rendues en même temps par OpenSCAD (un processus chacune). */
const RENDUS_EN_MEME_TEMPS = 4;
/** Une grosse pièce (socle) met plusieurs minutes avec OpenSCAD 2021. */
export const DELAI_PIECE_MS = 15 * 60_000;

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');

async function dossierLibre(racine: string, base: (n: number) => string): Promise<string> {
  const pris = new Set(existsSync(racine) ? await readdir(racine) : []);
  for (let n = 1; ; n += 1) if (!pris.has(base(n))) return base(n);
}

/** Une pièce déjà rendue avec exactement le même .scad (une autre version du même boîtier). */
async function pieceDejaRendue(chemin: string, nom: string, scad: string): Promise<string | null> {
  if (!existsSync(chemin)) return null;
  for (const f of await readdir(chemin)) {
    const m = new RegExp(`^v(\\d+)-${nom}\\.scad$`).exec(f);
    if (!m) continue;
    const stl = `v${m[1]}-${nom}.stl`;
    if (existsSync(join(chemin, stl)) && (await readFile(join(chemin, f), 'utf8')) === scad) return stl;
  }
  return null;
}

/** Les triangles de toutes les pièces placées (montées, ou éclatées). */
function assembler(maillages: Map<string, Float32Array>, pieces: readonly PieceBoitier[], eclate: boolean): Float32Array {
  const parts: Float32Array[] = [];
  for (const p of pieces) {
    const pos = maillages.get(p.nom);
    if (!pos) continue;
    for (const m of p.placements) {
      const out = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        const q = appliquerMatrice(m, [pos[i]!, pos[i + 1]!, pos[i + 2]!]);
        out[i] = q[0] + (eclate ? p.eclate[0] : 0);
        out[i + 1] = q[1] + (eclate ? p.eclate[1] : 0);
        out[i + 2] = q[2] + (eclate ? p.eclate[2] : 0);
      }
      // Un miroir retourne les triangles : on remet leurs sommets dans l'ordre.
      const det =
        m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
      if (det < 0) {
        for (let t = 0; t < out.length; t += 9) {
          for (let k = 0; k < 3; k += 1) {
            const a = out[t + 3 + k]!;
            out[t + 3 + k] = out[t + 6 + k]!;
            out[t + 6 + k] = a;
          }
        }
      }
      parts.push(out);
    }
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}

/** Une phrase pour le boîtier : cotes, choix, contrôles, pièces. */
export function ficheBoitierEcran(g: Gabarit, valeurs: Valeurs, taille: [number, number, number], pieces: readonly PieceVersionInfo[], controles: { total: number; ok: number }): string {
  const c = choixBoitierEcran(valeurs);
  const [x, y, z] = taille.map(fmt);
  const camera = c.camera ? `, caméra grand angle au-dessus de l’écran${c.cache ? ' avec un cache coulissant' : ''}` : '';
  const prises = c.ports === 'arriere' ? 'USB et réseau à l’arrière, alimentation et HDMI à droite' : 'USB et réseau à droite, alimentation et HDMI à l’arrière';
  const exemplaires = pieces.reduce((n, p) => n + p.nombre, 0);
  return (
    `${g.nom[0]!.toUpperCase()}${g.nom.slice(1)} de ${x} × ${y} × ${z} mm pour le Raspberry Pi 5 et l’écran tactile 7 pouces : écran incliné de ${fmt(c.angle)}°${camera} ; ${prises}. ` +
    `${controles.ok} contrôles sur ${controles.total}. ` +
    `${pieces.length} pièces à imprimer une par une (${exemplaires} en tout) : ${pieces.map((p) => (p.nombre > 1 ? `${p.titre} × ${p.nombre}` : p.titre)).join(', ')}.`
  );
}

/**
 * Faire une version du boîtier à écran. `piece` : les valeurs déjà vérifiées par `fabriquer`.
 */
export async function fabriquerBoitierEcran(
  g: Gabarit,
  valeurs: Valeurs,
  tailleGabarit: [number, number, number],
  entree: EntreeVersion,
  deps: Pick<AtelierDeps, 'racine' | 'programmes' | 'jour'>,
  volume: VolumeImpression,
  openscad: string,
  avancement: (a: Avancement) => void,
  controler: (b: ReturnType<typeof dessinerBoitierEcran>, a: (part: number, quoi: string) => void) => Promise<ControleBoitier[]> = controlerBoitierEcran,
): Promise<ResultatEtape<VersionProduite>> {
  const choix = choixBoitierEcran(valeurs);
  let taille = tailleGabarit;
  const b = dessinerBoitierEcran(choix);
  const pieces = b.pieces();
  const sources = ['raspberry_pi_5', 'touch_display_2_7', ...(choix.camera ? ['camera_module_3_wide'] : [])].flatMap((id) => {
    const c = composant(id);
    return c ? c.sources.map((s) => `${c.nom} : ${s}`) : [];
  });
  const incertitudes = [
    'Épaisseur de l’écran au bord (une source : 8,6 mm) : les retenues souples tiennent de 7,5 à 10,5 mm.',
    ...(choix.camera ? ['Place de l’objectif sur la carte de la caméra (5,75 à 13,4 mm selon les sources) : le chariot se règle de ±5 mm.'] : []),
    'Prises au dos de l’écran : inconnues, tout le dos de l’écran est laissé libre.',
  ];

  const dossier = entree.base?.dossier ?? (await dossierLibre(deps.racine, (n) => nomDossierPiece(g, deps.jour(), n)));
  const chemin = join(deps.racine, dossier);
  await mkdir(chemin, { recursive: true });
  const numero = entree.base ? Math.max(...entree.base.versions.map((v) => v.numero)) + 1 : 1;
  const scadMonte = join(chemin, `v${numero}.scad`);
  await writeFile(scadMonte, b.scadAssemblage(), 'utf8');
  const repris: string[] = [];

  // Rendu des pièces (OpenSCAD, plusieurs à la fois) et contrôles du boîtier, en même temps.
  const aRendre: { p: PieceBoitier; scad: string; stl: string }[] = [];
  for (const p of pieces) {
    const texte = fichierScad(`${p.titre} (sens d’impression : ${p.sens})`, p.forme);
    const scad = `v${numero}-${p.nom}.scad`;
    const stl = `v${numero}-${p.nom}.stl`;
    const meme = await pieceDejaRendue(chemin, p.nom, texte);
    await writeFile(join(chemin, scad), texte, 'utf8');
    if (meme) {
      if (meme !== stl) await copyFile(join(chemin, meme), join(chemin, stl));
      repris.push(meme);
    } else aRendre.push({ p, scad, stl });
  }
  // Les plus grosses d'abord (le socle met le plus longtemps).
  const ordre = ['Socle', 'Facade', 'Dos', 'Capot'];
  aRendre.sort((a, c) => (ordre.indexOf(a.p.nom) + 1 || 99) - (ordre.indexOf(c.p.nom) + 1 || 99));
  let faites = 0;
  const echecs: string[] = [];
  const dire = (message: string, part: number) => avancement({ etape: 'dessin', message, part });
  if (aRendre.length) dire(`OpenSCAD dessine ${aRendre.length} pièce${aRendre.length > 1 ? 's' : ''} du boîtier (plusieurs minutes pour le socle)…`, 0.05);
  const file = [...aRendre];
  const ouvrier = async () => {
    for (let r = file.shift(); r; r = file.shift()) {
      const rendu = await deps.programmes.rendreStl(openscad, join(chemin, r.scad), join(chemin, r.stl), DELAI_PIECE_MS);
      faites += 1;
      if (!rendu.ok) echecs.push(`${r.p.titre} : ${rendu.message}`);
      else if (faites < aRendre.length) dire(`Pièce ${faites} sur ${aRendre.length} dessinée (${r.p.titre}).`, 0.05 + (0.5 * faites) / aRendre.length);
    }
  };
  let dernierQuoi = '';
  const [controles] = await Promise.all([
    controler(b, (part, quoi) => {
      if (quoi !== dernierQuoi && quoi !== 'fini') {
        dernierQuoi = quoi;
        avancement({ etape: 'controle', message: `Je vérifie le boîtier : ${quoi}…`, part: 0.05 + 0.5 * part });
      }
    }),
    Promise.all(Array.from({ length: Math.min(RENDUS_EN_MEME_TEMPS, aRendre.length) }, ouvrier)),
  ]);
  if (echecs.length) {
    return resultatEtape({ ok: false, raison: `OpenSCAD n’a pas pu dessiner ${echecs.join(' ; ')}. Les fichiers .scad sont gardés dans ${chemin}.`, sources, incertitudes, fichiers: [scadMonte] });
  }

  // Contrôle de chaque STL : fermé, aux cotes, imprimable sans support.
  avancement({ etape: 'controle', message: 'Je contrôle chaque pièce…', part: 0.6 });
  const maillages = new Map<string, Float32Array>();
  const problemes: string[] = [];
  const avertissements: string[] = [];
  const infos: PieceVersionInfo[] = [];
  for (const p of pieces) {
    const stl = `v${numero}-${p.nom}.stl`;
    const m = lireStl(new Uint8Array(await readFile(join(chemin, stl))));
    const a = p.forme.geo!.aabb;
    const t: [number, number, number] = [a[1] - a[0], a[3] - a[2], a[5] - a[4]];
    const c = controlerStl(m, t);
    if (!c.ok) problemes.push(`${p.titre} : ${c.problemes.join(' ')}`);
    if (t[0] > volume.x || t[1] > volume.y || t[2] > volume.z) problemes.push(`${p.titre} : ne tient pas dans l’imprimante (${t.map((x) => Math.ceil(x)).join(' × ')} mm).`);
    const imp = controlerImpression(m, p.titre);
    if (!imp.ok) avertissements.push(`Sans support, ça risque de mal s’imprimer : ${imp.problemes.join(' ')}`);
    maillages.set(p.nom, m.positions);
    infos.push({ nom: p.nom, titre: p.titre, nombre: p.nombre, sens: p.sens, stl, taille: t });
  }

  // Le boîtier monté et éclaté, pour l'écran 3D et les images.
  avancement({ etape: 'images', message: 'J’assemble le boîtier et je fais les images…', part: 0.7 });
  const monte = assembler(maillages, pieces, false);
  await writeFile(join(chemin, `v${numero}.stl`), ecrireStlBinaire(monte));
  // Encombrement réel du boîtier monté (lu sur les pièces rendues), pour la fiche et l'écran 3D.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < monte.length; i += 1) {
    const k = i % 3;
    if (monte[i]! < lo[k]!) lo[k] = monte[i]!;
    if (monte[i]! > hi[k]!) hi[k] = monte[i]!;
  }
  taille = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
  await writeFile(join(chemin, `v${numero}-eclate.stl`), ecrireStlBinaire(assembler(maillages, pieces, true)));
  const vues = deps.programmes.rendreVues ? await deps.programmes.rendreVues(openscad, chemin, numero).catch(() => ({ troisQuarts: null, dessus: null })) : null;

  const rates = controles.filter((x) => !x.ok);
  const resume = { total: controles.length, ok: controles.length - rates.length };
  await writeFile(
    join(chemin, `v${numero}-controles.txt`),
    `${controles.map((x) => `${x.ok ? 'OK ' : '!! '} [${x.groupe}] ${x.controle} : ${x.mesure}${x.attendu ? ` (attendu : ${x.attendu})` : ''}`).join('\n')}\n`,
    'utf8',
  );
  const version: AtelierVersionInfo = {
    numero,
    gabarit: g.id,
    valeurs,
    fiche: ficheBoitierEcran(g, valeurs, taille, infos, resume),
    mesures: mesuresAffichees(g, valeurs),
    taille,
    stl: `v${numero}.stl`,
    eclate: `v${numero}-eclate.stl`,
    pieces: infos,
    controles: resume,
    ...(vues?.troisQuarts ? { image: vues.troisQuarts } : {}),
    ...(vues?.dessus ? { imageDessus: vues.dessus } : {}),
    ...(entree.changement ? { changement: entree.changement } : {}),
  };
  const fichiers = [scadMonte, join(chemin, `v${numero}.stl`), join(chemin, `v${numero}-controles.txt`), ...infos.map((p) => join(chemin, p.stl))];

  if (rates.length || problemes.length) {
    // Jamais montré comme bon : la raison, et la version reste hors de l'écran.
    const raisons = [...rates.map((x) => `${x.controle} (${x.mesure}${x.attendu ? `, attendu ${x.attendu}` : ''})`), ...problemes];
    const conseil = rates.some((x) => x.groupe === 'stabilité') ? ' Avec l’écran moins incliné, il tiendrait mieux : dis « moins incliné ».' : '';
    return resultatEtape({
      ok: false,
      raison: `Je ne te montre pas ce boîtier : ${resume.ok} contrôles sur ${resume.total} seulement. ${raisons.join(' ; ')}.${conseil}`,
      sources,
      incertitudes,
      fichiers,
      repris,
    });
  }
  const etat: EtatPiece = entree.base
    ? {
        ...entree.base,
        gabarit: g.id,
        nom: g.nom,
        versions: [...entree.base.versions.filter((v) => v.numero !== numero), version].sort((a, c) => a.numero - c.numero),
        versionChoisie: numero,
      }
    : { etape: 'piece', gabarit: g.id, nom: g.nom, dossier, versions: [version], versionChoisie: numero, plateau: { x: volume.x, y: volume.y } };
  avancement({ etape: 'fini', message: 'Le boîtier est prêt.', part: 1 });
  return resultatEtape({ ok: true, produit: { etat, version }, fichiers, sources, incertitudes, avertissements, repris });
}
