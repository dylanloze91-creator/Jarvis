/**
 * Les yeux, étape 2, point 1 (`docs/specs/yeux-etape-2.md`) : une photo et une question sur
 * n'importe quel sujet (électronique, composant, câblage, soudure, objet…).
 *
 * Principe : **le petit modèle de vision regarde, des outils et des règles font le reste.**
 * 1. Le modèle de vision (provisoirement `gemma3:4b`) décrit l'image, recopie le texte visible et
 *    donne une première réponse, avec ses doutes.
 * 2. Les références lues sur l'image (« MAX98357A », « ESP32-S3-WROOM-1 ») partent en recherche web,
 *    comme les cotes de l'atelier : le modèle local propose un fait **avec la phrase exacte de la
 *    page**, Jarvis retrouve cette phrase dans la page, sur une page qui nomme la référence, et
 *    retrouve dans la phrase chaque nombre du fait. Sinon le fait est jeté, jamais deviné. Deux sites
 *    qui disent la même chose : fait confirmé ; un seul : « d'après tel site ».
 * 3. Le modèle du chat écrit la réponse à partir de tout ça, en disant d'où vient chaque chose et ce
 *    qui reste incertain. Une valeur « vue » n'est jamais sûre ; une analyse n'est jamais une raison
 *    d'agir seule (rien n'est mis sous tension, rien n'est commandé ni lancé).
 *
 * Partie pure : consignes, lecture des réponses, références, vérification. Les appels (Ollama,
 * recherche, pages) sont dans `apps/desktop/src/main/yeux/regarder.ts`.
 */
import { looksLikeImageIntent } from '../images/intent.js';

/** Modèle de vision choisi provisoirement (étape 2, point 1), en attendant le banc sur l'examen de l'utilisateur. */
export const MODELE_VISION_PROVISOIRE = 'gemma3:4b';

/** Question par défaut quand la photo arrive sans texte. */
export const QUESTION_PAR_DEFAUT = "Qu'est-ce que tu vois sur cette photo ?";

/** Références cherchées sur Internet au plus, et faits gardés par référence. */
export const REFERENCES_MAX = 2;
export const FAITS_PAR_REFERENCE = 8;

function sansAccents(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Une photo jointe avec ce texte est-elle pour les yeux ? Oui, sauf une demande d'image (« fais-en
 * un sticker », « transforme-la en dessin animé ») : celle-là reste à Jarvis Imager.
 */
export function photoPourLesYeux(texte: string): boolean {
  const t = sansAccents(texte);
  if (looksLikeImageIntent(texte)) return false;
  return !/\b(?:transforme|retouche|refais|redessine|stylise|convertis|agrandis|fais[- ]en|en style|en version|version (?:anime|manga|cartoon|dessin)|sticker|logo|miniature)\b/.test(t);
}

/** Consigne du modèle de vision : décrire, recopier le texte, répondre, douter. JSON demandé. */
export function consigneVision(): string {
  return [
    "Tu es les yeux de Jarvis, l'assistant de l'utilisateur. On te montre une photo et on te pose une question.",
    'Réponds en français, en JSON seulement, avec ces clés :',
    '{"description": "ce que tu vois, en 2 à 4 phrases", "texte_lu": ["chaque texte visible recopié exactement, caractère par caractère : références de puces, sérigraphie de la carte, étiquettes, valeurs"], "reponse": "ta réponse à la question", "doutes": ["ce dont tu n\'es pas sûr"]}',
    "Règles : ne recopie dans texte_lu que ce que tu lis vraiment sur l'image, jamais une référence devinée ; une lettre illisible = « ? ».",
    "Une tension, un courant ou une valeur que tu crois voir n'est jamais sûre : dis-le dans doutes.",
    'Si la photo est floue, sombre ou trop loin, dis-le.',
  ].join('\n');
}

export function demandeVision(question: string): string {
  return `Question de l'utilisateur : ${question.trim() || QUESTION_PAR_DEFAUT}`;
}

/** Ce que le modèle de vision a rendu, lu sans faire confiance. */
export interface LectureVision {
  description: string;
  texteLu: string[];
  reponse: string;
  doutes: string[];
  /** Vrai si la réponse n'était pas le JSON demandé (texte brut gardé comme description). */
  brute: boolean;
}

