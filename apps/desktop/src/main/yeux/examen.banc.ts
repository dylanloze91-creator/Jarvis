/**
 * Banc des yeux sur l'examen de l'utilisateur (yeux, étape 2, point 2), hors de `npm test`.
 * L'examen (`C:\dev\jarvis-data\yeux\examen\examen.json` et ses photos) sert seulement à mesurer,
 * jamais à entraîner. Réserver la carte graphique dans `AGENTS-COORDINATION.md` avant.
 *
 *   npm run banc:examen --workspace @jarvis/desktop
 *
 * Variables : `JARVIS_EXAMEN_DIR` (dossier de l'examen), `JARVIS_EXAMEN_TOUT=1` (passer aussi les
 * questions pas encore validées : leurs notes sont marquées « non validé »), `JARVIS_BANC_PASSAGES`
 * (3 par défaut), `JARVIS_REGARDER_MODELE` (modèle du chat, `qwen2.5:7b` par défaut).
 * Le passage réel : modèle de vision, recherche web vérifiée et modèle du chat, comme dans la fenêtre.
 * Résultats (chiffres et réponses, jamais les photos) : `C:\dev\jarvis-data\yeux\banc\`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { createWebSearchRegistry, MODELE_VISION_PROVISOIRE, parseSettings } from '@jarvis/core';
import { creerRegarder } from './regarder.js';

interface QuestionExamen {
  id: string;
  photo: string;
  image_a_s?: number;
  question: string;
  reponse_attendue: string;
  references_attendues: string[];
  doit_contenir_un_de: string[];
  ne_doit_pas_contenir: string[];
  valide: boolean;
}

const DOSSIER = process.env.JARVIS_EXAMEN_DIR ?? 'C:\\dev\\jarvis-data\\yeux\\examen';
const SORTIE = join(DOSSIER, '..', 'banc');
const TOUT = process.env.JARVIS_EXAMEN_TOUT === '1';
const PASSAGES = Math.max(1, Number(process.env.JARVIS_BANC_PASSAGES ?? 3) || 3);
const OLLAMA = 'http://127.0.0.1:11434';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[\s\-_]/g, '');
const minus = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/**
 * Le mot attendu est-il dit sans négation ? « vide » ne compte pas dans « n'est pas complètement
 * vide » (vu au premier banc : la notation comptait une réponse fausse comme bonne).
 */
