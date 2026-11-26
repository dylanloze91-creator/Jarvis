/**
 * Banc de la recherche des cotes sur Internet, en vrai et avec un compteur (nuit du 26 au 27 novembre).
 *
 *   npm run banc:cotes-web --workspace @jarvis/desktop
 *
 * La nuit du 25 au 26, les moteurs de recherche ont bloqué ce PC après des passages répétés. Ce banc
 * ne peut pas recommencer : chaque recherche est **comptée** dans un fichier du jour (20 au plus par
 * défaut, tous lancements confondus) et **espacée** de la précédente (60 s par défaut). Le compte
 * atteint, la recherche est refusée et le banc le dit.
 *
 * Pour chaque produit : la vraie étape `chercherCotes` (celle de l'atelier), les vrais moteurs de
 * recherche, les vraies pages, les vrais plans (DXF, PDF) et le vrai modèle local (Ollama). Rien
 * n'est écrit dans le dossier de l'atelier : le résultat va dans le dossier du banc.
 *
 * La carte graphique est partagée : chaque appel au modèle prend la réservation locale
 * (`C:\dev\jarvis-data\coordination\gpu.json`, règle du 26 novembre) et la rend aussitôt.
 *
 * Variables :
 *   JARVIS_COTES_CLE        clé Tavily (jamais écrite ni affichée) ; absente : les moteurs sans clé
 *   JARVIS_COTES_PRODUITS   « composant=produit;composant=produit » (défaut : les quatre ci-dessous)
 *   JARVIS_COTES_MAX        recherches au plus pour la journée (défaut 20)
 *   JARVIS_COTES_ESPACE_S   secondes entre deux recherches (défaut 60)
 *   JARVIS_COTES_DIR        dossier des résultats (défaut C:\dev\jarvis-data\atelier-nuit)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getVersion: () => 'banc', isPackaged: false },
  shell: {},
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { rechercheCotesPC } = await import('./atelierPC.js');
const { chercherCotes } = await import('./chercherCotes.js');

const DIR = process.env.JARVIS_COTES_DIR ?? 'C:\\dev\\jarvis-data\\atelier-nuit';
const MAX = Number(process.env.JARVIS_COTES_MAX ?? 20);
const ESPACE_MS = Number(process.env.JARVIS_COTES_ESPACE_S ?? 60) * 1000;
const CLE = process.env.JARVIS_COTES_CLE?.trim() ?? '';
const GPU = 'C:\\dev\\jarvis-data\\coordination\\gpu.json';

const jour = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const COMPTEUR = join(DIR, `recherches-${jour}.json`);

interface Compteur {
  jour: string;
  max: number;
  recherches: { heure: string; requete: string; fournisseur: string; resultats: number; erreur?: string }[];
}

function lireCompteur(): Compteur {
  try {
    return JSON.parse(readFileSync(COMPTEUR, 'utf8')) as Compteur;
  } catch {
    return { jour, max: MAX, recherches: [] };
  }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Réservation locale de la carte graphique : création exclusive, 10 minutes au plus, rendue après. */
async function avecCarte<T>(pourQuoi: string, travail: () => Promise<T>): Promise<T> {
  mkdirSync(join(GPU, '..'), { recursive: true });
  const fin = Date.now() + 15 * 60_000;
  for (;;) {
    const depuis = new Date();
    const contenu = JSON.stringify({
      etat: 'occupée',
      qui: 'agent Atelier (banc cotes-web)',
      pourQuoi,
      depuis: depuis.toISOString(),
      jusqua: new Date(depuis.getTime() + 5 * 60_000).toISOString(),
      pid: process.pid,
      machine: hostname(),
    });
    try {
      writeFileSync(GPU, contenu, { flag: 'wx' });
      break;
    } catch {
      // Prise : périmée (heure passée, ou processus de ce PC disparu) → retirée ; sinon on attend.
      try {
        const r = JSON.parse(readFileSync(GPU, 'utf8')) as { jusqua?: string; pid?: number; machine?: string };
        const perimee = (r.jusqua && Date.parse(r.jusqua) < Date.now()) || (r.machine === hostname() && typeof r.pid === 'number' && !processusVivant(r.pid));
        if (perimee) rmSync(GPU, { force: true });
      } catch {
        /* en cours d'écriture par l'autre : on attend */
      }
      if (Date.now() > fin) throw new Error('carte graphique occupée depuis plus de 15 minutes');
      await attendre(3000);
    }
  }
  try {
    return await travail();
  } finally {
    try {
      const r = JSON.parse(readFileSync(GPU, 'utf8')) as { pid?: number };
      if (r.pid === process.pid) rmSync(GPU, { force: true });
    } catch {
      /* déjà retirée */
    }
  }
}

