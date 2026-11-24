/**
 * Atelier 3D, branchement sur ce PC : dossier de l'atelier, OpenSCAD, OrcaSlicer (copies des
 * préréglages de l'utilisateur), limite de la pièce et imprimante du lot B.
 */
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  assessHtml,
  checkRoverBaseUrl,
  extractReadableText,
  fetchPublicText,
  MoonrakerClient,
  phoneMayStartPrint,
  resolveLocalSummaryModel,
  searchWithFallback,
  webProviderOrder,
  type SearchProviderRegistry,
  type Settings,
  type VolumeImpression,
} from '@jarvis/core';
import { guardUrl } from '../tools/web.js';
import type { DepsChercherCotes } from './chercherCotes.js';
import { preparerPresetsOrca, rendreImage, rendreStl, rendreVues, trancher, trouverOpenscad, trouverOrca } from './programmes.js';
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

/**
 * Recherche des cotes d'un composant sur Internet, branchée sur ce PC : moteurs de recherche de
 * Jarvis (sans clé, avec repli), lecture des pages publiques (mêmes gardes que `fetch_page`), et le
 * modèle local (le cerveau du chef d'orchestre, sinon celui du chat) en JSON, température 0.
 */
export function rechercheCotesPC(getSettings: () => Settings, searchRegistry: SearchProviderRegistry): DepsChercherCotes {
  return {
    chercher: async (query) => {
      const settings = getSettings();
      const config = { provider: settings.searchProvider, apiKey: settings.searchApiKey };
      const r = await searchWithFallback(searchRegistry, webProviderOrder(searchRegistry, config), config, { query, limit: 6 });
      return r.results.map((x) => x.url);
    },
    lire: async (url, signal) => {
      const fetched = await fetchPublicText(url, { timeoutMs: 12_000, maxRedirects: 5, readLimit: 2_000_000, ...(signal ? { signal } : {}), guard: guardUrl });
      if (!fetched.ok) return null;
      const page = extractReadableText(fetched.text, 60_000);
      const a = assessHtml(fetched.text, page.text);
      if (a.antiBot || a.invalidHtml || a.empty || !page.text) return null;
      // Le titre en première ligne : il dit souvent de quelle carte parle la page.
      return page.title ? `${page.title}\n${page.text}` : page.text;
    },
    modele: async (systeme, demande, signal) => {
      const settings = getSettings();
      const local = resolveLocalSummaryModel(settings);
      const model = settings.orchestra?.enabled && settings.orchestra.brain ? settings.orchestra.brain : local.model;
      const res = await fetch(`${local.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: systeme },
            { role: 'user', content: demande },
          ],
          options: { temperature: 0, num_predict: 800, num_ctx: 8192 },
        }),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw new Error(`Ollama a répondu HTTP ${res.status} (${model})`);
      const payload = (await res.json()) as { message?: { content?: string } };
      return payload.message?.content ?? '';
    },
  };
}

export function creerAtelierPC(
  getSettings: () => Settings,
  racine = ATELIER_RACINE,
  racineOrca = ORCA_RACINE,
  searchRegistry?: SearchProviderRegistry,
): (input: AtelierEntree) => Promise<AtelierSortie | null> {
  const dossierOrca = join(racine, '_orca');
  const recherche = searchRegistry ? rechercheCotesPC(getSettings, searchRegistry) : undefined;
  return (input) =>
    tourAtelier(input, {
      racine,
      ...(recherche ? { chercherCotes: recherche } : {}),
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
      telephonePeutLancer: () => phoneMayStartPrint(getSettings().printer),
      imprimante: () => {
        const printer = getSettings().printer;
        if (printer?.enabled !== true || !printer.baseUrl || !checkRoverBaseUrl(printer.baseUrl).ok) return null;
        return new MoonrakerClient(printer.baseUrl, printer.apiKey ?? '');
      },
      programmes: {
        openscad: () => trouverOpenscad(),
        rendreStl,
        rendreImage,
        rendreVues,
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
