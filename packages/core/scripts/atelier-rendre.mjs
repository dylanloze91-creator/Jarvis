#!/usr/bin/env node
/**
 * Atelier 3D : rendre les pièces par défaut (et quelques variantes) avec OpenSCAD, puis vérifier
 * chaque STL sans modèle : surface fermée, cotes égales à `taille()` du gabarit.
 *
 * Depuis la racine du dépôt :
 *   npm run atelier:rendre --workspace @jarvis/core -- --dir C:\dev\jarvis-data\atelier\_essais
 *
 * Options :
 *   --dir DOSSIER       où écrire les .scad, .stl et .png (défaut : C:\dev\jarvis-data\atelier\_essais)
 *   --openscad CHEMIN   programme OpenSCAD (défaut : cherché dans Program Files)
 *   --defauts           seulement les 10 pièces par défaut, sans les variantes
 *   --sans-image        ne fait pas les images
 *
 * OpenSCAD est lancé comme programme à part, sans shell. Rien n'est envoyé ailleurs.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const here = new URL('.', import.meta.url);
const atelier = await import(new URL('../dist/atelier/index.js', here).href);
const { GABARITS, gabarit, fabriquer, lireStl, controlerStl } = atelier;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = resolve(opt('--dir') ?? 'C:\\dev\\jarvis-data\\atelier\\_essais');
const seulementDefauts = args.includes('--defauts');
const sansImage = args.includes('--sans-image');

function trouverOpenscad() {
  const donne = opt('--openscad');
  if (donne) return donne;
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const base of pf) {
    for (const d of ['OpenSCAD', 'OpenSCAD (Nightly)']) {
      for (const exe of ['openscad.com', 'openscad.exe']) {
        const p = join(base, d, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return 'openscad';
}

function lancer(programme, argv, delaiMs = 300_000) {
  return new Promise((ok) => {
    const t0 = Date.now();
    const enfant = spawn(programme, argv, { windowsHide: true, shell: false });
    let sortie = '';
    enfant.stdout.on('data', (d) => (sortie += d));
    enfant.stderr.on('data', (d) => (sortie += d));
    const minuterie = setTimeout(() => enfant.kill(), delaiMs);
    enfant.on('error', (e) => {
      clearTimeout(minuterie);
      ok({ code: -1, sortie: String(e), ms: Date.now() - t0 });
    });
    enfant.on('close', (code) => {
      clearTimeout(minuterie);
      ok({ code, sortie, ms: Date.now() - t0 });
    });
  });
}

/** Variantes choisies pour toucher les cas limites des gabarits. */
const VARIANTES = [
  ['entretoise', 'sans-trou', { trou: 0 }],
  ['entretoise', 'fine', { diametre: 8, trou: 6.3, hauteur: 2 }],
  ['socle', 'carre-logement', { forme: 'carre', taille: 60, hauteur: 12, logement: 40, profondeur: 6 }],
  ['socle', 'rond-logement', { taille: 90, hauteur: 15, logement: 70, profondeur: 5 }],
  ['bac', '4x2', { colonnes: 4, rangees: 2 }],
  ['equerre', 'sans-trou', { trou: 0 }],
  ['crochet', 'sans-vis', { vis: 0 }],
  ['cale', 'pointe', { bas: 0 }],
  ['support_telephone', '45deg', { angle: 45, base: 120 }],
  ['support_telephone', '75deg', { angle: 75 }],
  ['support_telephone', 'dos-long', { angle: 40, dos: 160, rainure: 25, base: 110 }],
  ['boite', 'grande', { longueur: 200, largeur: 150, hauteur: 80 }],
  ['boite_couvercle', 'petite', { longueur: 40, largeur: 30, hauteur: 20 }],
  ['porte_etiquette', 'large', { largeur: 120, hauteur: 40 }],
];

const essais = GABARITS.map((g) => [g.id, 'defaut', {}]);
if (!seulementDefauts) essais.push(...VARIANTES);

const openscad = trouverOpenscad();
const version = await lancer(openscad, ['--version']);
console.log(`OpenSCAD : ${openscad} — ${version.sortie.trim() || `code ${version.code}`}`);
if (version.code !== 0) {
  console.error('OpenSCAD ne répond pas. Installe-le (voir le rapport) ou donne --openscad CHEMIN.');
  process.exit(2);
}
await mkdir(dir, { recursive: true });

const resultats = [];
for (const [id, nom, valeurs] of essais) {
  const g = gabarit(id);
  const piece = fabriquer(g, valeurs);
  const base = join(dir, `${id}-${nom}`);
  if (!piece.ok) {
    resultats.push({ id, nom, ok: false, raison: `refusée par le gabarit : ${piece.erreurs.join(' ')}` });
    continue;
  }
  await writeFile(`${base}.scad`, piece.scad, 'utf8');
  const rendu = await lancer(openscad, ['-o', `${base}.stl`, `${base}.scad`]);
  const avertissements = rendu.sortie.split(/\r?\n/).filter((l) => /WARNING|ERROR/i.test(l));
  if (rendu.code !== 0 || !existsSync(`${base}.stl`)) {
    resultats.push({ id, nom, ok: false, raison: `OpenSCAD en échec (code ${rendu.code}) : ${rendu.sortie.trim().slice(-400)}` });
    continue;
  }
  let a;
  try {
    a = controlerStl(lireStl(new Uint8Array(await readFile(`${base}.stl`))), piece.taille);
  } catch (e) {
    resultats.push({ id, nom, ok: false, raison: `STL illisible : ${e.message}` });
    continue;
  }
  let image = null;
  if (!sansImage) {
    const png = await lancer(openscad, ['--render', '-o', `${base}.png`, '--imgsize=800,600', '--viewall', '--autocenter', '--colorscheme=Tomorrow', `${base}.scad`]);
    image = png.code === 0 && existsSync(`${base}.png`) ? `${base}.png` : `échec (${png.code}) ${png.sortie.trim().slice(-200)}`;
  }
  const ok = a.ok && avertissements.length === 0;
  resultats.push({
    id,
    nom,
    ok,
    fermee: a.fermee,
    aretesOuvertes: a.aretesOuvertes,
    triangles: a.triangles,
    mesure: a.taille.map((x) => Math.round(x * 100) / 100),
    attendu: piece.taille.map((x) => Math.round(x * 100) / 100),
    problemes: a.problemes,
    avertissements,
    secondes: Math.round(rendu.ms / 100) / 10,
    image,
  });
}

for (const r of resultats) {
  const etat = r.ok ? 'OK ' : 'NON';
  const detail = r.raison ?? `${r.fermee ? 'fermée' : `ouverte (${r.aretesOuvertes} arêtes)`}, ${r.mesure.join(' × ')} mm (attendu ${r.attendu.join(' × ')}), ${r.secondes} s${r.problemes.length ? ` — ${r.problemes.join(' ')}` : ''}${r.avertissements.length ? ` — ${r.avertissements.join(' | ')}` : ''}`;
  console.log(`${etat} ${r.id} (${r.nom}) : ${detail}`);
}
await writeFile(join(dir, 'resultats.json'), JSON.stringify({ openscad: version.sortie.trim(), date: new Date().toISOString(), resultats }, null, 2), 'utf8');
const ratees = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - ratees} sur ${resultats.length} pièces bonnes. Détail : ${join(dir, 'resultats.json')}`);
process.exit(ratees ? 1 : 0);