function reglages(): ReturnType<typeof core.parseSettings> {
  const raw = JSON.parse(readFileSync(join(process.env.APPDATA ?? '', 'Jarvis Test', 'settings.json'), 'utf8')) as Record<string, unknown>;
  delete raw.developer;
  delete raw.printer;
  raw.debugLogging = false;
  if (CLE) {
    raw.searchProvider = 'tavily';
    raw.searchApiKey = CLE;
  }
  return core.parseSettings(raw);
}

const PRODUITS_DEFAUT = 'esp32_s3_devkitc_1_borniers=ESP32-S3-DevKitC-1;oled_1_3_sh1106=écran OLED 1,3 pouce SH1106 I2C;max98357a=MAX98357A I2S amplifier breakout;inmp441=INMP441 I2S microphone module';

it('recherche des cotes en vrai, comptée et espacée', { timeout: 90 * 60_000 }, async () => {
  mkdirSync(DIR, { recursive: true });
  const settings = reglages();
  const registre = core.createWebSearchRegistry();
  const base = rechercheCotesPC(() => settings, registre);
  const fournisseur = CLE ? 'tavily' : `sans clé (${settings.searchProvider}, puis repli)`;
  let derniere = Math.max(0, ...lireCompteur().recherches.map((r) => Date.parse(r.heure)));

  const deps = {
    ...base,
    chercher: async (requete: string, signal?: AbortSignal): Promise<string[]> => {
      const c = lireCompteur();
      if (c.recherches.length >= MAX) throw new Error(`compte de recherches du jour atteint (${MAX})`);
      const reste = derniere + ESPACE_MS - Date.now();
      if (reste > 0) await attendre(reste);
      derniere = Date.now();
      const ligne: Compteur['recherches'][number] = { heure: new Date().toISOString(), requete, fournisseur, resultats: 0 };
      try {
        let urls: string[];
        if (CLE) {
          // Avec la clé : Tavily seul, sans repli sur les moteurs sans clé (ce sont eux qui bloquent).
          const r = await registre.create({ provider: 'tavily', apiKey: CLE }).search({ query: requete, limit: 6 });
          urls = r.results.map((x) => x.url);
        } else urls = await base.chercher(requete, signal);
        ligne.resultats = urls.length;
        return urls;
      } catch (error) {
        ligne.erreur = core.redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 200);
        throw error;
      } finally {
        const apres = lireCompteur();
        apres.recherches.push(ligne);
        writeFileSync(COMPTEUR, `${JSON.stringify(apres, null, 2)}\n`, 'utf8');
      }
    },
    modele: (systeme: string, demande: string, signal?: AbortSignal) => avecCarte('lecture des cotes d’une page (quelques secondes)', () => base.modele(systeme, demande, signal)),
  };

  const produits = (process.env.JARVIS_COTES_PRODUITS ?? PRODUITS_DEFAUT)
    .split(';')
    .map((x) => x.split('='))
    .filter((x): x is [string, string] => x.length === 2 && Boolean(x[0]) && Boolean(x[1]));
  const sorties: unknown[] = [];
  for (const [id, produit] of produits) {
    const debut = Date.now();
    const etapes: string[] = [];
    const r = await chercherCotes({ composant: id.trim(), produit: produit.trim() }, deps, (a) => etapes.push(`${a.etape} : ${a.message}`));
    const cotes = r.produit?.cotes?.[id.trim()] ?? {};
    const sortie = {
      composant: id.trim(),
      produit: produit.trim(),
      ok: r.ok,
      raison: r.raison,
      secondes: Math.round((Date.now() - debut) / 1000),
      sources: r.sources,
      incertitudes: r.incertitudes,
      avertissements: r.avertissements,
      manquants: r.produit?.manquants ?? [],
      pages: r.produit?.pages ?? [],
      plans: r.produit?.plans ?? [],
      cotes: Object.fromEntries(Object.entries(cotes).map(([champ, lues]) => [champ, { etat: core.etatCoteTrouvee(lues), lues }])),
      etapes,
    };
    sorties.push(sortie);
    console.log(`\n=== ${produit.trim()} (${sortie.secondes} s) ===\n${r.raison}\nSources : ${r.sources.join(' | ') || '—'}\nIncertain : ${r.incertitudes.join(' | ') || '—'}\nManque : ${sortie.manquants.join(', ') || '—'}\nPages : ${sortie.pages.join(' , ') || '—'}\nAvertissements : ${r.avertissements.join(' | ') || '—'}`);
  }
  const compte = lireCompteur();
  const fichier = join(DIR, `cotes-web-${jour}-${new Date().toISOString().slice(11, 16).replace(':', 'h')}.json`);
  writeFileSync(fichier, `${JSON.stringify({ jour, fournisseur, recherchesDuJour: compte.recherches.length, max: MAX, produits: sorties }, null, 2)}\n`, 'utf8');
  console.log(`\nRecherches du jour : ${compte.recherches.length} sur ${MAX} (${fournisseur}). Résultat : ${fichier}`);
  expect(existsSync(fichier)).toBe(true);
});
