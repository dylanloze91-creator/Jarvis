#!/usr/bin/env node
/**
 * Observe les impressions de l'imprimante (Klipper + Moonraker) pour bâtir la base des yeux :
 * « une impression qui se passe bien ou mal ». OBSERVATION SEULEMENT.
 *
 * - Lecture seule : uniquement des requêtes GET vers Moonraker (état, métadonnées, photo de la caméra).
 *   Aucune commande n'est jamais envoyée à l'imprimante, même si le modèle voit un problème.
 * - Une photo toutes les 10 minutes pendant une impression, une dernière à la fin.
 * - Pour chaque photo : heure, avancement, couche, températures, état de Klipper, et la réponse de
 *   gemma3:4b à la question « L'impression se passe-t-elle bien ? ».
 * - La carte graphique est réservée par un fichier local, C:\dev\jarvis-data\coordination\gpu.json
 *   (règle dans AGENTS-COORDINATION.md), seulement le temps de chaque analyse, puis libérée. Aucun
 *   commit. Si un autre agent l'a réservée (ce fichier, ou la table « Ressource GPU » lue sans rien
 *   écrire), la photo est prise quand même et l'analyse attend que la carte soit libre.
 * - Veille : interroge Moonraker toutes les 30 s ; une seule instance (le port du questionnaire sert
 *   de verrou) ; pause si le fichier veille\pause existe ; lancée avec Windows par installer-veille.ps1.
 * - Au début d'une impression, le G-code est lu (GET) pour savoir si des supports ont été générés.
 * - Fin de l'impression : questionnaire court, servi en local (127.0.0.1) pour le téléphone (Tailscale).
 *   Les étiquettes viennent seulement des réponses de l'utilisateur.
 * - Une impression sur trois (la 1re, la 4e, la 7e…) va à l'examen : jamais à l'entraînement.
 * - Tout reste sous C:\dev\jarvis-data\yeux\impressions, hors du dépôt.
 *
 *   node observer-impressions.mjs [--sans-git] [--port 53190] [--une-fois]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGS = process.argv.slice(2);
const arg = (nom, defaut) => {
  const i = ARGS.indexOf(nom);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : defaut;
};
const MOONRAKER = arg('--imprimante', 'http://mainsailos.local');
const OLLAMA = 'http://127.0.0.1:11434';
const MODELE = 'gemma3:4b';
const QUESTION = "L'impression se passe-t-elle bien ?";
const RACINE = arg('--dossier', 'C:\\dev\\jarvis-data\\yeux\\impressions');
// Copie du dépôt dont on lit (sans jamais rien écrire) la table « Ressource GPU ».
const DEPOT = arg('--depot', 'C:\\dev\\Jarvis');
const PORT = Number(arg('--port', '53190'));
const SANS_GIT = ARGS.includes('--sans-git');
const INTERVALLE_PHOTO_MS = 10 * 60_000;
const TICK_MS = 30_000;
const VEILLE = arg('--veille', join(RACINE, '..', 'veille'));
const FICHIER_PAUSE = join(VEILLE, 'pause');
const FICHIER_PID = join(VEILLE, 'veille.json');
const RESERVATION_GPU = arg('--reservation-gpu', 'C:\\dev\\jarvis-data\\coordination\\gpu.json');
const NOTIFICATION = join(VEILLE, 'notification.json');
const EN_COURS = new Set(['printing', 'paused']);
const FINS = new Set(['complete', 'cancelled', 'error']);
const JOURNAL = join(RACINE, 'observateur.log');

mkdirSync(RACINE, { recursive: true });
mkdirSync(VEILLE, { recursive: true });

function log(msg) {
  const ligne = `[${new Date().toLocaleString('fr-FR')}] ${msg}`;
  console.log(ligne);
  try {
    if (existsSync(JOURNAL) && statSync(JOURNAL).size > 5_000_000) renameSync(JOURNAL, JOURNAL + '.ancien');
    appendFileSync(JOURNAL, ligne + '\n');
  } catch {
    /* rien */
  }
}