function texteDe(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

function listeDe(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(texteDe).filter(Boolean).slice(0, 30);
  const s = texteDe(v);
  return s ? s.split(/\s*[;\n]\s*/).filter(Boolean).slice(0, 30) : [];
}

function premierObjet(texte: string): Record<string, unknown> | null {
  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  try {
    const v: unknown = JSON.parse(texte.slice(debut, fin + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Lit la réponse du modèle de vision ; un texte qui n'est pas du JSON devient la description. */
export function lireReponseVision(brut: string): LectureVision {
  const o = premierObjet(brut);
  if (!o) {
    const texte = brut.replace(/```(?:json)?/g, '').trim().slice(0, 2000);
    return { description: texte, texteLu: [], reponse: '', doutes: [], brute: true };
  }
  const cle = (...noms: string[]) => noms.map((n) => o[n]).find((v) => v !== undefined);
  return {
    description: texteDe(cle('description', 'vu', 'ce_que_je_vois')).slice(0, 2000),
    texteLu: listeDe(cle('texte_lu', 'texteLu', 'texte', 'text', 'ocr')),
    reponse: texteDe(cle('reponse', 'réponse', 'answer')).slice(0, 2000),
    doutes: listeDe(cle('doutes', 'doute', 'incertitudes', 'doubts')),
    brute: false,
  };
}

/** Une valeur ou une unité, pas une référence (« 100uF », « 3V3 », « 5V », « 10K », « 12:30 »). */
const VALEUR =
  /^(?:\d+(?:[.,]\d+)?\s*(?:v|mv|kv|a|ma|ua|µa|f|uf|µf|nf|pf|mf|k|m|r|ohms?|Ω|kΩ|mΩ|hz|khz|mhz|ghz|w|mw|kw|mah|ah|mm|cm|m|g|kg|s|ms|%|°c?|db|bit|bits|go|mo|ko|gb|mb|kb|v\d+)|\d+v\d+|\d+[rkm]\d+|\d{1,2}[:h]\d{2}|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})$/i;
/** Mots écrits sur les cartes qui ne sont pas des références. */
const PAS_REFERENCE = new Set(['gnd', 'vcc', 'vin', 'vdd', 'vss', 'rst', 'reset', 'boot', 'usb', 'tx', 'rx', 'sda', 'scl', 'sck', 'ws', 'lrc', 'bclk', 'din', 'dout', 'en', 'io0', 'mosi', 'miso', 'cs', 'pwm', 'adc', 'led', 'pwr', 'usb-c', 'type-c', 'ce', 'rohs', 'fcc', 'made', 'china']);

/**
 * Les références à chercher dans un texte lu : un mot avec au moins une lettre et un chiffre, de 4 à
 * 40 caractères (« MAX98357A », « ESP32-S3-WROOM-1 », « NE555 », « INMP441 »), qui n'est ni une
 * valeur ni une broche. Dans l'ordre de lecture, sans doublon.
 */
export function referencesLues(textes: readonly string[], max = REFERENCES_MAX): string[] {
  const vues = new Set<string>();
  const refs: string[] = [];
  for (const t of textes) {
    for (const brut of t.split(/[\s,;:()[\]{}«»"'|]+/)) {
      const mot = brut.replace(/^[-_./+]+|[-_./+]+$/g, '');
      if (mot.length < 4 || mot.length > 40) continue;
      if (!/[a-z]/i.test(mot) || !/\d/.test(mot)) continue;
      if (/\?/.test(mot)) continue;
      if (VALEUR.test(mot) || PAS_REFERENCE.has(mot.toLowerCase())) continue;
      // Une broche (« GPIO12 », « IO8 », « D4 », « A0 »), pas une pièce.
      if (/^(?:gpio|io|d|a|p|pin|pa|pb|pc)\d{1,3}$/i.test(mot)) continue;
      const cle = mot.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cle.length < 4 || vues.has(cle)) continue;
      // « MAX98357 » et « MAX98357A » : la même pièce, on garde la plus complète, à sa place.
      const proche = [...vues].find((v) => v.includes(cle) || cle.includes(v));
      if (proche) {
        if (cle.length > proche.length) {
          vues.delete(proche);
          vues.add(cle);
          refs[refs.findIndex((r) => r.toLowerCase().replace(/[^a-z0-9]/g, '') === proche)] = mot;
        }
        continue;
      }
      vues.add(cle);
      refs.push(mot);
    }
  }
  return refs.slice(0, max);
}

/** Requêtes de recherche pour une référence (2 au plus). */
export function requetesReference(reference: string): string[] {
  return [`${reference} datasheet`, `${reference} pinout`];
}

function comparable(s: string): string {
  return sansAccents(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

function compacte(s: string): string {
  return sansAccents(s).replace(/[^a-z0-9]+/g, '');
}

/** La page nomme-t-elle cette référence (lettres et chiffres, sans tirets ni espaces) ? */
export function pageDeLaReference(texte: string, reference: string): boolean {
  const ref = compacte(reference);
  return ref.length >= 4 && compacte(texte).includes(ref);
}

/** Les passages d'une page autour des mentions de la référence (4 000 caractères au plus). */
export function passagesDeLaReference(texte: string, reference: string, max = 4000): string {
  const lignes = texte.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ref = compacte(reference);
  const garder = new Set<number>();
  lignes.forEach((l, i) => {
    if (compacte(l).includes(ref)) for (let j = Math.max(0, i - 2); j <= Math.min(lignes.length - 1, i + 6); j += 1) garder.add(j);
  });
  // Le début de la page (titre, résumé) compte toujours.
  for (let j = 0; j < Math.min(8, lignes.length); j += 1) garder.add(j);
  let out = '';
  for (const i of [...garder].sort((a, b) => a - b)) {
    const l = lignes[i]!;
    if (out.length + l.length + 1 > max) break;
    out += `${l}\n`;
  }
  return out.trim();
}

/** Consigne du modèle qui lit une page pour une référence. */
export function consigneFaits(): string {
  return [
    "Tu lis une page web pour un composant électronique. Tu relèves des faits utiles à l'utilisateur pour sa question : ce que c'est, sa tension d'alimentation, le rôle de chaque broche, ses limites.",
    'Réponds en JSON seulement : {"faits": [{"fait": "le fait en une phrase courte, en français", "extrait": "la phrase de la page, recopiée EXACTEMENT, mot pour mot, dans sa langue"}]}',
    "Règles : 6 faits au plus ; un fait par broche quand la page les décrit ; chaque nombre du fait doit être écrit dans l'extrait ; aucun fait sans extrait ; si la page ne parle pas de ce composant, renvoie {\"faits\": []}.",
  ].join('\n');
}

export function demandeFaits(reference: string, question: string, url: string, passages: string): string {
  return `Composant : ${reference}\nQuestion de l'utilisateur : ${question}\nPage : ${url}\n\nTexte de la page :\n${passages}`;
}

export interface FaitPropose {
  fait: string;
  extrait: string;
}

export function lireReponseFaits(brut: string): FaitPropose[] {
  const o = premierObjet(brut);
  const liste = o && Array.isArray(o.faits) ? o.faits : o && Array.isArray(o.facts) ? o.facts : [];
  const out: FaitPropose[] = [];
  for (const x of liste as unknown[]) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const fait = texteDe(r.fait ?? r.fact).slice(0, 300);
    const extrait = texteDe(r.extrait ?? r.excerpt ?? r.quote).slice(0, 500);
    if (fait && extrait) out.push({ fait, extrait });
  }
  return out.slice(0, 8);
}

function nombres(s: string): string[] {
  return (s.replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

/**
 * Le fait tient-il ? Raison du refus, ou `null`. L'extrait doit être dans la page (au moins 20
 * caractères), sur une page qui nomme la référence, et chaque nombre du fait doit être dans l'extrait.
 * Sur une page qui parle de plusieurs pièces, la ligne de l'extrait (ou l'une des deux d'avant) doit
 * nommer la référence, sauf si la page la nomme dès ses premières lignes.
 */
export function verifierFait(texte: string, reference: string, f: FaitPropose): string | null {
  const e = comparable(f.extrait);
  if (e.length < 20) return 'extrait trop court';
  if (!pageDeLaReference(texte, reference)) return 'la page ne nomme pas la référence';
  const lignes = texte.split(/\r?\n/);
  const pageEntiere = comparable(texte);
  if (!pageEntiere.includes(e)) return "extrait introuvable dans la page";
  const dansExtrait = new Set(nombres(f.extrait));
  const manque = nombres(f.fait).find((n) => !dansExtrait.has(n));
  if (manque) return `le nombre ${manque} n'est pas dans l'extrait`;
  if (pageDeLaReference(lignes.slice(0, 3).join(' ').slice(0, 400), reference)) return null;
  // La ligne où l'extrait commence (il peut s'étendre sur les suivantes) : ses 30 premiers caractères.
  const debut = e.slice(0, 30);
  for (let i = 0; i < lignes.length; i += 1) {
    if (!comparable(lignes[i]!).length) continue;
    // Le début de l'extrait est dans les lignes à partir de i, mais pas à partir de i + 1 : il commence ligne i.
    const depuisIci = comparable(lignes.slice(i, i + 3).join(' ')).includes(debut);
    const depuisSuivante = comparable(lignes.slice(i + 1, i + 3).join(' ')).includes(debut);
    if (!depuisIci || depuisSuivante) continue;
    const fenetre = lignes.slice(Math.max(0, i - 2), i + 1).join(' ');
    if (pageDeLaReference(fenetre, reference)) return null;
  }
  return "l'extrait ne parle pas de cette référence";
}

/** Un fait gardé, avec ses sources (adresses des pages, une par site). */
export interface FaitVerifie {
  reference: string;
  fait: string;
  sources: string[];
}

/** Le site d'une adresse (« www.analog.com » → « analog.com »). */
export function siteDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function origine(f: FaitVerifie): string {
  const sites = [...new Set(f.sources.map(siteDe))];
  return sites.length > 1 ? `confirmé par ${sites.join(' et ')}` : `d'après ${sites[0]}`;
}

/** Les mots d'un fait, réduits à leurs 5 premières lettres (« alimente », « alimentation » → « alime »). */
function mots(s: string): Set<string> {
  return new Set(
    comparable(s)
      .split(' ')
      .filter((m) => m.length >= 3 && !/^\d+$/.test(m))
      .map((m) => m.slice(0, 5)),
  );
}

/** Deux faits qui disent la même chose : mêmes nombres et la moitié des mots en commun. */
export function memeFait(a: string, b: string): boolean {
  const na = nombres(a).sort().join(' ');
  const nb = nombres(b).sort().join(' ');
  if (na !== nb) return false;
  const ma = mots(a);
  const mb = mots(b);
  if (!ma.size || !mb.size) return false;
  let communs = 0;
  for (const m of ma) if (mb.has(m)) communs += 1;
  return communs / Math.min(ma.size, mb.size) >= 0.5;
}

/** Ajoute un fait vérifié : un fait déjà vu sur un autre site gagne une source (confirmé). */
export function ajouterFait(faits: FaitVerifie[], reference: string, fait: string, url: string): FaitVerifie[] {
  const deja = faits.find((f) => f.reference === reference && memeFait(f.fait, fait));
  if (deja) {
    // Une seule source par site : deux pages du même site ne « confirment » rien.
    if (!deja.sources.some((s) => siteDe(s) === siteDe(url))) deja.sources.push(url);
    return faits;
  }
  if (faits.filter((f) => f.reference === reference).length >= FAITS_PAR_REFERENCE) return faits;
  return [...faits, { reference, fait, sources: [url] }];
}

/** Ce que la recherche a donné pour une référence. */
export interface RechercheReference {
  reference: string;
  pages: string[];
  faits: FaitVerifie[];
  avertissements: string[];
}

/** La question touche-t-elle au branchement ou à l'alimentation ? Le rappel de sécurité est alors ajouté. */
export function questionElectrique(texte: string): boolean {
  return /\b(?:c[aâ]bl|branch|soud|tension|aliment|alim\b|volt|courant|court[- ]circuit|polarit|broche|pin|gnd|masse|sous tension|allum)/i.test(
    texte,
  );
}

export const RAPPEL_SECURITE =
  'Avant de mettre sous tension, vérifie toi-même (au multimètre si besoin) : sur une photo, je peux me tromper.';

/** Consigne du modèle du chat qui écrit la réponse finale. */
export function consigneReponseYeux(oral: boolean): string {
  return [
    "Tu es Jarvis. L'utilisateur t'a montré une photo et t'a posé une question. Tu n'as pas vu la photo toi-même : tu as ce que les yeux (un petit modèle de vision) y ont vu, et ce que la recherche web a vérifié.",
    'Écris la réponse en français, en tutoyant (« tu », jamais « vous »), comme on parle.',
    'Dis d\'où vient chaque chose : « sur la photo, je vois… », « d\'après <site>… ». Ce qui vient seulement des yeux reste prudent : ils peuvent se tromper.',
    "N'invente rien : aucune référence, aucune valeur, aucun brochage qui ne soit pas dans ce qu'on te donne.",
    "Broches : tu peux citer les noms lus sur la photo, mais tu ne donnes le rôle d'une broche (alimentation, horloge, données…) que si un fait vérifié de la recherche le dit ; sinon écris « rôle à vérifier dans la fiche ». Ne dis jamais sur quelle broche de l'autre carte brancher si rien ne le dit.",
    "Une tension ou une valeur « vue » n'est jamais sûre : dis quoi mesurer et comment.",
    "Ne dis jamais qu'un câblage est bon au point de pouvoir le mettre sous tension sans vérifier ; ne propose aucune action (commande, impression, achat) sans que l'utilisateur la demande.",
    'Termine par tes doutes, en une phrase, s\'il y en a.',
    oral ? 'Réponse courte : trois phrases au plus, sans liste.' : 'Réponse courte : 4 à 8 phrases, une petite liste si elle aide.',
  ].join('\n');
}

export function demandeReponseYeux(input: { question: string; vision: LectureVision; recherches: RechercheReference[] }): string {
  const v = input.vision;
  const parties = [
    `Question : ${input.question}`,
    `Ce que les yeux voient : ${v.description || '(rien de clair)'}`,
    v.texteLu.length ? `Texte lu sur la photo : ${v.texteLu.join(' ; ')}` : 'Texte lu sur la photo : aucun',
    v.reponse ? `Première réponse des yeux : ${v.reponse}` : '',
    v.doutes.length ? `Doutes des yeux : ${v.doutes.join(' ; ')}` : '',
  ];
  for (const r of input.recherches) {
    if (!r.faits.length) {
      parties.push(`Recherche web pour « ${r.reference} » : rien de vérifié (${r.pages.length} page(s) lue(s)).`);
      continue;
    }
    parties.push(`Recherche web pour « ${r.reference} » (faits vérifiés sur la page) :`);
    for (const f of r.faits) parties.push(`- ${f.fait} (${origine(f)})`);
  }
  return parties.filter(Boolean).join('\n');
}

/** Les sources citées sous la réponse (liste Markdown), dans l'ordre. */
export function sourcesYeux(recherches: readonly RechercheReference[]): string[] {
  const out: string[] = [];
  for (const r of recherches) for (const f of r.faits) for (const s of f.sources) if (!out.includes(s)) out.push(s);
  return out;
}

/**
 * Réponse sans le modèle du chat (absent, en panne) : ce que les yeux ont vu et répondu, puis les
 * faits vérifiés, chacun avec sa source. Rien d'autre n'est ajouté.
 */
export function reponseYeuxSansModele(input: { vision: LectureVision; recherches: RechercheReference[] }): string {
  const v = input.vision;
  const lignes: string[] = [];
  if (v.reponse) lignes.push(v.reponse);
  if (v.description && v.description !== v.reponse) lignes.push(`Sur la photo, je vois : ${v.description}`);
  if (v.texteLu.length) lignes.push(`Texte lu : ${v.texteLu.join(' ; ')}.`);
  for (const r of input.recherches) {
    for (const f of r.faits) lignes.push(`- ${r.reference} : ${f.fait} (${origine(f)})`);
  }
  if (v.doutes.length) lignes.push(`Mes doutes : ${v.doutes.join(' ; ')}.`);
  return lignes.join('\n') || "Je n'ai rien vu de clair sur cette photo.";
}

/**
 * Assemble la réponse finale : texte du modèle (ou réponse sans modèle), puis les sources web, la
 * mention du modèle de vision, et le rappel de sécurité pour une question électrique.
 */
export function finirReponseYeux(input: {
  texte: string;
  question: string;
  recherches: readonly RechercheReference[];
  modeleVision: string;
  oral: boolean;
}): string {
  const morceaux = [input.texte.trim()];
  if (questionElectrique(input.question) && !input.texte.includes(RAPPEL_SECURITE)) morceaux.push(RAPPEL_SECURITE);
  if (input.oral) return morceaux.join(' ');
  const sources = sourcesYeux(input.recherches);
  if (sources.length) morceaux.push(`Sources :\n${sources.map((s) => `- ${s}`).join('\n')}`);
  morceaux.push(`_Vu par ${input.modeleVision} ; une photo peut tromper._`);
  return morceaux.join('\n\n');
}

/** Les appels de la recherche (moteurs de Jarvis, lecture des pages publiques, modèle local). */
export interface DepsRechercheReference {
  chercher(requete: string, signal?: AbortSignal): Promise<string[]>;
  /** Texte lisible d'une page publique, ou `null` (refusée, illisible, mur anti-robot). */
  lire(url: string, signal?: AbortSignal): Promise<string | null>;
  modele(systeme: string, demande: string, signal?: AbortSignal): Promise<string>;
  maintenant?: () => number;
}

/** Pages lues au plus par référence ; une seule page par site (deux pages d'un site ne confirment rien). */
export const PAGES_PAR_REFERENCE = 3;

/**
 * Cherche une référence lue sur la photo : recherches, pages qui la nomment, faits proposés par le
 * modèle local et vérifiés par Jarvis (`verifierFait`). Arrêt à `fin` (horloge `maintenant`).
 */
export async function chercherReference(
  input: { reference: string; question: string; fin: number },
  deps: DepsRechercheReference,
  avancement: (message: string) => void = () => undefined,
  signal?: AbortSignal,
): Promise<RechercheReference> {
  const maintenant = deps.maintenant ?? Date.now;
  const { reference } = input;
  const pages: string[] = [];
  const avertissements: string[] = [];
  let faits: FaitVerifie[] = [];
  const vues = new Set<string>();
  const sitesLus = new Set<string>();
  const finie = () => Boolean(signal?.aborted) || maintenant() >= input.fin || pages.length >= PAGES_PAR_REFERENCE;
  for (const requete of requetesReference(reference)) {
    if (finie()) break;
    avancement(`Je cherche « ${requete} »…`);
    let urls: string[];
    try {
      urls = (await deps.chercher(requete, signal)).slice(0, 5);
    } catch {
      avertissements.push(`La recherche « ${requete} » n'a pas abouti.`);
      continue;
    }
    for (const url of urls) {
      if (finie()) break;
      const site = siteDe(url);
      if (vues.has(url) || sitesLus.has(site) || /\.pdf(?:$|[?#])/i.test(url)) continue;
      vues.add(url);
      const texte = await deps.lire(url, signal).catch(() => null);
      // Une page qui ne nomme pas la référence parle d'autre chose : elle ne sert pas.
      if (!texte || !pageDeLaReference(texte, reference)) continue;
      sitesLus.add(site);
      pages.push(url);
      avancement(`Je lis ${site}…`);
      let reponse: string;
      try {
        reponse = await deps.modele(consigneFaits(), demandeFaits(reference, input.question, url, passagesDeLaReference(texte, reference)), signal);
      } catch (error) {
        avertissements.push(`Le modèle local n'a pas pu lire ${site} : ${error instanceof Error ? error.message : String(error)}.`);
        continue;
      }
      for (const f of lireReponseFaits(reponse)) {
        if (verifierFait(texte, reference, f) === null) faits = ajouterFait(faits, reference, f.fait, url);
      }
    }
  }
  if (maintenant() >= input.fin) avertissements.push('Recherche arrêtée au bout du temps prévu.');
  return { reference, pages, faits, avertissements };
}