export function ditSansNegation(texte: string, mot: string): boolean {
  const t = minus(texte);
  const m = minus(mot);
  for (let i = t.indexOf(m); i >= 0; i = t.indexOf(m, i + 1)) {
    const avant = t.slice(Math.max(0, i - 30), i);
    if (!/\b(?:pas|ne|n'|n’|non|jamais|sans)\b[^.!?]*$/.test(avant)) return true;
  }
  return false;
}

/** Les octets de la photo ; un fichier qui n'est pas une image (vidéo d'une Live Photo) donne une image par ffmpeg. */
function image(q: QuestionExamen): { octets: Uint8Array; type: 'image/jpeg' | 'image/png'; depuisVideo: boolean } {
  const chemin = join(DOSSIER, q.photo);
  const brut = readFileSync(chemin);
  if (brut.length > 3 && brut[0] === 0xff && brut[1] === 0xd8) return { octets: new Uint8Array(brut), type: 'image/jpeg', depuisVideo: false };
  if (brut.length > 3 && brut[0] === 0x89 && brut[1] === 0x50) return { octets: new Uint8Array(brut), type: 'image/png', depuisVideo: false };
  if (!brut.length) throw new Error(`${q.photo} est vide (0 octet)`);
  const jpeg = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(q.image_a_s ?? 0), '-i', chemin, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return { octets: new Uint8Array(jpeg), type: 'image/jpeg', depuisVideo: true };
}

/** Mémoire de la carte : le plus haut relevé par nvidia-smi pendant le passage (Mo), et la part du modèle de vision sur la carte. */
function surveiller() {
  let maxMo = 0;
  let visionVram = 0;
  let visionTotal = 0;
  const tick = () => {
    execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { timeout: 3000 }, (err, out) => {
      if (!err) maxMo = Math.max(maxMo, Number(out.trim().split(/\r?\n/)[0]) || 0);
    });
    void fetch(`${OLLAMA}/api/ps`)
      .then((r) => r.json() as Promise<{ models?: { name: string; size: number; size_vram: number }[] }>)
      .then((p) => {
        const v = p.models?.find((m) => m.name === MODELE_VISION_PROVISOIRE);
        if (v && v.size_vram >= visionVram) {
          visionVram = v.size_vram;
          visionTotal = v.size;
        }
      })
      .catch(() => undefined);
  };
  const minuterie = setInterval(tick, 700);
  tick();
  return {
    fin: () => {
      clearInterval(minuterie);
      return { carteMaxMo: maxMo, visionSurCarteMo: Math.round(visionVram / 1e6), visionTotalMo: Math.round(visionTotal / 1e6) };
    },
  };
}

describe('banc des yeux sur l’examen (essai réel)', () => {
  it(
    'passe chaque question de l’examen',
    async () => {
      const examen = JSON.parse(readFileSync(join(DOSSIER, 'examen.json'), 'utf8')) as { questions: QuestionExamen[] };
      const questions = examen.questions.filter((q) => q.valide || TOUT);
      const settings = parseSettings({ provider: 'ollama', model: process.env.JARVIS_REGARDER_MODELE ?? 'qwen2.5:7b' });
      const regarder = creerRegarder({ getSettings: () => settings, searchRegistry: createWebSearchRegistry() });
      const resultats: Record<string, unknown>[] = [];
      for (let passage = 1; passage <= PASSAGES; passage++) {
        for (const q of questions) {
          const img = image(q);
          const garde = surveiller();
          const debut = Date.now();
          let r: Awaited<ReturnType<typeof regarder>> | null = null;
          let erreur = '';
          try {
            r = await regarder({ photo: { octets: img.octets, type: img.type, prisA: Date.now(), taille: img.octets.byteLength, camera: 'Examen' }, question: q.question, oral: false });
          } catch (e) {
            erreur = e instanceof Error ? e.message : String(e);
          }
          const duree = (Date.now() - debut) / 1000;
          const memoire = garde.fin();
          const texte = r?.texte ?? '';
          const lu = (r?.vision.texteLu ?? []).map(norm);
          const referencesLues = q.references_attendues.filter((ref) => lu.some((t) => t.includes(norm(ref))));
          const tn = norm(texte);
          const fausses = q.ne_doit_pas_contenir.filter((m) => tn.includes(norm(m)));
          const bonne = !erreur && q.doit_contenir_un_de.some((m) => ditSansNegation(texte, m)) && !fausses.length;
          resultats.push({
            passage,
            id: q.id,
            valide: q.valide,
            depuisVideo: img.depuisVideo,
            duree,
            ...memoire,
            bonne,
            referencesAttendues: q.references_attendues.length,
            referencesLues: referencesLues.length,
            faussesSures: fausses,
            erreur,
            vision: r?.vision ?? null,
            recherches: (r?.recherches ?? []).map((x) => ({ reference: x.reference, pages: x.pages.length, faits: x.faits.map((f) => f.fait) })),
            reponse: texte,
          });
          console.log(`[${passage}/${PASSAGES}] ${q.id} : ${bonne ? 'bonne' : 'fausse'}${fausses.length ? ` (fausse sûre : ${fausses.join(', ')})` : ''}, réf. ${referencesLues.length}/${q.references_attendues.length}, ${duree.toFixed(1)} s, carte ${memoire.carteMaxMo} Mo${erreur ? `, erreur : ${erreur}` : ''}`);
        }
      }
      mkdirSync(SORTIE, { recursive: true });
      const nom = `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${MODELE_VISION_PROVISOIRE.replace(/[:/]/g, '-')}`;
      writeFileSync(join(SORTIE, `${nom}.json`), JSON.stringify({ modeleVision: MODELE_VISION_PROVISOIRE, passages: PASSAGES, resultats }, null, 2));
      console.log(`Résultats : ${join(SORTIE, `${nom}.json`)}`);
    },
    3_600_000,
  );
});