function ecrireJson(chemin, valeur) {
  const tmp = chemin + '.tmp';
  writeFileSync(tmp, JSON.stringify(valeur, null, 2));
  renameSync(tmp, chemin);
}
const lireJson = (chemin, defaut = null) => {
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return defaut;
  }
};
const lireLignes = (chemin) =>
  existsSync(chemin)
    ? readFileSync(chemin, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

// ---------------------------------------------------------------- imprimante (GET seulement)

async function lireImprimante(chemin, { binaire = false, delaiMs = 15_000 } = {}) {
  const r = await fetch(MOONRAKER + chemin, { method: 'GET', signal: AbortSignal.timeout(delaiMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} sur ${chemin}`);
  return binaire ? new Uint8Array(await r.arrayBuffer()) : r.json();
}

async function etatImprimante() {
  const objets = 'print_stats&virtual_sdcard&display_status&extruder&heater_bed&webhooks&gcode_move&idle_timeout';
  const r = await lireImprimante(`/printer/objects/query?${objets}`);
  return r.result.status;
}

async function photoCamera() {
  const octets = await lireImprimante('/webcam/?action=snapshot', { binaire: true });
  if (octets.length < 1000 || octets[0] !== 0xff || octets[1] !== 0xd8) throw new Error("la caméra n'a pas rendu un JPEG");
  return octets;
}

async function metadonnees(fichier) {
  try {
    const r = await lireImprimante(`/server/files/metadata?filename=${encodeURIComponent(fichier)}`);
    const m = r.result;
    return {
      hauteurCouche: m.layer_height ?? null,
      premiereCouche: m.first_layer_height ?? null,
      hauteurObjet: m.object_height ?? null,
      dureeEstimeeS: m.estimated_time ?? null,
      trancheur: m.slicer ?? null,
    };
  } catch (e) {
    return { erreur: String(e.message ?? e) };
  }
}

/**
 * Ce que le trancheur a fait, lu dans le G-code (GET seulement) : supports activés et réellement
 * générés (lignes « ;TYPE:Support… »), bordure, radeau, remplissage. Rien n'est deviné.
 */
export function lireTranche(gcode) {
  const reglage = (cle) => {
    const m = gcode.match(new RegExp(`^; ${cle} = (.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  const types = {};
  let couche = 0;
  for (const ligne of gcode.split('\n')) {
    if (ligne.startsWith(';LAYER_CHANGE')) couche++;
    else if (ligne.startsWith(';TYPE:')) {
      const t = ligne.slice(6).trim();
      types[t] ??= { blocs: 0, premiereCouche: couche };
      types[t].blocs++;
    }
  }
  const supports = Object.keys(types).filter((t) => /support/i.test(t));
  const actives = reglage('enable_support') ?? reglage('support_material');
  return {
    trancheur: (gcode.match(/^; generated by (.*)$/m) ?? [])[1]?.trim() ?? null,
    supportsActives: actives == null ? null : actives === '1',
    typeSupports: reglage('support_type'),
    supportsGeneres: supports.length > 0,
    blocsSupports: supports.reduce((n, t) => n + types[t].blocs, 0),
    bordure: types.Brim || types.Skirt ? { type: reglage('brim_type'), largeurMm: Number(reglage('brim_width')) || null } : null,
    radeauCouches: Number(reglage('raft_layers') ?? 0),
    remplissage: reglage('sparse_infill_density') ?? reglage('fill_density'),
    murs: reglage('wall_loops') ?? reglage('perimeters'),
    filament: reglage('filament_type'),
    couches: couche,
    typesExtrusion: types,
  };
}

async function trancheDuFichier(fichier) {
  try {
    const r = await fetch(`${MOONRAKER}/server/files/gcodes/${encodeURIComponent(fichier)}`, { method: 'GET', signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return lireTranche(await r.text());
  } catch (e) {
    return { erreur: String(e.message ?? e) };
  }
}

async function debutTravail(fichier) {
  try {
    const r = await lireImprimante('/server/history/list?limit=3&order=desc');
    const j = r.result.jobs.find((x) => x.filename === fichier);
    return j ? new Date(j.start_time * 1000) : null;
  } catch {
    return null;
  }
}

function releve(s, meta) {
  const ps = s.print_stats ?? {};
  const z = s.gcode_move?.gcode_position?.[2] ?? null;
  let couche = ps.info?.current_layer ?? null;
  let sourceCouche = 'Klipper';
  if (couche == null && z != null && meta?.hauteurCouche && (ps.print_duration ?? 0) > 0) {
    const premiere = meta.premiereCouche ?? meta.hauteurCouche;
    couche = z < premiere * 0.5 ? 0 : 1 + Math.round(Math.max(0, z - premiere) / meta.hauteurCouche);
    sourceCouche = `estimée par la hauteur Z (${meta.hauteurCouche} mm par couche)`;
  }
  let totalCouches = ps.info?.total_layer ?? null;
  if (totalCouches == null && meta?.hauteurObjet && meta?.hauteurCouche) {
    const premiere = meta.premiereCouche ?? meta.hauteurCouche;
    totalCouches = 1 + Math.round((meta.hauteurObjet - premiere) / meta.hauteurCouche);
  }
  // Après la fin, la buse remonte (garage) : la hauteur Z ne dit plus la couche.
  if (sourceCouche !== 'Klipper' && couche != null && (!EN_COURS.has(ps.state) || (totalCouches != null && couche > totalCouches))) {
    couche = null;
  }
  return {
    etatImpression: ps.state ?? null,
    messageImpression: ps.message || null,
    klipper: s.webhooks?.state ?? null,
    messageKlipper: s.webhooks?.state_message ?? null,
    inactivite: s.idle_timeout?.state ?? null,
    avancementFichier: s.virtual_sdcard?.progress != null ? Math.round(s.virtual_sdcard.progress * 1000) / 10 : null,
    dureeImpressionS: ps.print_duration != null ? Math.round(ps.print_duration) : null,
    dureeTotaleS: ps.total_duration != null ? Math.round(ps.total_duration) : null,
    filamentMm: ps.filament_used != null ? Math.round(ps.filament_used) : null,
    z,
    couche,
    totalCouches,
    sourceCouche: couche == null ? null : sourceCouche,
    buse: { temperature: arrondi(s.extruder?.temperature), cible: s.extruder?.target ?? null },
    plateau: { temperature: arrondi(s.heater_bed?.temperature), cible: s.heater_bed?.target ?? null },
  };
}
const arrondi = (v) => (v == null ? null : Math.round(v * 10) / 10);

// ---------------------------------------------------------------- carte graphique (réservation locale)

const SIGNATURE = 'Claude Code (agent Yeux, veille des impressions)';
const firstLine = (e) => String(e?.stderr || e?.message || e).split(/\r?\n/).find(Boolean) ?? '?';
const DUREE_MAX_RESERVATION_MS = 10 * 60_000;

function processusVivant(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Réservation locale en cours (fichier gpu.json), ou null si absente, expirée ou orpheline. */
export function lireReservationLocale(chemin = RESERVATION_GPU, maintenant = Date.now()) {
  const r = lireJson(chemin);
  if (!r || r.etat !== 'occupée') return null;
  if (r.jusqua && Date.parse(r.jusqua) < maintenant) return null;
  if (r.pid && r.machine === hostname() && !processusVivant(r.pid)) return null;
  return r;
}

/** La ligne d'état de la section « Ressource GPU / Ollama » d'un texte du fichier de coordination. */
function ligneGpu(texte) {
  const lignes = texte.split(/\r?\n/);
  const debut = lignes.findIndex((l) => /^##\s+Ressource GPU/.test(l));
  if (debut < 0) return null;
  for (let i = debut + 1; i < lignes.length && !/^##\s/.test(lignes[i]); i++) {
    if (/^\|\s*-{3}/.test(lignes[i])) return { index: i + 1, cellules: lignes[i + 1].split('|').slice(1, -1).map((c) => c.trim()) };
  }
  return null;
}

function git(args, { delaiMs = 60_000 } = {}) {
  return execFileSync('git', args, { cwd: DEPOT, encoding: 'utf8', timeout: delaiMs, stdio: ['ignore', 'pipe', 'pipe'] });
}

let dernierFetch = 0;
/** Quelqu'un d'autre a-t-il réservé la carte ? Fichier local, puis table de coordination (lecture seule). */
function carteOccupeeParAutre() {
  const locale = lireReservationLocale();
  if (locale && !(locale.qui === SIGNATURE && locale.pid === process.pid)) return `${locale.qui} (réservation locale) : ${locale.pourQuoi}`;
  if (SANS_GIT) return null;
  if (Date.now() - dernierFetch > 10 * 60_000) {
    dernierFetch = Date.now();
    try {
      git(['fetch', '-q', 'origin'], { delaiMs: 45_000 });
    } catch (e) {
      log(`git fetch raté (${firstLine(e)}) : je regarde seulement les copies déjà reçues`);
    }
  }
  const textes = [];
  try {
    textes.push(['copie locale', readFileSync(join(DEPOT, 'AGENTS-COORDINATION.md'), 'utf8')]);
  } catch {
    /* rien */
  }
  try {
    const limite = Date.now() / 1000 - 12 * 3600;
    const refs = git(['for-each-ref', '--format=%(refname:short) %(committerdate:unix)', 'refs/remotes/origin'])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split(' '))
      .filter(([ref, t]) => Number(t) >= limite && ref !== 'origin/HEAD');
    for (const [ref] of refs) {
      try {
        textes.push([ref, git(['show', `${ref}:AGENTS-COORDINATION.md`])]);
      } catch {
        /* fichier absent de cette branche */
      }
    }
  } catch (e) {
    log(`lecture des branches ratée : ${firstLine(e)}`);
  }
  for (const [ou, texte] of textes) {
    const l = ligneGpu(texte);
    if (l && /^occup/i.test(l.cellules[0]) && !/agent Yeux/i.test(l.cellules[1]) && !/agent Yeux[^|]*(passe avant|peut charger|quand il en a besoin)|partag\S* avec la veille/i.test(l.cellules[2])) return `${l.cellules[1]} (${ou}) : ${l.cellules[2]}`;
  }
  return null;
}

/** Réserve la carte par création exclusive du fichier local. Rend false si quelqu'un l'a déjà. */
export function reserverCarte(pourQuoi, chemin = RESERVATION_GPU) {
  mkdirSync(dirname(chemin), { recursive: true });
  const maintenant = Date.now();
  const contenu = JSON.stringify(
    { etat: 'occupée', qui: SIGNATURE, pourQuoi, depuis: new Date(maintenant).toISOString(), jusqua: new Date(maintenant + DUREE_MAX_RESERVATION_MS).toISOString(), pid: process.pid, machine: hostname() },
    null,
    2,
  );
  for (let essai = 0; essai < 2; essai++) {
    try {
      writeFileSync(chemin, contenu, { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (lireReservationLocale(chemin)) return false;
      try {
        unlinkSync(chemin); // réservation expirée ou orpheline
      } catch {
        /* déjà retirée */
      }
    }
  }
  return false;
}

export function libererCarte(chemin = RESERVATION_GPU) {
  const r = lireJson(chemin);
  if (r && r.qui === SIGNATURE && r.pid === process.pid) unlinkSync(chemin);
}

// ---------------------------------------------------------------- modèle

async function demanderAuModele(jpeg) {
  const debut = Date.now();
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODELE,
      stream: false,
      keep_alive: 0,
      messages: [{ role: 'user', content: QUESTION, images: [Buffer.from(jpeg).toString('base64')] }],
      options: { temperature: 0, num_ctx: 4096, num_predict: 400 },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status} : ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return { reponse: (j.message?.content ?? '').trim(), dureeS: Math.round((Date.now() - debut) / 100) / 10, chargementS: j.load_duration ? Math.round(j.load_duration / 1e8) / 10 : null };
}

/**
 * Lecture du verdict du modèle par règles fixes (ce n'est pas une étiquette de la photo : c'est ce
 * que le modèle a dit). « alerte », « ok » ou « incertain ».
 */
export function verdictModele(texte) {
  let t = (texte ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/’/g, "'");
  // La question répétée (« … si l'impression se passe bien ») et les conditions (« il faudrait voir
  // si … sans défauts ») ne sont pas un avis.
  t = t.replace(/\bsi (l'impression|elle|tout) se passe bien/g, ' ').replace(/\b(il faudrait|faudrait|il faut|pour determiner|pour savoir)[^.]*\./g, ' ');
  const prudent = /\b(difficile|impossible) (de|a) (dire|determiner|juger|savoir|evaluer)|je ne peux pas (dire|determiner|juger)|pas possible de (dire|determiner)/.test(t);
  t = t
    .replace(/\b(aucun|aucune|pas de|pas d'|sans|ni)\s+(signe[s]? (de |d')?|trace[s]? (de |d')?|)?(probleme|defaut|anomalie|souci|erreur|decollement|spaghetti|fil|warping)s?/g, ' RAS ')
    .replace(/\b(ne semble|ne parait|n'a l'air) pas (y avoir|presenter|avoir) (de |d')?(probleme|defaut|anomalie|souci)s?/g, ' RAS ');
  const alerte =
    /\b(ne se passe pas bien|se passe mal|pas bien|probleme|defaut|anomalie|souci|spaghetti|decoll|warping|gauchi|decal|sous[- ]?extrusion|filaments? qui pend|fils? d'ange|stringing|rate|echou|echec|inquiet|preoccup|mauvais)/.test(t);
  const ok = /\b(se passe bien|semble bien|bonne voie|correctement|normal|bien parti|tout va bien|oui\b|bonne qualite|propre|RAS)/i.test(t);
  // Une réponse prudente n'est « ok » que si elle conclut clairement.
  const conclutBien = /\b(probable|semble|parait|en conclusion|globalement)[^.]{0,40}(se passe(r)? bien|se deroule(r)? bien|correctement)|tout va bien/.test(t);
  if (alerte) return 'alerte';
  if (prudent && !conclutBien) return 'incertain';
  if (ok) return 'ok';
  return 'incertain';
}

// ---------------------------------------------------------------- lumière de la photo

/**
 * Image trop sombre pour juger : la moitié des pixels (photo réduite à 160 × 120, en gris) sous ce
 * niveau (0 à 255). Fixé le 26 novembre sur les photos de la caméra de Klipper : la nuit, la médiane
 * est entre 16 et 33 ; le soir, avec la lampe, entre 44 et 104.
 */
export const SEUIL_TROP_SOMBRE = 40;
export const PHRASE_TROP_SOMBRE = 'image trop sombre, je ne peux pas juger';

/** Médiane et moyenne du gris de la photo, par ffmpeg (lecture seule). `null` si ffmpeg manque. */
export function lumierePhoto(chemin) {
  try {
    const brut = execFileSync('ffmpeg', ['-v', 'error', '-i', chemin, '-vf', 'scale=160:120,format=gray', '-f', 'rawvideo', '-'], {
      maxBuffer: 1 << 20,
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (!brut.length) return null;
    const tri = Uint8Array.from(brut).sort();
    let somme = 0;
    for (const v of tri) somme += v;
    return { mediane: tri[Math.floor((tri.length - 1) / 2)], moyenne: Math.round(somme / tri.length) };
  } catch {
    return null;
  }
}

export const tropSombre = (lumiere) => lumiere != null && lumiere.mediane < SEUIL_TROP_SOMBRE;

/** Verdict d'une photo : « trop-sombre » d'abord (sans juger), sinon ce que le modèle a dit. */
export function verdictPhoto(entree) {
  if (tropSombre(entree.lumiere)) return 'trop-sombre';
  return entree.modele?.etat === 'fait' ? verdictModele(entree.modele.reponse) : null;
}

// ---------------------------------------------------------------- impressions (dossiers)

const nomPropre = (fichier) =>
  fichier
    .replace(/\.gcode$/i, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 70);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const horodatage = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;

function dossiersImpressions() {
  return readdirSync(RACINE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(RACINE, d.name, 'impression.json')))
    .map((d) => d.name)
    .sort();
}

function impressionOuverte(fichier) {
  for (const nom of dossiersImpressions().reverse()) {
    const imp = lireJson(join(RACINE, nom, 'impression.json'));
    if (imp && imp.etat === 'en-cours' && imp.fichier === fichier) return nom;
  }
  return null;
}

async function ouvrirImpression(fichier) {
  const existante = impressionOuverte(fichier);
  if (existante) {
    const chemin = join(RACINE, existante, 'impression.json');
    const imp = lireJson(chemin);
    if (imp && !imp.tranche) {
      imp.tranche = await trancheDuFichier(fichier);
      ecrireJson(chemin, imp);
      log(`${existante} : ${decrireSupports(imp.tranche)}`);
    }
    return existante;
  }
  const rang = dossiersImpressions().length; // 0 pour la toute première
  const debut = (await debutTravail(fichier)) ?? new Date();
  const nom = `${horodatage(debut)}_${nomPropre(fichier)}`;
  mkdirSync(join(RACINE, nom, 'photos'), { recursive: true });
  const meta = await metadonnees(fichier);
  const tranche = await trancheDuFichier(fichier);
  ecrireJson(join(RACINE, nom, 'impression.json'), {
    fichier,
    debut: debut.toISOString(),
    etat: 'en-cours',
    jeu: rang % 3 === 0 ? 'examen' : 'entrainement',
    regleDuJeu:
      "Choisi au début de l'impression, avant toute étiquette : une impression sur trois (la 1re, la 4e, la 7e…) va à l'examen. Les photos d'examen servent seulement à mesurer, jamais à entraîner.",
    meta,
    tranche,
    modele: MODELE,
    question: QUESTION,
    intervalleMin: INTERVALLE_PHOTO_MS / 60_000,
  });
  log(`nouvelle impression observée : ${nom} (${rang % 3 === 0 ? 'examen' : 'entraînement'}) — ${decrireSupports(tranche)}`);
  return nom;
}

export function decrireSupports(t) {
  if (!t || t.erreur) return `supports : G-code illisible (${t?.erreur ?? '?'})`;
  if (t.supportsGeneres) return `supports générés (${t.blocsSupports} blocs${t.typeSupports ? `, ${t.typeSupports}` : ''})`;
  if (t.supportsActives) return 'supports activés dans le trancheur, mais aucun généré';
  return 'sans supports';
}

async function prendrePhoto(nomImp, etat, { derniere = false } = {}) {
  const dossier = join(RACINE, nomImp);
  const imp = lireJson(join(dossier, 'impression.json'));
  const photos = lireLignes(join(dossier, 'journal.jsonl'));
  const n = photos.length + 1;
  const maintenant = new Date();
  const nomPhoto = `photo-${pad(n, 3)}_${pad(maintenant.getHours())}-${pad(maintenant.getMinutes())}${derniere ? '_fin' : ''}.jpg`;
  let erreurPhoto = null;
  let lumiere = null;
  try {
    const jpeg = await photoCamera();
    writeFileSync(join(dossier, 'photos', nomPhoto), jpeg);
    lumiere = lumierePhoto(join(dossier, 'photos', nomPhoto));
  } catch (e) {
    erreurPhoto = String(e.message ?? e);
  }
  const entree = {
    n,
    photo: erreurPhoto ? null : nomPhoto,
    erreurPhoto,
    heure: maintenant.toISOString(),
    derniere,
    lumiere,
    ...releve(etat, imp.meta),
    modele: erreurPhoto ? null : { etat: 'en-attente' },
  };
  appendFileSync(join(dossier, 'journal.jsonl'), JSON.stringify(entree) + '\n');
  log(
    `${nomImp} : photo ${n}${derniere ? ' (fin)' : ''} — ${entree.etatImpression}, ${entree.avancementFichier ?? '?'} %, couche ${entree.couche ?? '?'}/${entree.totalCouches ?? '?'}, buse ${entree.buse.temperature} °C, plateau ${entree.plateau.temperature} °C${erreurPhoto ? `, PHOTO RATÉE : ${erreurPhoto}` : ''}`,
  );
}

function reecrireJournal(dossier, entrees) {
  const chemin = join(dossier, 'journal.jsonl');
  writeFileSync(chemin + '.tmp', entrees.map((e) => JSON.stringify(e)).join('\n') + '\n');
  renameSync(chemin + '.tmp', chemin);
}

let analyseEnCours = false;
let ollamaAbsentDit = false;
let derniereAttente = null;
async function ollamaRepond() {
  try {
    return (await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(5_000) })).ok;
  } catch {
    return false;
  }
}
/** Analyse les photos en attente, une réservation de la carte par photo. */
async function analyserEnAttente() {
  if (analyseEnCours) return;
  analyseEnCours = true;
  try {
    for (const nom of dossiersImpressions()) {
      const dossier = join(RACINE, nom);
      for (;;) {
        const entrees = lireLignes(join(dossier, 'journal.jsonl'));
        const e = entrees.find((x) => x.modele?.etat === 'en-attente');
        if (!e) break;
        if (!(await ollamaRepond())) {
          if (!ollamaAbsentDit) log("Ollama ne répond pas : l'analyse attend");
          ollamaAbsentDit = true;
          return;
        }
        ollamaAbsentDit = false;
        const autre = carteOccupeeParAutre();
        if (autre) {
          if (autre !== derniereAttente) log(`carte graphique prise par ${autre} : l'analyse de la photo ${e.n} attend`);
          derniereAttente = autre;
          return;
        }
        derniereAttente = null;
        const pourQuoi = `observation de l’impression « ${nom} » : photo ${e.n} regardée par ${MODELE}, quelques secondes`;
        if (!reserverCarte(pourQuoi)) return;
        const reservee = true;
        let resultat;
        try {
          const jpeg = readFileSync(join(dossier, 'photos', e.photo));
          const r = await demanderAuModele(jpeg);
          resultat = { etat: 'fait', nom: MODELE, question: QUESTION, reponse: r.reponse, verdictLu: tropSombre(e.lumiere) ? 'trop-sombre' : verdictModele(r.reponse), verdictModeleSeul: verdictModele(r.reponse), dureeS: r.dureeS, chargementS: r.chargementS, a: new Date().toISOString(), reservationLocale: reservee };
        } catch (err) {
          resultat = { etat: 'erreur', nom: MODELE, question: QUESTION, erreur: String(err.message ?? err), a: new Date().toISOString(), essais: (e.modele?.essais ?? 0) + 1 };
        } finally {
          try {
            libererCarte();
          } catch (err) {
            log(`libération de la carte ratée : ${firstLine(err)}`);
          }
        }
        // relire au cas où une photo a été ajoutée pendant l'analyse
        const a_jour = lireLignes(join(dossier, 'journal.jsonl')).map((x) => (x.n === e.n ? { ...x, modele: resultat.etat === 'erreur' && resultat.essais < 3 ? { ...resultat, etat: 'en-attente' } : resultat } : x));
        reecrireJournal(dossier, a_jour);
        log(`${nom} : photo ${e.n} → ${resultat.etat === 'fait' ? `${resultat.verdictLu === 'trop-sombre' ? `${PHRASE_TROP_SOMBRE} (médiane ${e.lumiere.mediane}/255 ; le modèle disait : ${resultat.verdictModeleSeul})` : resultat.verdictLu} (${resultat.dureeS} s) « ${resultat.reponse.slice(0, 140).replace(/\s+/g, ' ')}… »` : `erreur : ${resultat.erreur}`}`);
        if (resultat.etat === 'erreur') return;
      }
    }
  } finally {
    analyseEnCours = false;
  }
}

// ---------------------------------------------------------------- boucle

let dernierePhotoA = 0;
let joignableDepuis = true;
async function tick() {
  let etat;
  try {
    etat = await etatImprimante();
    if (!joignableDepuis) log("l'imprimante répond de nouveau");
    joignableDepuis = true;
  } catch (e) {
    if (joignableDepuis) log(`imprimante injoignable : ${e.message ?? e}`);
    joignableDepuis = false;
    await analyserEnAttente();
    return;
  }
  const ps = etat.print_stats ?? {};
  // fermer les impressions en cours qui ne sont plus celles de Klipper
  for (const nom of dossiersImpressions()) {
    const chemin = join(RACINE, nom, 'impression.json');
    const imp = lireJson(chemin);
    if (imp?.etat !== 'en-cours') continue;
    const memeTravail = imp.fichier === ps.filename && EN_COURS.has(ps.state);
    if (memeTravail) continue;
    const fini = imp.fichier !== ps.filename || FINS.has(ps.state) || ps.state === 'standby';
    if (!fini) continue;
    await prendrePhoto(nom, etat, { derniere: true });
    imp.etat = 'finie';
    imp.fin = new Date().toISOString();
    imp.etatFinal = imp.fichier === ps.filename ? ps.state : 'inconnu (une autre impression a commencé)';
    imp.messageFinal = ps.message || null;
    ecrireJson(chemin, imp);
    log(`${nom} : impression terminée (${imp.etatFinal}). Questionnaire : http://127.0.0.1:${PORT}/q/${encodeURIComponent(nom)}`);
    await prevenir(nom, imp);
    dernierePhotoA = 0;
  }
  if (EN_COURS.has(ps.state) && ps.filename) {
    const nom = await ouvrirImpression(ps.filename);
    const photos = lireLignes(join(RACINE, nom, 'journal.jsonl'));
    const derniere = photos.length ? Date.parse(photos[photos.length - 1].heure) : 0;
    if (Date.now() - Math.max(derniere, dernierePhotoA) >= INTERVALLE_PHOTO_MS - 5_000) {
      dernierePhotoA = Date.now();
      await prendrePhoto(nom, etat);
    }
  }
  await analyserEnAttente();
}

/**
 * Prévenir que le questionnaire est prêt. Seulement si veille\notification.json existe
 * ({ "ntfy": "https://ntfy.sh/<sujet>", "lien": "https://<pc>.<tailnet>.ts.net:8444" }).
 * Le message contient seulement « Questionnaire prêt » et un lien neutre (/questionnaire, qui mène au
 * dernier questionnaire à remplir) : ni le nom du fichier d'impression, ni le nom du dossier. Le lien
 * ne s'ouvre que sur le tailnet de l'utilisateur.
 */
export function messageNotification(base) {
  const lien = `${String(base).replace(/\/+$/, '')}/questionnaire`;
  return { lien, corps: `Questionnaire prêt\n${lien}` };
}

async function prevenir(nom, imp) {
  const reglage = lireJson(NOTIFICATION);
  writeFileSync(join(VEILLE, 'dernier-questionnaire.txt'), `${imp.fichier}\r\nhttp://127.0.0.1:${PORT}/q/${encodeURIComponent(nom)}\r\n`);
  if (!reglage?.ntfy || !/^https:\/\//.test(reglage.ntfy) || !reglage.lien) return;
  const { lien, corps } = messageNotification(reglage.lien);
  try {
    const r = await fetch(reglage.ntfy, {
      method: 'POST',
      headers: { Click: lien, 'content-type': 'text/plain; charset=utf-8' },
      body: corps,
      signal: AbortSignal.timeout(15_000),
    });
    log(`notification envoyée (${r.status})`);
  } catch (e) {
    log(`notification ratée : ${e.message ?? e}`);
  }
}

// ---------------------------------------------------------------- questionnaire (téléphone)

const DEFAUTS = ['décollement', 'spaghetti', 'couches décalées', 'fils', 'sous-extrusion', 'autre'];

function hoteAccepte(host) {
  const h = String(host ?? '').replace(/:\d+$/, '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(h);
}
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nomValide = (nom) => typeof nom === 'string' && /^[A-Za-z0-9._-]+$/.test(nom) && dossiersImpressions().includes(nom);

const CSS = `body{font:16px/1.4 -apple-system,system-ui,sans-serif;margin:0;padding:12px;background:#0d1117;color:#e6edf3}
h1{font-size:20px}h2{font-size:17px;margin-top:24px}a{color:#58a6ff}.carte{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px;margin:10px 0}
label{display:block;padding:8px 4px}input[type=text],textarea{width:100%;box-sizing:border-box;font-size:16px;padding:8px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px}
img{width:100%;border-radius:6px;display:block}.photo{margin:14px 0;padding:8px;border:2px solid #30363d;border-radius:10px}.photo.choisie{border-color:#f85149}
.info{color:#8b949e;font-size:14px}button{font-size:18px;padding:12px 18px;border-radius:8px;border:0;background:#238636;color:#fff;width:100%;margin:18px 0}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #30363d;padding:4px;text-align:left}`;

const JS = `const f=document.getElementById('f');
function maj(){const def=f.querySelector('input[name=defaut]:checked');const oui=def&&def.value==='oui';document.getElementById('types').style.display=oui?'block':'none';document.getElementById('quand').style.display=oui?'block':'none';
document.querySelectorAll('.photo').forEach(p=>p.classList.toggle('choisie',!!p.querySelector('input:checked')));}
f.addEventListener('change',maj);maj();
f.addEventListener('submit',async e=>{e.preventDefault();const d=new FormData(f);
const corps={reussie:d.get('reussie'),defaut:d.get('defaut'),types:d.getAll('types'),autre:d.get('autre')||'',premiere:d.get('premiere'),tient:d.get('tient'),supports:d.get('supports'),remarque:d.get('remarque')||''};
if(!corps.reussie||!corps.defaut){alert('Réponds aux deux premières questions.');return;}
if(corps.defaut==='oui'&&!corps.types.length){alert('Coche au moins un défaut.');return;}
if(corps.defaut==='oui'&&!corps.premiere){alert('Choisis la première photo où le défaut se voit (ou « sur aucune photo »).');return;}
const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(corps)});
if(r.ok){location.href=location.pathname+'/resultat';}else{alert('Erreur : '+await r.text());}});`;

function page(titre, corps) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${echapper(titre)}</title><link rel="stylesheet" href="/style.css"></head><body>${corps}</body></html>`;
}

function pageIndex() {
  const lignes = dossiersImpressions()
    .reverse()
    .map((nom) => {
      const imp = lireJson(join(RACINE, nom, 'impression.json'));
      const n = lireLignes(join(RACINE, nom, 'journal.jsonl')).length;
      const repondu = existsSync(join(RACINE, nom, 'reponses.json'));
      const lien = imp.etat === 'finie' ? `<a href="/q/${encodeURIComponent(nom)}">${repondu ? 'Voir / corriger mes réponses' : 'Remplir le questionnaire'}</a>${repondu ? ` · <a href="/q/${encodeURIComponent(nom)}/resultat">résultat</a>` : ''}` : 'en cours';
      return `<div class="carte"><b>${echapper(imp.fichier)}</b><div class="info">${echapper(new Date(imp.debut).toLocaleString('fr-FR'))} · ${n} photos · ${imp.jeu === 'examen' ? 'examen' : 'entraînement'}</div>${lien}</div>`;
    })
    .join('');
  return page('Impressions observées', `<h1>Impressions observées</h1>${lignes || '<p>Aucune impression pour l’instant.</p>'}`);
}

function pageQuestionnaire(nom) {
  const imp = lireJson(join(RACINE, nom, 'impression.json'));
  const photos = lireLignes(join(RACINE, nom, 'journal.jsonl')).filter((p) => p.photo);
  const rep = lireJson(join(RACINE, nom, 'reponses.json'), {});
  const coche = (cond) => (cond ? ' checked' : '');
  const radios = (champ, valeurs) => valeurs.map(([v, l]) => `<label><input type="radio" name="${champ}" value="${v}"${coche(rep[champ] === v)}> ${l}</label>`).join('');
  const listePhotos = photos
    .map(
      (p) =>
        `<div class="photo"><img loading="lazy" src="/photo/${encodeURIComponent(nom)}/${encodeURIComponent(p.photo)}" alt="photo ${p.n}"><div class="info">Photo ${p.n}${p.derniere ? ' (fin)' : ''} · ${new Date(p.heure).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${p.avancementFichier ?? '?'} % · couche ${p.couche ?? '?'}${p.totalCouches ? '/' + p.totalCouches : ''}</div><label><input type="radio" name="premiere" value="${p.n}"${coche(String(rep.premiere) === String(p.n))}> Le défaut se voit pour la première fois ici</label></div>`,
    )
    .join('');
  const corps = `<h1>Ton impression</h1><div class="info">${echapper(imp.fichier)}<br>${echapper(new Date(imp.debut).toLocaleString('fr-FR'))} → ${echapper(imp.fin ? new Date(imp.fin).toLocaleString('fr-FR') : '…')} · fin : ${echapper(imp.etatFinal ?? '?')} · ${photos.length} photos</div>
<form id="f"><div class="carte"><h2>1. L’impression est-elle réussie dans l’ensemble ?</h2>${radios('reussie', [['oui', 'Oui'], ['en-partie', 'En partie'], ['non', 'Non']])}</div>
<div class="carte"><h2>2. Y a-t-il eu un défaut ?</h2>${radios('defaut', [['non', 'Non, aucun'], ['oui', 'Oui']])}
<div id="types">${DEFAUTS.map((d) => `<label><input type="checkbox" name="types" value="${d}"${coche((rep.types ?? []).includes(d))}> ${d}</label>`).join('')}<input type="text" name="autre" placeholder="Si « autre » : lequel ?" value="${echapper(rep.autre ?? '')}"></div></div>
<div class="carte" id="quand"><h2>3. À partir de quand ?</h2><p class="info">Les photos sont dans l’ordre. Choisis la première où le défaut se voit.</p>
<label><input type="radio" name="premiere" value="aucune"${coche(rep.premiere === 'aucune')}> Le défaut ne se voit sur aucune photo</label>${listePhotos}</div>
<div class="carte"><h2>4. La pièce tient-elle ?</h2><p class="info">Solide, elle fait ce qu’on attend d’elle.</p>${radios('tient', [['oui', 'Oui, solide'], ['fragile', 'Elle tient, mais fragile'], ['non', 'Non (cassée, couches qui se séparent…)'], ['pas-essaye', 'Pas encore essayée']])}</div>
${imp.tranche?.supportsGeneres ? `<div class="carte"><h2>5. Les supports</h2><p class="info">Le trancheur en a généré (${imp.tranche.blocsSupports} blocs).</p>${radios('supports', [['bien', 'Retirés sans souci'], ['difficile', 'Difficiles à retirer'], ['abime', 'Ont abîmé la pièce'], ['pas-retire', 'Pas encore retirés']])}</div>` : `<div class="carte info">Supports : ${echapper(decrireSupports(imp.tranche))}.</div>`}
<div class="carte"><h2>Une remarque ? (facultatif)</h2><textarea name="remarque" rows="3">${echapper(rep.remarque ?? '')}</textarea></div>
<button type="submit">Enregistrer</button></form><script src="/app.js"></script>`;
  return page('Questionnaire', corps);
}

/** Étiquettes : seulement à partir des réponses de l'utilisateur. */
function etiqueter(nom, rep) {
  const photos = lireLignes(join(RACINE, nom, 'journal.jsonl')).filter((p) => p.photo);
  const types = rep.types.map((t) => (t === 'autre' && rep.autre ? `autre (${rep.autre})` : t));
  const premiere = rep.defaut === 'oui' && rep.premiere !== 'aucune' ? Number(rep.premiere) : null;
  return photos.map((p) => ({
    n: p.n,
    photo: p.photo,
    etiquette: premiere != null && p.n >= premiere ? `défaut : ${types.join(', ')}` : 'bonne',
    ...(rep.defaut === 'oui' && rep.premiere === 'aucune' ? { remarque: 'défaut signalé, mais visible sur aucune photo' } : {}),
  }));
}

function comparer(nom) {
  const etiquettes = lireJson(join(RACINE, nom, 'etiquettes.json'))?.photos ?? [];
  const journal = new Map(lireLignes(join(RACINE, nom, 'journal.jsonl')).map((p) => [p.n, p]));
  const c = { photos: 0, bonnesReponses: 0, faussesAlertes: 0, defautsManques: 0, incertains: 0, tropSombres: 0, nonAnalysees: 0, details: [] };
  for (const e of etiquettes) {
    const entree = journal.get(e.n);
    const brut = entree?.modele;
    // Verdict relu à chaque comparaison : une règle corrigée vaut aussi pour les photos déjà prises.
    const m = brut?.etat === 'fait' ? { ...brut, verdictLu: verdictPhoto(entree) } : brut;
    const defaut = e.etiquette !== 'bonne';
    let resultat;
    if (!m || m.etat !== 'fait') {
      c.nonAnalysees++;
      resultat = 'non analysée';
    } else if (m.verdictLu === 'trop-sombre') {
      c.tropSombres++;
      resultat = 'trop sombre pour juger';
    } else if (m.verdictLu === 'incertain') {
      c.incertains++;
      resultat = 'incertain';
    } else if ((m.verdictLu === 'alerte') === defaut) {
      c.bonnesReponses++;
      resultat = 'bonne réponse';
    } else if (m.verdictLu === 'alerte') {
      c.faussesAlertes++;
      resultat = 'fausse alerte';
    } else {
      c.defautsManques++;
      resultat = 'défaut manqué';
    }
    c.photos++;
    c.details.push({ n: e.n, etiquette: e.etiquette, verdictModele: m?.verdictLu ?? null, resultat, reponseModele: m?.reponse ?? null });
  }
  return c;
}

function pageResultat(nom) {
  const imp = lireJson(join(RACINE, nom, 'impression.json'));
  const c = comparer(nom);
  const lignes = c.details
    .map((d) => `<tr><td>${d.n}</td><td>${echapper(d.etiquette)}</td><td>${echapper(d.verdictModele ?? '—')}</td><td>${echapper(d.resultat)}</td></tr>`)
    .join('');
  const corps = `<h1>Résultat</h1><div class="info">${echapper(imp.fichier)} · ${imp.jeu === 'examen' ? 'examen' : 'entraînement'}</div>
<div class="carte">Photos étiquetées : <b>${c.photos}</b><br>Bonnes réponses de ${MODELE} : <b>${c.bonnesReponses}</b><br>Fausses alertes : <b>${c.faussesAlertes}</b><br>Défauts manqués : <b>${c.defautsManques}</b><br>Réponses incertaines : <b>${c.incertains}</b><br>Images trop sombres pour juger : <b>${c.tropSombres}</b>${c.nonAnalysees ? `<br>Non analysées : <b>${c.nonAnalysees}</b>` : ''}</div>
<p class="info">Le verdict du modèle est lu dans sa réponse par des règles fixes (alerte, ok, incertain). Les étiquettes viennent de tes réponses seulement.</p>
<table><tr><th>Photo</th><th>Ton étiquette</th><th>Modèle</th><th>Résultat</th></tr>${lignes}</table><p><a href="/q/${encodeURIComponent(nom)}">Corriger mes réponses</a> · <a href="/">Toutes les impressions</a></p>`;
  return page('Résultat', corps);
}

function ecrireBilan() {
  const lignes = ['# Bilan des yeux sur les impressions', '', `Modèle : ${MODELE}. Question : « ${QUESTION} ». Étiquettes : réponses de l'utilisateur seulement. Une photo dont la médiane du gris est sous ${SEUIL_TROP_SOMBRE}/255 est « ${PHRASE_TROP_SOMBRE} ».`, ''];
  for (const jeu of ['examen', 'entrainement']) {
    const tot = { impressions: 0, photos: 0, bonnesReponses: 0, faussesAlertes: 0, defautsManques: 0, incertains: 0, tropSombres: 0, nonAnalysees: 0 };
    for (const nom of dossiersImpressions()) {
      const imp = lireJson(join(RACINE, nom, 'impression.json'));
      if (imp.jeu !== jeu || !existsSync(join(RACINE, nom, 'etiquettes.json'))) continue;
      const c = comparer(nom);
      tot.impressions++;
      for (const k of Object.keys(tot)) if (k !== 'impressions') tot[k] += c[k];
    }
    lignes.push(`## ${jeu === 'examen' ? 'Examen (jamais pour l’entraînement)' : 'Entraînement'}`, '', `| Impressions | Photos | Bonnes réponses | Fausses alertes | Défauts manqués | Incertains | Trop sombres | Non analysées |`, '| --- | --- | --- | --- | --- | --- | --- | --- |', `| ${tot.impressions} | ${tot.photos} | ${tot.bonnesReponses} | ${tot.faussesAlertes} | ${tot.defautsManques} | ${tot.incertains} | ${tot.tropSombres} | ${tot.nonAnalysees} |`, '');
  }
  writeFileSync(join(RACINE, 'bilan.md'), lignes.join('\n'));
}

function lireCorps(req, max = 16_000) {
  return new Promise((ok, ko) => {
    let t = '';
    req.on('data', (c) => {
      t += c;
      if (t.length > max) {
        ko(new Error('trop long'));
        req.destroy();
      }
    });
    req.on('end', () => ok(t));
    req.on('error', ko);
  });
}

function validerReponses(r) {
  if (!r || typeof r !== 'object') throw new Error('réponse illisible');
  if (!['oui', 'en-partie', 'non'].includes(r.reussie)) throw new Error('question 1 sans réponse');
  if (!['oui', 'non'].includes(r.defaut)) throw new Error('question 2 sans réponse');
  const types = Array.isArray(r.types) ? r.types.filter((t) => DEFAUTS.includes(t)) : [];
  if (r.defaut === 'oui' && !types.length) throw new Error('aucun défaut coché');
  const premiere = r.defaut === 'oui' ? (r.premiere === 'aucune' ? 'aucune' : Number(r.premiere)) : null;
  if (r.defaut === 'oui' && premiere !== 'aucune' && !(Number.isInteger(premiere) && premiere > 0)) throw new Error('première photo manquante');
  const tient = ['oui', 'fragile', 'non', 'pas-essaye'].includes(r.tient) ? r.tient : null;
  const supports = ['bien', 'difficile', 'abime', 'pas-retire'].includes(r.supports) ? r.supports : null;
  return { reussie: r.reussie, defaut: r.defaut, types: r.defaut === 'oui' ? types : [], autre: String(r.autre ?? '').slice(0, 200), premiere, tient, supports, remarque: String(r.remarque ?? '').slice(0, 1000), a: new Date().toISOString() };
}

const serveur = createServer(async (req, res) => {
  const envoyer = (code, type, corps) => {
    res.writeHead(code, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'",
    });
    res.end(corps);
  };
  try {
    if (!hoteAccepte(req.headers.host)) return envoyer(403, 'text/plain; charset=utf-8', 'hôte refusé');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method === 'GET' && url.pathname === '/') return envoyer(200, 'text/html; charset=utf-8', pageIndex());
    if (req.method === 'GET' && url.pathname === '/questionnaire') {
      // Le dernier questionnaire pas encore rempli, sinon la liste.
      const aRemplir = dossiersImpressions()
        .reverse()
        .find((nom) => lireJson(join(RACINE, nom, 'impression.json'))?.etat === 'finie' && !existsSync(join(RACINE, nom, 'reponses.json')));
      res.writeHead(302, { location: aRemplir ? `/q/${encodeURIComponent(aRemplir)}` : '/', 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/style.css') return envoyer(200, 'text/css; charset=utf-8', CSS);
    if (req.method === 'GET' && url.pathname === '/app.js') return envoyer(200, 'text/javascript; charset=utf-8', JS);
    if (req.method === 'GET' && parts[0] === 'photo' && parts.length === 3 && nomValide(parts[1]) && /^photo-\d{3}_[\d-]+(_fin)?\.jpg$/.test(parts[2])) {
      const chemin = join(RACINE, parts[1], 'photos', parts[2]);
      if (!existsSync(chemin)) return envoyer(404, 'text/plain', 'absente');
      return envoyer(200, 'image/jpeg', readFileSync(chemin));
    }
    if (parts[0] === 'q' && nomValide(parts[1])) {
      const nom = parts[1];
      const imp = lireJson(join(RACINE, nom, 'impression.json'));
      if (imp.etat !== 'finie') return envoyer(409, 'text/plain; charset=utf-8', 'impression pas encore finie');
      if (req.method === 'GET' && parts.length === 2) return envoyer(200, 'text/html; charset=utf-8', pageQuestionnaire(nom));
      if (req.method === 'GET' && parts.length === 3 && parts[2] === 'resultat') return envoyer(200, 'text/html; charset=utf-8', pageResultat(nom));
      if (req.method === 'POST' && parts.length === 2) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return envoyer(415, 'text/plain', 'JSON seulement');
        const rep = validerReponses(JSON.parse(await lireCorps(req)));
        ecrireJson(join(RACINE, nom, 'reponses.json'), rep);
        ecrireJson(join(RACINE, nom, 'etiquettes.json'), { source: "réponses de l'utilisateur au questionnaire", a: rep.a, jeu: imp.jeu, piece: { tient: rep.tient, supports: rep.supports }, photos: etiqueter(nom, rep) });
        const c = comparer(nom);
        ecrireJson(join(RACINE, nom, 'resultat.json'), { modele: MODELE, question: QUESTION, ...c });
        ecrireBilan();
        log(`${nom} : questionnaire rempli — ${c.bonnesReponses} bonnes réponses, ${c.faussesAlertes} fausses alertes, ${c.defautsManques} défauts manqués, ${c.incertains} incertains`);
        return envoyer(200, 'application/json', '{"ok":true}');
      }
    }
    envoyer(404, 'text/plain; charset=utf-8', 'introuvable');
  } catch (e) {
    envoyer(400, 'text/plain; charset=utf-8', String(e.message ?? e));
  }
});

// ---------------------------------------------------------------- démarrage

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(join(RACINE, 'LISEZMOI.txt'))) {
    writeFileSync(
      join(RACINE, 'LISEZMOI.txt'),
      [
        'Impressions observées par les yeux de Jarvis (observation seulement, rien n’est envoyé à l’imprimante).',
        'Un dossier par impression : impression.json, photos/, journal.jsonl (une ligne par photo : heure, avancement, couche, températures, état de Klipper, réponse de gemma3:4b).',
        'etiquettes.json : écrit seulement à partir des réponses de l’utilisateur au questionnaire (reponses.json). Jamais par le modèle ni par un agent.',
        'jeu = "examen" : ces photos servent seulement à mesurer, jamais à entraîner.',
        'Rien de ce dossier ne va dans le dépôt.',
      ].join('\r\n'),
    );
  }
  // Photos prises avant la règle « trop sombre » : lumière mesurée une fois, bilans refaits.
  serveur.once('listening', () => {
    try {
      let mesurees = 0;
      for (const nom of dossiersImpressions()) {
        const dossier = join(RACINE, nom);
        const entrees = lireLignes(join(dossier, 'journal.jsonl'));
        if (!entrees.some((x) => x.photo && x.lumiere === undefined)) continue;
        const a_jour = entrees.map((x) => (x.photo && x.lumiere === undefined ? (mesurees++, { ...x, lumiere: lumierePhoto(join(dossier, 'photos', x.photo)) }) : x));
        reecrireJournal(dossier, a_jour);
        if (existsSync(join(dossier, 'etiquettes.json'))) ecrireJson(join(dossier, 'resultat.json'), { modele: MODELE, question: QUESTION, ...comparer(nom) });
      }
      if (mesurees) {
        ecrireBilan();
        log(`lumière mesurée sur ${mesurees} photos déjà prises (règle « trop sombre », seuil ${SEUIL_TROP_SOMBRE}/255)`);
      }
    } catch (e) {
      log(`mesure de la lumière des anciennes photos ratée : ${e.message ?? e}`);
    }
  });
  serveur.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log(`une veille tourne déjà (port ${PORT} pris) : celle-ci s'arrête`);
      process.exit(0);
    }
    log(`serveur du questionnaire en erreur : ${e.message}`);
  });
  serveur.listen(PORT, '127.0.0.1', () => {
    writeFileSync(FICHIER_PID, JSON.stringify({ pid: process.pid, depuis: new Date().toISOString(), port: PORT, script: fileURLToPath(import.meta.url) }, null, 2));
    log(`questionnaire servi sur http://127.0.0.1:${PORT}/ (téléphone : tailscale serve)`);
    log(`veille lancée (pid ${process.pid}, imprimante ${MOONRAKER}, ${MODELE}, relevé toutes les ${TICK_MS / 1000} s, une photo toutes les ${INTERVALLE_PHOTO_MS / 60_000} min, réservation de la carte : ${RESERVATION_GPU})`);
    void boucle();
  });
  const fermer = () => {
    try {
      libererCarte();
    } catch {
      /* rien */
    }
    process.exit(0);
  };
  process.on('SIGINT', fermer);
  process.on('SIGTERM', fermer);
  let enPause = false;
  const boucle = async () => {
    try {
      if (existsSync(FICHIER_PAUSE)) {
        if (!enPause) log(`veille en pause (fichier ${FICHIER_PAUSE})`);
        enPause = true;
      } else {
        if (enPause) log('veille reprise');
        enPause = false;
        await tick();
      }
    } catch (e) {
      log(`erreur : ${e.stack ?? e}`);
    }
    if (ARGS.includes('--une-fois')) {
      serveur.close();
      return;
    }
    setTimeout(boucle, TICK_MS);
  };
}
