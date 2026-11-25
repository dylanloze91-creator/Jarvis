/**
 * Atelier 3D : chercher sur Internet les cotes d'un composant qu'on n'a pas en main (demande de
 * l'utilisateur, 24 novembre au soir : « des fois je vais créer des projets sans avoir les
 * composants en physique ; il va chercher les cotes sur Internet quand il en a besoin »).
 *
 * Partie pure : les requêtes, la consigne donnée au modèle qui lit les pages, et surtout la
 * **vérification** de ce qu'il rend. Le modèle ne fait que proposer : chaque cote doit venir avec la
 * phrase exacte de la page, et Jarvis la retrouve dans le texte lu et y retrouve le nombre. Une
 * cote qui ne passe pas est jetée, jamais devinée. Deux sites différents qui concordent : cote sûre ;
 * un seul : cote utilisée mais « à vérifier à réception », avec sa source.
 */
import { composant, type QuestionMesure } from './composants.js';

/** Ce que le modèle doit chercher pour chaque champ, en anglais (les fiches le sont presque toutes). */
export const CHAMPS_EN_ANGLAIS: Record<string, string> = {
  longueur: 'board length (the longest side of the PCB, in mm)',
  largeur: 'board width (the shorter side of the PCB, in mm)',
  epaisseur: 'PCB thickness (in mm, usually 1.0 to 1.6)',
  trou_diametre: 'mounting hole diameter (in mm)',
  entraxe_x: 'distance between mounting hole centers along the length (in mm)',
  entraxe_y: 'distance between mounting hole centers along the width (in mm)',
  trou_bord_x: 'distance from a mounting hole center to the nearest short edge (in mm)',
  trou_bord_y: 'distance from a mounting hole center to the nearest long edge (in mm)',
  hauteur_dessus: 'height of the tallest part above the top of the PCB (in mm); for a display module: thickness of the glass panel above the PCB',
  hauteur_dessous: 'height of what sticks out under the PCB: pin headers, solder joints (in mm)',
  fenetre_largeur: 'display visual area (or active area) width, along the pin row (in mm)',
  fenetre_hauteur: 'display visual area (or active area) height (in mm)',
  fenetre_bord_x: 'distance from the left edge of the PCB to the left edge of the visual area (in mm)',
  fenetre_bord_y: 'distance from the PCB edge with the pins to the nearest edge of the visual area (in mm)',
};

/** Une lecture proposée par le modèle : un champ, un nombre en mm, la phrase de la page. */
export interface LectureProposee {
  champ: string;
  valeur: number;
  extrait: string;
}

