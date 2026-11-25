#!/usr/bin/env node
/**
 * Photos de test des yeux (cahier `docs/specs/yeux-etape-1.md`, § 3.6, banc de mesure).
 * Prend une photo de la caméra de Klipper toutes les N minutes, EN LECTURE SEULE (GET seulement,
 * par `YeuxImprimante`), et la range dans `<dossier>/en-cours-ok/` tant que l'impression est en
 * cours ou en pause. S'arrête quand l'impression n'est plus en cours, ou après `--max` photos.
 * Les photos restent sur le PC (jamais dans le dépôt). Le journal ne donne que des heures et des tailles.
 *
 *   node packages/core/scripts/yeux-photos.mjs --moonraker http://mainsailos.local \
 *        --dir C:/dev/jarvis-data/yeux/photos-test --minutes 10 --max 40
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
};
const moonraker = opt('moonraker', 'http://mainsailos.local');
const dossier = opt('dir', 'C:/dev/jarvis-data/yeux/photos-test');
const minutes = Number(opt('minutes', '10'));
const max = Number(opt('max', '40'));

const ici = dirname(fileURLToPath(import.meta.url));
const core = await import(pathToFileURL(join(ici, '..', 'dist', 'index.js')).href);
const yeux = new core.YeuxImprimante(moonraker);
const sortie = join(dossier, 'en-cours-ok');
await mkdir(sortie, { recursive: true });

const deux = (n) => String(n).padStart(2, '0');
const nom = (d) =>
  `imprimante-${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}_${deux(d.getHours())}-${deux(d.getMinutes())}-${deux(d.getSeconds())}.jpg`;
const journal = (texte) => console.log(`[${new Date().toLocaleTimeString('fr-FR')}] ${texte}`);

let prises = 0;
for (;;) {
  let etat = null;
  try {
    etat = await yeux.etat();
  } catch (erreur) {
    journal(`état illisible : ${erreur instanceof Error ? erreur.message : erreur}`);
  }
  const state = etat?.status.state ?? 'inconnu';
  if (etat && state !== 'printing' && state !== 'paused') {
    journal(`impression ${state} : arrêt (${prises} photos)`);
    break;
  }
  if (etat) {
    const r = await yeux.prendrePhoto();
    if (r.ok) {
      const fichier = join(sortie, nom(new Date(r.photo.prisA)));
      await writeFile(fichier, r.photo.octets);
      prises += 1;
      journal(`photo ${prises} (${state}, ${Math.floor(etat.status.progress * 1000) / 10} %, ${r.photo.taille} octets)`);
    } else {
      journal(`pas de photo : ${r.raison}`);
    }
  }
  if (prises >= max) {
    journal(`${max} photos : arrêt`);
    break;
  }
  await new Promise((r) => setTimeout(r, minutes * 60_000));
}
