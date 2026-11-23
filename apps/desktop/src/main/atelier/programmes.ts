/**
 * Atelier 3D, côté PC : OpenSCAD et OrcaSlicer lancés comme programmes à part (jamais liés à
 * Jarvis), sans shell, arguments fixes, délai borné. Jarvis ne les installe jamais.
 *
 * Les préréglages d'OrcaSlicer de l'utilisateur sont **lus**, jamais écrits : Jarvis en fait des
 * copies aplaties dans son propre dossier (`<atelier>/_orca/`), seules passées à la ligne de commande.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import {
  aplatirPreset,
  imprimanteChoisie,
  lireGcode,
  rendreCompatible,
  volumeImprimante,
  type GenreOrca,
  type InfosGcode,
  type PresetOrca,
} from '@jarvis/core';
import { run } from '../tools/platform/exec.js';

const DELAI_OPENSCAD_MS = 180_000;
const DELAI_ORCA_MS = 300_000;

function programmesWindows(): string[] {
  return [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
}

/** `openscad.com` d'abord : sous Windows, c'est lui qui rend la sortie à la console (manuel d'OpenSCAD). */
export function trouverOpenscad(donne?: string): string | null {
  if (donne) return existsSync(donne) ? donne : null;
  for (const base of programmesWindows()) {
    for (const d of ['OpenSCAD', 'OpenSCAD (Nightly)']) {
      for (const exe of ['openscad.com', 'openscad.exe']) {
        const p = join(base, d, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export function trouverOrca(donne?: string): string | null {
  if (donne) return existsSync(donne) ? donne : null;
  for (const base of programmesWindows()) {
    const p = join(base, 'OrcaSlicer', 'orca-slicer.exe');
    if (existsSync(p)) return p;
  }
  return null;
}

export interface ResultatProgramme {
  ok: boolean;
  message: string;
  detail: string;
}

/** Pièce `.scad` → `.stl`. */
export async function rendreStl(openscad: string, scad: string, stl: string): Promise<ResultatProgramme> {
  const r = await run(openscad, ['-o', stl, scad], { timeoutMs: DELAI_OPENSCAD_MS, maxOutputChars: 4_000 });
  const detail = `${r.stdout}\n${r.stderr}`.trim();
  if (r.timedOut) return { ok: false, message: 'OpenSCAD a mis trop longtemps à dessiner la pièce.', detail };
  if (r.code !== 0 || !existsSync(stl)) return { ok: false, message: `OpenSCAD n'a pas pu dessiner la pièce (code ${r.code}).`, detail };
  return { ok: true, message: 'Pièce dessinée.', detail };
}

/** Pièce `.scad` → image `.png`, vue d'ensemble de trois quarts. */
export async function rendreImage(openscad: string, scad: string, png: string): Promise<ResultatProgramme> {
  const r = await run(openscad, ['--render', '-o', png, '--imgsize=800,600', '--viewall', '--autocenter', '--colorscheme=Tomorrow', scad], {
    timeoutMs: DELAI_OPENSCAD_MS,
    maxOutputChars: 4_000,
  });
  const detail = `${r.stdout}\n${r.stderr}`.trim();
  if (r.code !== 0 || !existsSync(png)) return { ok: false, message: "OpenSCAD n'a pas pu faire l'image.", detail };
  return { ok: true, message: 'Image faite.', detail };
}

export interface CopiesOrca {
  machine: string;
  process: string;
  filament: string;
  imprimante: string;
  reglage: string;
  matiere: string;
  volume: { x: number; y: number; z: number } | null;
}

interface ChoixPresets {
  /** Nom du préréglage d'imprimante ; absent = celui choisi en dernier dans OrcaSlicer. */
  imprimante?: string;
  reglage?: string;
  matiere?: string;
}

async function lireJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fichiersJson(dossier: string): Promise<string[]> {
  const out: string[] = [];
  const parcourir = async (d: string): Promise<void> => {
    let entrees;
    try {
      entrees = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entrees) {
      const p = join(d, e.name);
      if (e.isDirectory()) await parcourir(p);
      else if (e.name.endsWith('.json')) out.push(p);
    }
  };
  await parcourir(dossier);
  return out;
}

/**
 * Lit les préréglages d'OrcaSlicer (`%APPDATA%\OrcaSlicer`) et écrit des copies aplaties dans
 * `sortie`. Les préréglages de l'utilisateur gagnent sur les préréglages système du même nom.
 */
export async function preparerPresetsOrca(sortie: string, choix: ChoixPresets = {}, racineOrca = join(process.env.APPDATA ?? '', 'OrcaSlicer')): Promise<CopiesOrca> {
  const systeme = join(racineOrca, 'system');
  const utilisateur = join(racineOrca, 'user');
  if (!existsSync(systeme)) throw new Error(`Préréglages d'OrcaSlicer introuvables (${racineOrca}).`);

  const index = new Map<string, PresetOrca[]>();
  const utilisateurs = new Map<string, PresetOrca>();
  for (const [racine, estUtilisateur] of [[systeme, false], [utilisateur, true]] as const) {
    for (const p of await fichiersJson(racine)) {
      const json = await lireJson(p);
      if (!json || typeof json.name !== 'string') continue;
      const morceaux = relative(racine, p).split(sep);
      const genre = estUtilisateur ? morceaux[1] : typeof json.type === 'string' ? json.type : undefined;
      if (genre !== 'machine' && genre !== 'process' && genre !== 'filament') continue;
      const preset: PresetOrca = { source: p, fabricant: estUtilisateur ? 'utilisateur' : morceaux[0]!, json };
      const cle = `${genre}:${json.name}`;
      if (estUtilisateur) utilisateurs.set(cle, preset);
      else index.set(cle, [...(index.get(cle) ?? []), preset]);
    }
  }

  const conf = await readFile(join(racineOrca, 'OrcaSlicer.conf'), 'utf8').catch(() => '');
  const imprimante = choix.imprimante ?? imprimanteChoisie(conf);
  if (!imprimante) throw new Error("Aucune imprimante choisie dans OrcaSlicer : ouvre OrcaSlicer et choisis ton imprimante une fois.");

  const obtenir = (genre: GenreOrca, nom: string): PresetOrca => {
    const p = utilisateurs.get(`${genre}:${nom}`) ?? index.get(`${genre}:${nom}`)?.[0];
    if (!p) throw new Error(`Préréglage OrcaSlicer introuvable : « ${nom} ».`);
    return p;
  };
  const aplatir = (genre: GenreOrca, nom: string) =>
    aplatirPreset(obtenir(genre, nom), genre, (parent) => index.get(`${genre}:${parent}`) ?? []);

  const machine = aplatir('machine', imprimante);
  const reglage = choix.reglage ?? reglageParDefaut(utilisateurs, machine.chaine);
  const matiere = choix.matiere ?? matiereParDefaut(utilisateurs, machine.chaine);
  if (!reglage) throw new Error(`Aucun réglage d'impression trouvé pour « ${imprimante} ».`);
  if (!matiere) throw new Error(`Aucun filament trouvé pour « ${imprimante} ».`);
  const process_ = aplatir('process', reglage);
  const filament = aplatir('filament', matiere);

  await mkdir(sortie, { recursive: true });
  const ecrire = async (n: string, json: Record<string, unknown>): Promise<string> => {
    const p = join(sortie, n);
    await writeFile(p, JSON.stringify(json, null, 1), 'utf8');
    return p;
  };
  return {
    machine: await ecrire('machine.json', machine.json),
    process: await ecrire('process.json', rendreCompatible(process_.json, imprimante)),
    filament: await ecrire('filament.json', rendreCompatible(filament.json, imprimante)),
    imprimante,
    reglage,
    matiere,
    volume: volumeImprimante(machine.json),
  };
}

function compatibleAvec(json: Record<string, unknown>, noms: string[]): boolean {
  const liste = json.compatible_printers;
  return !Array.isArray(liste) || liste.length === 0 || liste.some((x) => noms.includes(String(x)));
}

/** Le réglage d'impression de l'utilisateur fait pour cette imprimante (ou son parent), sinon aucun. */
function reglageParDefaut(utilisateurs: Map<string, PresetOrca>, chaine: string[]): string | null {
  for (const [cle, p] of utilisateurs) {
    if (cle.startsWith('process:') && compatibleAvec(p.json, chaine)) return String(p.json.name);
  }
  return null;
}

function matiereParDefaut(utilisateurs: Map<string, PresetOrca>, chaine: string[]): string | null {
  for (const [cle, p] of utilisateurs) {
    if (cle.startsWith('filament:') && compatibleAvec(p.json, chaine)) return String(p.json.name);
  }
  return null;
}

export interface Tranche {
  ok: boolean;
  message: string;
  gcode: string | null;
  infos: InfosGcode | null;
  detail: string;
}

/** Tranche un STL avec les copies aplaties ; temps et filament lus dans le fichier produit. */
export async function trancher(orca: string, stl: string, copies: CopiesOrca, sortie: string, plateau?: string): Promise<Tranche> {
  await mkdir(sortie, { recursive: true });
  const argv = [stl, '--load-settings', `${copies.machine};${copies.process}`, '--load-filaments', copies.filament];
  if (plateau) argv.push('--curr-bed-type', plateau);
  argv.push('--arrange', '1', '--orient', '0', '--slice', '0', '--outputdir', sortie);
  const r = await run(orca, argv, { timeoutMs: DELAI_ORCA_MS, maxOutputChars: 4_000 });
  const detail = `${r.stdout}\n${r.stderr}`.trim();
  const gcode = join(sortie, 'plate_1.gcode');
  if (r.timedOut) return { ok: false, message: 'OrcaSlicer a mis trop longtemps à préparer le fichier.', gcode: null, infos: null, detail };
  if (r.code !== 0 || !existsSync(gcode)) {
    const raison = /not compatible/i.test(detail) ? ' (réglage incompatible avec l’imprimante)' : '';
    return { ok: false, message: `OrcaSlicer n'a pas pu préparer le fichier${raison}.`, gcode: null, infos: null, detail };
  }
  const infos = lireGcode(await readFile(gcode, 'utf8'));
  return { ok: true, message: `Fichier préparé : ${basename(gcode)}.`, gcode, infos, detail };
}
