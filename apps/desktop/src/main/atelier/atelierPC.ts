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
import { texteDuPdf } from './pdfTexte.js';
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
/** Nom par défaut d'une imprimante sous MainsailOS, sur le réseau local. */
export const ADRESSE_IMPRIMANTE_PAR_DEFAUT = 'http://mainsailos.local';

/**
 * Adresse de l'imprimante de l'atelier, ou `null` (rien n'est envoyé). Jarvis Test : seulement si
 * l'imprimante est activée et son adresse réglée. Jarvis Live : l'adresse réglée, sinon celle par
 * défaut ; `null` seulement si l'utilisateur a décoché l'envoi. Toujours une adresse du réseau local.
 */
export function adresseImprimante(printer: Settings['printer'], live: boolean): string | null {
  const reglee = printer?.baseUrl?.trim() ?? '';
  if (!live) return printer?.enabled === true && reglee && checkRoverBaseUrl(reglee).ok ? reglee : null;
  if (printer?.enabled === false) return null;
  const adresse = reglee || ADRESSE_IMPRIMANTE_PAR_DEFAUT;
  return checkRoverBaseUrl(adresse).ok ? adresse : null;
}

/** Le modèle local a ce temps-là pour lire une page (chargement du modèle compris). */
export const DELAI_LECTURE_MS = 90_000;

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
      return { texte: page.title ? `${page.title}\n${page.text}` : page.text, liens: liensVersPlans(fetched.text, fetched.url ?? url) };
    },
    lirePlan: async (url, signal) => {
      const octets = await telecharger(url, signal);
      if (!octets) return null;
      const debut = Buffer.from(octets.subarray(0, 1024)).toString('latin1');
      if (debut.includes('%PDF')) return { genre: 'pdf', texte: texteDuPdf(octets) };
      // Un DXF est du texte : « 0 SECTION » au début.
      if (/^\s*0\s*\r?\n\s*SECTION/.test(debut)) return { genre: 'dxf', texte: Buffer.from(octets).toString('utf8') };
      return null;
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
        // Jamais sans délai : la nuit du 26 au 27 novembre, une recherche est restée dix minutes sur une
        // seule page (essai en vrai). Au-delà, la page est passée, la recherche continue.
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(DELAI_LECTURE_MS)]) : AbortSignal.timeout(DELAI_LECTURE_MS),
      });
      if (!res.ok) throw new Error(`Ollama a répondu HTTP ${res.status} (${model})`);
      const payload = (await res.json()) as { message?: { content?: string } };
      return payload.message?.content ?? '';
    },
  };
}

/** Les liens d'une page vers un DXF ou un PDF, avec le texte du lien (adresses complètes). */
export function liensVersPlans(html: string, base: string): { url: string; texte: string }[] {
  const out: { url: string; texte: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/\.(?:dxf|pdf)(?:$|\?)/i.test(m[1]!)) continue;
    try {
      const url = new URL(m[1]!.replace(/&amp;/g, '&'), base).toString();
      if (!/^https?:/.test(url) || out.some((x) => x.url === url)) continue;
      out.push({ url, texte: m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) });
    } catch {
      /* adresse illisible : ignorée */
    }
    if (out.length >= 40) break;
  }
  return out;
}

/** Plans lus au plus : 8 Mo, 20 secondes. */
const PLAN_MAX_OCTETS = 8_000_000;

/**
 * Télécharge un plan public (DXF, PDF) : mêmes gardes que `fetch_page` à chaque redirection (pas
 * d'adresse privée), taille et durée bornées. `null` si refusé, trop gros ou en échec.
 */
async function telecharger(url: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  let courant = url;
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), 20_000);
  const surAbandon = () => controle.abort();
  signal?.addEventListener('abort', surAbandon, { once: true });
  try {
    for (let saut = 0; saut <= 5; saut += 1) {
      const garde = await guardUrl(courant);
      if (!garde.allowed) return null;
      const res = await fetch(courant, { redirect: 'manual', signal: controle.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; Jarvis; assistant personnel)' } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location) return null;
        courant = new URL(location, courant).toString();
        continue;
      }
      if (!res.ok || !res.body) return null;
      const annonce = Number(res.headers.get('content-length') ?? 0);
      if (annonce > PLAN_MAX_OCTETS) {
        await res.body.cancel().catch(() => undefined);
        return null;
      }
      const morceaux: Uint8Array[] = [];
      let total = 0;
      const lecteur = res.body.getReader();
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        total += value.length;
        if (total > PLAN_MAX_OCTETS) {
          await lecteur.cancel().catch(() => undefined);
          return null;
        }
        morceaux.push(value);
      }
      return new Uint8Array(Buffer.concat(morceaux));
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
    signal?.removeEventListener('abort', surAbandon);
  }
}

export function creerAtelierPC(
  getSettings: () => Settings,
  racine = ATELIER_RACINE,
  racineOrca = ORCA_RACINE,
  searchRegistry?: SearchProviderRegistry,
  /**
   * `live` (Jarvis Live) : l'atelier marche sans réglage. L'imprimante est jointe à
   * `ADRESSE_IMPRIMANTE_PAR_DEFAUT` tant que rien n'est réglé (décochée dans les réglages : rien
   * n'est envoyé), et l'atelier est le seul à lui parler.
   */
  options: { live?: boolean } = {},
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
      ...(options.live ? { sansAutreImprimante: true } : {}),
      imprimante: () => {
        const printer = getSettings().printer;
        const adresse = adresseImprimante(printer, options.live === true);
        return adresse ? new MoonrakerClient(adresse, printer?.apiKey ?? '') : null;
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