/** Les requêtes de recherche pour un produit (3 au plus, de la plus utile à la moins utile). */
export function requetesCotes(produit: string): string[] {
  const p = produitEnAnglais(produit.replace(/https?:\/\/\S+/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!p) return [];
  // La dernière vise les plans des fabricants (DXF, PDF) : trous de fixation et place des prises.
  return [`${p} dimensions mm`, `${p} mounting holes mm`, `${p} datasheet board size`, `${p} dxf mechanical drawing`];
}

/**
 * La référence dite en français, en mots que les fiches anglaises emploient (« écran OLED 1,3 pouce
 * I2C » → « OLED display 1.3 inch I2C ») : les recherches et le contrôle des pages en ont besoin.
 */
export function produitEnAnglais(produit: string): string {
  return produit
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(^|[^\p{L}])(?:[ée]cran|afficheur)(?!\p{L})/giu, '$1display')
    .replace(/\bpouces?\b/gi, 'inch')
    .replace(/\bmicro(?:phone)?\b(?=.*\bi2s\b)/gi, 'microphone')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La taille d'un écran dite dans la référence (« 1,3 pouce », « 0.96" ») : une page doit dire la même. */
function tailleDite(texte: string): string | null {
  const m = /(\d+[.,]\d+)\s*(?:pouces?|inch(?:es)?|"|”|''|in\b)/i.exec(texte);
  return m ? m[1]!.replace(',', '.') : null;
}

/** Les adresses écrites dans la réponse de l'utilisateur (« voilà le lien : https://… »). */
export function liensDits(texte: string): string[] {
  return [...new Set((texte.match(/https?:\/\/[^\s<>"']+/g) ?? []).map((u) => u.replace(/[).,;]+$/, '')))];
}

/**
 * Le texte utile d'une page : les lignes qui portent un nombre et un mot de cote (mm, dimension,
 * hole, size…), avec la ligne d'avant et d'après. Une page de 50 000 caractères devient quelques
 * milliers : le modèle lit ce qui compte, et rien d'autre.
 */
export function passagesUtiles(texte: string, max = 6000): string {
  const lignes = texte.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const utile = /(\d\s*(?:mm|millim)|dimension|size|taille|hole|trou|mounting|length|width|height|thickness|epaisseur|épaisseur|longueur|largeur|hauteur|\d\s*[x×*]\s*\d)/i;
  const garder = new Set<number>();
  lignes.forEach((l, i) => {
    if (/\d/.test(l) && utile.test(l)) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lignes.length) garder.add(j);
  });
  let out = '';
  for (const i of [...garder].sort((a, b) => a - b)) {
    const l = lignes[i]!.slice(0, 400);
    if (out.length + l.length + 1 > max) break;
    out += `${l}\n`;
  }
  return out.trim();
}

/** La consigne du modèle qui lit (système), pour un produit et les champs encore manquants. */
export function consigneLectureCotes(): string {
  return [
    'You read web page excerpts about an electronic board and extract its mechanical dimensions.',
    'Rules:',
    '- Only report a number that is WRITTEN in the excerpt for THIS product. Never guess, never use your own knowledge.',
    '- "extrait" must be copied character for character from the excerpt (10 to 160 characters) and must contain the number.',
    '- Convert to millimetres only if the excerpt gives cm or inches; otherwise copy the mm value.',
    '- If a field is not written in the excerpt, leave it out.',
    'Answer with JSON only: {"cotes":[{"champ":"<field>","valeur":<number>,"extrait":"<exact text>"}]}',
  ].join('\n');
}

export function demandeLectureCotes(produit: string, champs: readonly string[], url: string, passages: string): string {
  const liste = champs.map((c) => `- ${c}: ${CHAMPS_EN_ANGLAIS[c] ?? c}`).join('\n');
  return `Product: ${produitEnAnglais(produit)}\nPage: ${url}\nFields wanted:\n${liste}\n\nExcerpt:\n"""\n${passages}\n"""`;
}

/** Lecture tolérante de la réponse du modèle (bloc ```json, texte autour). */
export function lireReponseCotes(texte: string): LectureProposee[] {
  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return [];
  try {
    const data = JSON.parse(texte.slice(debut, fin + 1)) as { cotes?: unknown };
    if (!Array.isArray(data.cotes)) return [];
    const out: LectureProposee[] = [];
    for (const x of data.cotes as { champ?: unknown; valeur?: unknown; extrait?: unknown }[]) {
      const valeur = typeof x?.valeur === 'number' ? x.valeur : typeof x?.valeur === 'string' ? Number(x.valeur.replace(',', '.')) : NaN;
      if (typeof x?.champ !== 'string' || !Number.isFinite(valeur) || typeof x.extrait !== 'string') continue;
      out.push({ champ: x.champ, valeur, extrait: x.extrait });
    }
    return out;
  } catch {
    return [];
  }
}

/** Texte comparable : minuscules, espaces simples, « × » et « * » en « x », virgule décimale en point. */
function comparable(s: string): string {
  return s
    .toLowerCase()
    .replace(/[×*]/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les nombres écrits dans un texte, en mm (« 2,5 cm » → 25 ; « 1 inch » → 25,4). */
function nombresEnMm(s: string): number[] {
  const out: number[] = [];
  for (const m of comparable(s).matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|in(?:ch(?:es)?)?|")?/g)) {
    const v = Number(m[1]);
    const u = m[2] ?? '';
    out.push(v);
    if (u === 'cm') out.push(v * 10);
    if (u.startsWith('in') || u === '"') out.push(Math.round(v * 25.4 * 100) / 100);
  }
  return out;
}

/**
 * Vérifie une lecture proposée contre le texte lu : champ connu pour ce composant, bornes de la
 * mesure, extrait retrouvé tel quel dans la page, nombre retrouvé dans l'extrait. `null` : bonne ;
 * sinon la raison du rejet.
 */
export function verifierLectureCote(idComposant: string, texteLu: string, l: LectureProposee): string | null {
  const q: QuestionMesure | undefined = composant(idComposant)?.aMesurer?.find((x) => x.champ === l.champ);
  if (!q) return 'champ inconnu';
  if (q.minMesure !== undefined && l.valeur < q.minMesure) return 'hors bornes';
  if (!(l.valeur >= q.min && l.valeur <= q.max)) return 'hors bornes';
  const extrait = comparable(l.extrait);
  if (extrait.length < 4 || extrait.length > 300) return 'extrait trop court ou trop long';
  if (!comparable(texteLu).includes(extrait)) return 'extrait introuvable dans la page';
  if (!nombresEnMm(extrait).some((n) => Math.abs(n - l.valeur) <= 0.05)) return 'nombre absent de l’extrait';
  return null;
}

export { siteDeSource } from './composants.js';

const MOTS_VIDES = new Set([
  'the', 'and', 'for', 'with', 'board', 'module', 'carte', 'avec', 'pour', 'des', 'les', 'une', 'version', 'broches', 'pins', 'pin',
  'dimensions', 'dimension', 'taille', 'size', 'kit', 'officiel', 'officielle', 'original', 'originale', 'sur',
  'display', 'ecran', 'afficheur', 'inch', 'pouce', 'pouces',
]);

function sansAccents(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Les mots qui désignent le produit (« ESP32-S3-DevKitC-1 » → esp32, devkitc). */
export function motsDuProduit(produit: string): string[] {
  const mots = sansAccents(produitEnAnglais(produit.replace(/https?:\/\/\S+/g, ' ')))
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 3 && /[a-z]/.test(m) && !MOTS_VIDES.has(m));
  return [...new Set(mots)];
}

/**
 * La page parle-t-elle de ce produit ? Les deux tiers de ses mots au moins : un article « size of
 * esp32 » ne parle pas de la « ESP32-S3-DevKitC-1 », ses cotes seraient celles d'une autre carte.
 */
export function pageDuProduit(texte: string, produit: string): boolean {
  const mots = motsDuProduit(produit);
  // Une taille d'écran dite (« 1,3 pouce ») : la page doit dire la même (une page sur l'écran de 0,96 ne sert pas).
  const taille = tailleDite(produitEnAnglais(produit));
  if (taille && tailleDite(texte.replace(/(\d),(\d)/g, '$1.$2')) !== taille && !new RegExp(`${taille.replace('.', '[.,]')}\\s*(?:pouces?|inch|"|”|''|in\\b)`, 'i').test(texte)) return false;
  if (mots.length === 0) return true;
  const page = sansAccents(texte).replace(/\biic\b/g, 'i2c').replace(/[^a-z0-9]+/g, '');
  return mots.filter((m) => page.includes(m)).length >= Math.ceil((mots.length * 2) / 3);
}

/**
 * Sur une page qui compare plusieurs cartes (guide, tableau), une cote ne vaut pour ce produit que si
 * sa ligne, ou l'une des deux d'avant, le nomme. Une page qui lui est consacrée (nommé dans ses
 * premières lignes) n'a pas besoin de ce contrôle.
 */
export function extraitDuProduit(texte: string, extrait: string, produit: string): boolean {
  const lignes = texte.split(/\r?\n/);
  if (pageDuProduit(lignes.slice(0, 3).join(' ').slice(0, 400), produit)) return true;
  const e = comparable(extrait);
  for (let i = 0; i < lignes.length; i += 1) {
    if (!comparable(lignes[i]!).includes(e)) continue;
    if (pageDuProduit(lignes.slice(Math.max(0, i - 2), i + 1).join(' '), produit)) return true;
  }
  return false;
}
