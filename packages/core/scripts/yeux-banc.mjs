#!/usr/bin/env node
/**
 * Banc des modèles de vision pour les yeux (cahier `docs/specs/yeux-etape-1.md`, § 3.6).
 *
 * Photos de l'utilisateur, sur son PC seulement, rangées par dossier :
 *   en-cours-ok/  ratee/  plateau-vide/  plateau-occupe/
 * Deux questions par photo, réponse en un mot :
 *   - « l'impression se passe bien ? » → OK attendu pour en-cours-ok, PROBLEME pour ratee
 *     (non posée pour plateau-vide) ;
 *   - « le plateau est vide ? » → OUI pour plateau-vide, NON pour tous les autres.
 * Une « fausse alerte » = PROBLEME sur une photo où tout va bien.
 *
 * Manœuvre du module images : les modèles chargés dans Ollama sont déchargés avant le banc
 * (une seule carte de 6 Go), puis rechargés après. Rien n'est téléchargé ici.
 * Sortie : réponses brutes dans `<sortie>/banc-<date>.json` (sur le PC), et les chiffres seuls à l'écran.
 *
 *   node packages/core/scripts/yeux-banc.mjs --dir C:/dev/jarvis-data/yeux/photos-test \
 *        --out C:/dev/jarvis-data/yeux/banc --models qwen2.5vl:3b,gemma3:4b
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (nom, defaut) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
};
const dossier = opt('dir', 'C:/dev/jarvis-data/yeux/photos-test');
const sortie = opt('out', 'C:/dev/jarvis-data/yeux/banc');
const modeles = opt('models', 'qwen2.5vl:3b,gemma3:4b').split(',').map((m) => m.trim()).filter(Boolean);
const ollama = opt('ollama', 'http://127.0.0.1:11434');
const DELAI_MS = 180_000;

const CLASSES = ['en-cours-ok', 'ratee', 'plateau-vide', 'plateau-occupe'];
const QUESTIONS = {
  marche: {
    texte:
      "Voici une photo de la caméra d'une imprimante 3D. L'impression se passe-t-elle bien ? " +
      'Réponds d’abord par un seul mot, OK ou PROBLEME, puis une phrase courte qui dit ce que tu vois.',
    attendu: (classe) => (classe === 'ratee' ? 'PROBLEME' : classe === 'plateau-vide' ? null : 'OK'),
    lire: (texte) => {
      const t = texte.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
      const ok = t.search(/\bOK\b/);
      const pb = t.search(/\bPROBLEMES?\b/);
      if (ok < 0 && pb < 0) return null;
      if (ok < 0) return 'PROBLEME';
      if (pb < 0) return 'OK';
      return ok < pb ? 'OK' : 'PROBLEME';
    },
  },
  vide: {
    texte:
      "Voici une photo de la caméra d'une imprimante 3D. Le plateau d'impression est-il vide (aucune pièce dessus) ? " +
      'Réponds d’abord par un seul mot, OUI ou NON, puis une phrase courte.',
    attendu: (classe) => (classe === 'plateau-vide' ? 'OUI' : 'NON'),
    lire: (texte) => {
      const t = texte.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
      const oui = t.search(/\bOUI\b/);
      const non = t.search(/\bNON\b/);
      if (oui < 0 && non < 0) return null;
      if (oui < 0) return 'NON';
      if (non < 0) return 'OUI';
      return oui < non ? 'OUI' : 'NON';
    },
  },
};

async function json(chemin, corps, delai = DELAI_MS) {
  const r = await fetch(`${ollama}${chemin}`, {
    method: corps ? 'POST' : 'GET',
    headers: corps ? { 'content-type': 'application/json' } : {},
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(delai),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status} : ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const charges = async () => ((await json('/api/ps')).models ?? []).map((m) => ({ name: m.name, vram: m.size_vram ?? 0, size: m.size ?? 0 }));
const decharger = async (nom) => json('/api/generate', { model: nom, keep_alive: 0 }).catch(() => null);

const photos = [];
for (const classe of CLASSES) {
  const fichiers = await readdir(join(dossier, classe)).catch(() => []);
  for (const f of fichiers.filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()) photos.push({ classe, fichier: f });
}
if (photos.length === 0) {
  console.error('Aucune photo.');
  process.exit(2);
}

const avant = await charges();
for (const m of avant) await decharger(m.name);

const resultats = [];
const resume = [];
try {
  for (const modele of modeles) {
    for (const m of await charges()) await decharger(m.name);
    const lignes = [];
    let vram = 0;
    const t0 = Date.now();
    for (const photo of photos) {
      const image = (await readFile(join(dossier, photo.classe, photo.fichier))).toString('base64');
      for (const [id, q] of Object.entries(QUESTIONS)) {
        const attendu = q.attendu(photo.classe);
        if (attendu === null) continue;
        const debut = Date.now();
        let texte = '';
        let erreur = null;
        try {
          const r = await json('/api/chat', {
            model: modele,
            stream: false,
            keep_alive: '10m',
            options: { temperature: 0, num_ctx: 4096, num_predict: 80 },
            messages: [{ role: 'user', content: q.texte, images: [image] }],
          });
          texte = r.message?.content ?? '';
        } catch (e) {
          erreur = e instanceof Error ? e.message : String(e);
        }
        const duree = Date.now() - debut;
        const lu = erreur ? null : q.lire(texte);
        lignes.push({ modele, classe: photo.classe, fichier: photo.fichier, question: id, attendu, lu, juste: lu === attendu, duree, texte, erreur });
        if (vram === 0) vram = (await charges()).find((m) => m.name.startsWith(modele.split(':')[0]))?.vram ?? 0;
        process.stdout.write('.');
      }
    }
    process.stdout.write('\n');
    const chargement = (await charges()).find((m) => m.name.startsWith(modele.split(':')[0]));
    resultats.push(...lignes);
    const parQuestion = {};
    for (const id of Object.keys(QUESTIONS)) {
      const l = lignes.filter((x) => x.question === id);
      parQuestion[id] = {
        justes: l.filter((x) => x.juste).length,
        total: l.length,
        illisibles: l.filter((x) => x.lu === null).length,
        ...(id === 'marche' ? { faussesAlertes: l.filter((x) => x.attendu === 'OK' && x.lu === 'PROBLEME').length, ratesVus: l.filter((x) => x.attendu === 'PROBLEME' && x.lu === 'PROBLEME').length, rates: l.filter((x) => x.attendu === 'PROBLEME').length } : {}),
      };
    }
    const durees = lignes.map((x) => x.duree).sort((a, b) => a - b);
    resume.push({
      modele,
      questions: parQuestion,
      dureeMediane: durees[Math.floor(durees.length / 2)] ?? 0,
      premiereReponse: lignes[0]?.duree ?? 0,
      dureeTotale: Date.now() - t0,
      vramGo: Math.round(((chargement?.vram || vram) / 1e9) * 100) / 100,
      partCarte: chargement && chargement.size ? Math.round((chargement.vram / chargement.size) * 100) : null,
      erreurs: lignes.filter((x) => x.erreur).length,
    });
    await decharger(modele);
  }
} finally {
  // Remettre ce qui tournait avant (le modèle du chat).
  for (const m of avant) await json('/api/generate', { model: m.name, keep_alive: '30m' }, 120_000).catch(() => null);
}

const parClasse = Object.fromEntries(CLASSES.map((c) => [c, photos.filter((p) => p.classe === c).length]));
await mkdir(sortie, { recursive: true });
const date = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(join(sortie, `banc-${date}.json`), JSON.stringify({ date, photos: parClasse, resume, resultats }, null, 2));
console.log(JSON.stringify({ photos: parClasse, resume }, null, 2));
