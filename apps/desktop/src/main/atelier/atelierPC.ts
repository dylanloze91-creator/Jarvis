/**
 * Atelier 3D, branchement sur ce PC : dossier de l'atelier, OpenSCAD, OrcaSlicer (copies des
 * préréglages de l'utilisateur), limite de la pièce et imprimante du lot B.
 */
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { checkRoverBaseUrl, MoonrakerClient, type Settings, type VolumeImpression } from '@jarvis/core';
import { preparerPresetsOrca, rendreImage, rendreStl, trancher, trouverOpenscad, trouverOrca } from './programmes.js';
import { nomSimple, tourAtelier, type AtelierEntree, type AtelierSortie } from './tourAtelier.js';

/** Dossier des pièces (cahier de l'atelier) : hors du dépôt, à côté des autres données de Jarvis. */
export const ATELIER_RACINE = process.platform === 'win32' ? 'C:\\dev\\jarvis-data\\atelier' : join(process.cwd(), 'jarvis-data', 'atelier');

/**
 * Limite quand le préréglage OrcaSlicer ne se lit pas : 250 mm, plus petite que le plateau réel
 * (300 × 300 × 300, confirmé par Klipper et réglé dans OrcaSlicer le 23 novembre). Normalement,
 * la limite est celle du préréglage.
 */
export const LIMITE_PRUDENTE: VolumeImpression = { x: 250, y: 250, z: 250 };

/**
 * Plaque posée sur l'imprimante (choix de l'utilisateur, 23 novembre) : nom attendu par
 * `--curr-bed-type` d'OrcaSlicer. Elle fixe la température du lit lue dans son filament.
 */
export const PLAQUE_ORCA = 'Textured PEI Plate';

/** Préréglages d'OrcaSlicer de l'utilisateur (lus seulement) : `%APPDATA%\OrcaSlicer` de son compte. */
export const ORCA_RACINE = join(homedir(), 'AppData', 'Roaming', 'OrcaSlicer');

export function creerAtelierPC(getSettings: () => Settings, racine = ATELIER_RACINE, racineOrca = ORCA_RACINE): (input: AtelierEntree) => Promise<AtelierSortie | null> {
  const dossierOrca = join(racine, '_orca');
  return (input) =>
    tourAtelier(input, {
      racine,
      jour: () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      },
      volume: async () => {
        try {
          return (await preparerPresetsOrca(dossierOrca, {}, racineOrca)).volume ?? LIMITE_PRUDENTE;
        } catch {
          return LIMITE_PRUDENTE;
        }
      },
      imprimante: () => {
        const printer = getSettings().printer;
        if (printer?.enabled !== true || !printer.baseUrl || !checkRoverBaseUrl(printer.baseUrl).ok) return null;
        return new MoonrakerClient(printer.baseUrl, printer.apiKey ?? '');
      },
      programmes: {
        openscad: () => trouverOpenscad(),
        rendreStl,
        rendreImage,
        trancher: async (stl, sortie) => {
          const orca = trouverOrca();
          if (!orca) return { ok: false, message: "OrcaSlicer n'est pas installé : je ne peux pas préparer le fichier d'impression.", gcode: null, infos: null };
          let copies;
          try {
            copies = await preparerPresetsOrca(dossierOrca, {}, racineOrca);
          } catch (error) {
            const raison = error instanceof Error ? error.message : String(error);
            return { ok: false, message: `Je n'ai pas pu lire tes préréglages OrcaSlicer : ${raison}`, gcode: null, infos: null };
          }
          return trancher(orca, stl, copies, sortie, PLAQUE_ORCA);
        },
      },
    });
}

/**
 * Fichier d'une pièce lu pour la fenêtre (le STL de l'écran 3D). Seulement un nom simple, dans un
 * dossier de pièce, sous le dossier de l'atelier : jamais un autre chemin.
 */
export async function lireFichierAtelier(dossier: string, fichier: string, racine = ATELIER_RACINE): Promise<Uint8Array> {
  if (!nomSimple(dossier) || !nomSimple(fichier) || !/\.(stl|png)$/i.test(fichier)) throw new Error('fichier refusé');
  const base = resolve(racine);
  const chemin = resolve(base, dossier, fichier);
  if (!chemin.startsWith(base + sep)) throw new Error('fichier refusé');
  return new Uint8Array(await readFile(chemin));
}

/** Dossier d'une pièce, pour « Ouvrir le dossier ». `null` si le nom est refusé. */
export function dossierAtelier(dossier: string, racine = ATELIER_RACINE): string | null {
  if (!nomSimple(dossier)) return null;
  return join(resolve(racine), dossier);
}
