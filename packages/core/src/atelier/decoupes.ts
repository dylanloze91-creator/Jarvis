/**
 * Atelier 3D : les découpes percées dans une pièce (trous, ouvertures, encoches).
 *
 * « Une boîte de 80 par 50 par 30 avec un trou de 8 mm à l'arrière pour le câble »,
 * « ajoute une ouverture de 15 par 10 à l'avant, en bas », « une encoche sur le côté gauche »,
 * « enlève le trou », « le trou plus gros ».
 *
 * Une découpe se dit avec une face (vue de l'extérieur : avant, arrière, côté gauche ou droit,
 * dessus, fond, couvercle) et une place sur cette face (centre, en haut, en bas, à gauche, à
 * droite, aux coins). Sur une pièce creuse (boîte, bac), elle traverse la paroi seulement ; sur une
 * pièce pleine (socle, entretoise, cale), elle traverse la pièce de part en part ; une encoche
 * sur une pièce pleine est une rainure dessous, du bord jusqu'au milieu (passage de câble).
 *
 * Les découpes sont gardées dans les mesures de la pièce, sous `decoupes` (texte JSON), pour
 * suivre les versions comme les autres mesures. Pur : aucune dépendance, aucun accès disque.
 * Le texte lu ici est déjà « plié » (`plier` de `lecture.ts`) : minuscules, sans accent.
 */
import type { Valeurs } from './gabarits.js';

export type FormeDecoupe = 'rond' | 'rect' | 'encoche';
export type FaceDecoupe = 'avant' | 'arriere' | 'gauche' | 'droite' | 'dessus' | 'dessous' | 'couvercle';
export type PlaceU = 'centre' | 'gauche' | 'droite';
export type PlaceV = 'centre' | 'haut' | 'bas';

export interface Decoupe {
  forme: FormeDecoupe;
  face: FaceDecoupe;
  /** Rond : diamètre. Ouverture et encoche : largeur (mm). */
  largeur: number;
  /** Ouverture : hauteur. Encoche : profondeur (0 : choisie par l'atelier). Rond : le diamètre. */
  hauteur: number;
  nombre: number;
  /** Place sur la face, vue de l'extérieur. */
  u: PlaceU;
  v: PlaceV;
  /** Quatre découpes, une dans chaque coin de la face. */
  coins?: boolean;
}

/** Plus de découpes que ça sur une pièce : refusé (la pièce deviendrait illisible). */
export const DECOUPES_MAX = 12;

const FORMES: readonly FormeDecoupe[] = ['rond', 'rect', 'encoche'];
const FACES: readonly FaceDecoupe[] = ['avant', 'arriere', 'gauche', 'droite', 'dessus', 'dessous', 'couvercle'];

// ---------------------------------------------------------------------------------------------
// Rangement dans les mesures

function estDecoupe(x: unknown): x is Decoupe {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  const nombre = (k: string) => typeof d[k] === 'number' && Number.isFinite(d[k]);
  return (
    FORMES.includes(d.forme as FormeDecoupe) &&
    FACES.includes(d.face as FaceDecoupe) &&
    nombre('largeur') &&
    nombre('hauteur') &&
    nombre('nombre') &&
    ['centre', 'gauche', 'droite'].includes(d.u as string) &&
    ['centre', 'haut', 'bas'].includes(d.v as string)
  );
}

/** Les découpes rangées dans les mesures (illisibles : aucune). */
export function decoupesDe(v: Valeurs): Decoupe[] {
  const raw = v.decoupes;
  if (typeof raw !== 'string' || !raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(data) ? data.filter(estDecoupe) : [];
}

/** Les mesures avec ces découpes (aucune : la clé disparaît). */
export function avecDecoupes(v: Valeurs, liste: readonly Decoupe[]): Valeurs {
  const out: Valeurs = { ...v };
  delete out.decoupes;
  if (liste.length) out.decoupes = JSON.stringify(liste);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Les pièces qu'on sait percer

/** Pièces percées : ce qu'on sait de leur forme sans les mesures. */
const PERCABLES: Record<string, { creux: boolean; face: FaceDecoupe; faceCable: FaceDecoupe; faceVis: FaceDecoupe }> = {
  boite: { creux: true, face: 'avant', faceCable: 'arriere', faceVis: 'dessous' },
  boite_couvercle: { creux: true, face: 'avant', faceCable: 'arriere', faceVis: 'dessous' },
  bac: { creux: true, face: 'avant', faceCable: 'arriere', faceVis: 'dessous' },
  socle: { creux: false, face: 'dessus', faceCable: 'dessus', faceVis: 'dessus' },
  entretoise: { creux: false, face: 'avant', faceCable: 'avant', faceVis: 'avant' },
  cale: { creux: false, face: 'dessus', faceCable: 'dessus', faceVis: 'dessus' },
};

export const PIECES_PERCABLES = 'les boîtes, les bacs, les socles, les entretoises et les cales';

export function sePerce(gabaritId: string): boolean {
  return gabaritId in PERCABLES;
}

type V3 = [number, number, number];

interface Corps {
  min: V3;
  max: V3;
  creux: boolean;
  paroi: number;
  fond: number;
  /** Rond vu de dessus (socle rond, entretoise) : on reste dans le carré inscrit. */
  rond: boolean;
  faces: FaceDecoupe[];
  couvercle?: { x0: number; L: number; W: number; t: number; marge: number };
  rebord?: number;
}

function nb(v: Valeurs, id: string): number {
  const x = v[id];
  return typeof x === 'number' && Number.isFinite(x) ? x : Number.NaN;
}

/** La forme de la pièce, comme la dessine son gabarit (mêmes coordonnées OpenSCAD). */
function corpsDe(gabaritId: string, v: Valeurs): Corps | null {
  switch (gabaritId) {
    case 'boite':
    case 'bac':
    case 'boite_couvercle': {
      const L = nb(v, 'longueur');
      const W = nb(v, 'largeur');
      const e = nb(v, 'paroi');
      const corps: Corps = {
        min: [0, 0, 0],
        max: [L, W, nb(v, 'hauteur')],
        creux: true,
        paroi: e,
        fond: nb(v, 'fond'),
        rond: false,
        faces: ['avant', 'arriere', 'gauche', 'droite', 'dessous'],
      };
      if (gabaritId === 'boite_couvercle') {
        // Le couvercle est imprimé à côté (x = L + 10), à l'envers : sa plaque à plat, le rebord
        // (épaisseur e, à e + jeu du bord) vers le haut. On perce à l'intérieur du rebord.
        corps.faces.push('couvercle');
        corps.couvercle = { x0: L + 10, L, W, t: nb(v, 'couvercle'), marge: 2 * e + nb(v, 'jeu') + 1 };
        corps.rebord = nb(v, 'rebord');
      }
      return corps;
    }
    case 'socle': {
      const T = nb(v, 'taille');
      return {
        min: [-T / 2, -T / 2, 0],
        max: [T / 2, T / 2, nb(v, 'hauteur')],
        creux: false,
        paroi: 0,
        fond: 0,
        rond: v.forme !== 'carre',
        faces: ['avant', 'arriere', 'gauche', 'droite', 'dessus', 'dessous'],
      };
    }
    case 'entretoise': {
      const D = nb(v, 'diametre');
      return { min: [-D / 2, -D / 2, 0], max: [D / 2, D / 2, nb(v, 'hauteur')], creux: false, paroi: 0, fond: 0, rond: true, faces: ['avant', 'arriere', 'gauche', 'droite'] };
    }
    case 'cale':
      return {
        min: [0, 0, 0],
        max: [nb(v, 'longueur'), nb(v, 'largeur'), Math.max(nb(v, 'haut'), nb(v, 'bas'))],
        creux: false,
        paroi: 0,
        fond: 0,
        rond: false,
        faces: ['dessus', 'dessous'],
      };
    default:
      return null;
  }
}

/**
 * Repère d'une face, vue de l'extérieur : `n` l'axe qui la traverse (0 x, 1 y, 2 z), `u` l'axe
 * de gauche à droite (`us` : −1 si la droite est vers les petites coordonnées), `v` l'axe de bas
 * en haut. Sur le dessus et le fond, « en haut » veut dire vers l'arrière. Le couvercle est
 * imprimé retourné : son arrière (boîte fermée) est vers les petits y.
 */
interface Repere {
  n: 0 | 1 | 2;
  cote: -1 | 1;
  ua: 0 | 1 | 2;
  us: -1 | 1;
  va: 0 | 1 | 2;
  vs: -1 | 1;
}
const REPERES: Record<FaceDecoupe, Repere> = {
  avant: { n: 1, cote: -1, ua: 0, us: 1, va: 2, vs: 1 },
  arriere: { n: 1, cote: 1, ua: 0, us: -1, va: 2, vs: 1 },
  gauche: { n: 0, cote: -1, ua: 1, us: -1, va: 2, vs: 1 },
  droite: { n: 0, cote: 1, ua: 1, us: 1, va: 2, vs: 1 },
  dessus: { n: 2, cote: 1, ua: 0, us: 1, va: 1, vs: 1 },
  dessous: { n: 2, cote: -1, ua: 0, us: 1, va: 1, vs: 1 },
  couvercle: { n: 2, cote: -1, ua: 0, us: 1, va: 1, vs: -1 },
};

// ---------------------------------------------------------------------------------------------
// Les mots

function mm(x: number): string {
  return String(Math.round(x * 10) / 10).replace('.', ',');
}

const FACE_TEXTE: Record<FaceDecoupe, string> = {
  avant: 'à l’avant',
  arriere: 'à l’arrière',
  gauche: 'sur le côté gauche',
  droite: 'sur le côté droit',
  dessus: 'sur le dessus',
  dessous: 'dessous',
  couvercle: 'sur le couvercle',
};

function faceTexte(face: FaceDecoupe, creux: boolean): string {
  return face === 'dessous' && creux ? 'dans le fond' : FACE_TEXTE[face];
}

/** « trou de 8 mm à l'arrière, en bas », « 2 ouvertures de 15 × 10 mm à l'avant ». */
export function direDecoupe(d: Decoupe, creux = true): string {
  const noms = { rond: ['trou', 'trous'], rect: ['ouverture', 'ouvertures'], encoche: ['encoche', 'encoches'] }[d.forme];
  const nom = d.nombre > 1 ? `${d.nombre} ${noms[1]}` : noms[0]!;
  const taille = d.forme === 'rect' ? `${mm(d.largeur)} × ${mm(d.hauteur)} mm` : `${mm(d.largeur)} mm`;
  const profondeur = d.forme === 'encoche' && d.hauteur > 0 ? `, ${mm(d.hauteur)} mm de profondeur` : '';
  const couche = REPERES[d.face].n === 2;
  const v = d.v === 'centre' ? '' : couche ? (d.v === 'haut' ? 'vers l’arrière' : 'vers l’avant') : `en ${d.v}`;
  const u = d.u === 'centre' ? '' : `à ${d.u}`;
  const place = d.coins ? 'aux coins' : [v, u].filter(Boolean).join(' ');
  return `${nom} de ${taille}${profondeur} ${faceTexte(d.face, creux)}${place ? `, ${place}` : ''}`;
}

/** Libellé d'une découpe pour la liste des mesures, à côté de la pièce. */
export function decoupesAffichees(gabaritId: string, v: Valeurs): { nom: string; valeur: string }[] {
  const creux = PERCABLES[gabaritId]?.creux ?? true;
  return decoupesDe(v).map((d) => ({ nom: 'Découpe', valeur: direDecoupe(d, creux) }));
}

// ---------------------------------------------------------------------------------------------
// Placer et dessiner

function f(x: number): string {
  if (!Number.isFinite(x)) throw new Error('mesure invalide');
  return String(Math.round(x * 100) / 100);
}

function point(r: Repere, n0: number, u: number, v: number): V3 {
  const p: V3 = [0, 0, 0];
  p[r.n] = n0;
  p[r.ua] = u;
  p[r.va] = v;
  return p;
}

function cylindre(r: Repere, n0: number, n1: number, u: number, v: number, d: number): string {
  const p = point(r, n0, u, v);
  // Le cylindre d'OpenSCAD monte selon z : on le couche selon y (−90° autour de x) ou x (90° autour de y).
  const tourne = r.n === 2 ? '' : r.n === 1 ? 'rotate([-90, 0, 0]) ' : 'rotate([0, 90, 0]) ';
  return `translate([${p.map(f).join(', ')}]) ${tourne}cylinder(h = ${f(n1 - n0)}, d = ${f(d)});`;
}

function pave(r: Repere, n0: number, n1: number, u0: number, u1: number, v0: number, v1: number): string {
  const p = point(r, n0, u0, v0);
  const s: V3 = [0, 0, 0];
  s[r.n] = n1 - n0;
  s[r.ua] = u1 - u0;
  s[r.va] = v1 - v0;
  return `translate([${p.map(f).join(', ')}]) cube([${s.map(f).join(', ')}]);`;
}

/** Plage utile d'un axe de la face (mm, coordonnées de la pièce). */
function plage(c: Corps, axe: 0 | 1 | 2): [number, number] {
  const lo = c.min[axe];
  const hi = c.max[axe];
  if (axe === 2) return c.creux ? [c.fond + 1, hi - 2] : [lo + 2, hi - 2];
  if (c.creux) return [lo + c.paroi + 1, hi - c.paroi - 1];
  if (c.rond) {
    const centre = (lo + hi) / 2;
    const demi = (hi - lo) / 2 / Math.SQRT2;
    return [centre - demi + 1, centre + demi - 1];
  }
  return [lo + 2, hi - 2];
}

/** Centres de `nombre` découpes de taille `s` dans [a, b], ou `null` si elles n'y tiennent pas. */
function centres(a: number, b: number, s: number, nombre: number, cote: 'bas' | 'centre' | 'haut', sens: -1 | 1): number[] | null {
  if (b - a < s) return null;
  if (nombre === 1) {
    if (cote === 'centre') return [(a + b) / 2];
    const versLesPetits = (cote === 'bas') === (sens > 0);
    return [versLesPetits ? a + s / 2 : b - s / 2];
  }
  const pas = (b - a) / (nombre + 1);
  if (pas - s < 1.5) return null;
  return Array.from({ length: nombre }, (_, k) => a + pas * (k + 1));
}

/** Profondeur d'une encoche quand l'utilisateur ne l'a pas dite. */
function profondeurEncoche(c: Corps, d: Decoupe): number {
  if (d.hauteur > 0) return d.hauteur;
  // Boîte à couvercle : le rebord du couvercle descend dans la boîte, l'encoche passe dessous.
  return c.rebord !== undefined ? c.rebord + d.largeur : d.largeur;
}

const VERTICALES: readonly FaceDecoupe[] = ['avant', 'arriere', 'gauche', 'droite'];

function refusFace(gabaritId: string, c: Corps, d: Decoupe): string {
  const quoi = direDecoupe(d, c.creux);
  if (d.face === 'couvercle') return `${maj(quoi)} : cette pièce n’a pas de couvercle.`;
  if (c.creux && d.face === 'dessus') return `${maj(quoi)} : la boîte est ouverte sur le dessus. Je peux percer le fond, les côtés, ou le couvercle d’une boîte avec couvercle.`;
  if (gabaritId === 'entretoise') return `${maj(quoi)} : le trou du milieu de l’entretoise se règle avec sa mesure « diamètre du trou ». Sur une entretoise, je perce seulement les côtés.`;
  if (gabaritId === 'cale') return `${maj(quoi)} : sur une cale, je perce seulement de haut en bas.`;
  return `${maj(quoi)} : je ne sais pas percer cette face-là.`;
}

function maj(texte: string): string {
  return texte ? `${texte[0]!.toUpperCase()}${texte.slice(1)}` : texte;
}

/**
 * Les découpes en OpenSCAD (à retrancher de la pièce), et ce qui ne va pas, en phrases simples.
 * `v` : les mesures complètes de la pièce.
 */
export function placerDecoupes(gabaritId: string, nomPiece: string, v: Valeurs, liste: readonly Decoupe[]): { scad: string[]; erreurs: string[] } {
  const scad: string[] = [];
  const erreurs: string[] = [];
  if (!liste.length) return { scad, erreurs };
  const c = corpsDe(gabaritId, v);
  if (!c) return { scad, erreurs: [`Je ne sais pas encore faire de découpes dans un ${nomPiece} : je sais percer ${PIECES_PERCABLES}.`] };
  if (liste.length > DECOUPES_MAX) erreurs.push(`Trop de découpes (${liste.length}) : ${DECOUPES_MAX} au plus.`);

  for (const d of liste) {
    const quoi = maj(direDecoupe(d, c.creux));
    if (!c.faces.includes(d.face)) {
      erreurs.push(refusFace(gabaritId, c, d));
      continue;
    }
    if (d.largeur < 1 || d.largeur > 250 || d.hauteur < 0 || d.hauteur > 250 || (d.forme === 'rect' && d.hauteur < 1)) {
      erreurs.push(`${quoi} : taille impossible (de 1 à 250 mm).`);
      continue;
    }
    if (!Number.isInteger(d.nombre) || d.nombre < 1 || d.nombre > 6) {
      erreurs.push(`${quoi} : de 1 à 6 à la fois, s’il te plaît.`);
      continue;
    }
    const r = REPERES[d.face];
    const couche = r.n === 2;
    if (d.forme === 'encoche' && couche) {
      erreurs.push(`${quoi} : une encoche se fait sur un côté (avant, arrière, gauche ou droit).`);
      continue;
    }

    // Plages utiles sur la face, et traversée selon la normale.
    let pu: [number, number];
    let pv: [number, number];
    let pn: [number, number];
    if (d.face === 'couvercle' && c.couvercle) {
      const k = c.couvercle;
      pu = [k.x0 + k.marge, k.x0 + k.L - k.marge];
      pv = [k.marge, k.W - k.marge];
      pn = [-1, k.t + 1];
    } else {
      pu = plage(c, r.ua);
      pv = plage(c, r.va);
      const lo = c.min[r.n];
      const hi = c.max[r.n];
      if (!c.creux) pn = [lo - 1, hi + 1];
      else if (couche) pn = [lo - 1, c.fond + 1];
      else pn = r.cote < 0 ? [lo - 1, lo + c.paroi + 1] : [hi - c.paroi - 1, hi + 1];
    }

    const largeur = d.largeur;
    const hauteur = d.forme === 'rond' ? d.largeur : d.hauteur;
    const place = `${mm(Math.max(0, pu[1] - pu[0]))} × ${mm(Math.max(0, pv[1] - pv[0]))} mm`;

    if (d.forme === 'encoche') {
      const H = c.max[2];
      const h = profondeurEncoche(c, d);
      if (h < largeur / 2) {
        erreurs.push(`${quoi} : il faut au moins ${mm(largeur / 2)} mm de profondeur (la moitié de sa largeur).`);
        continue;
      }
      if (c.creux && c.rebord !== undefined && d.hauteur > 0 && h < c.rebord + largeur / 2 + 1) {
        erreurs.push(`${quoi} : le rebord du couvercle (${mm(c.rebord)} mm) la boucherait. Il faut au moins ${mm(c.rebord + largeur)} mm de profondeur.`);
        continue;
      }
      const maxi = c.creux ? H - c.fond - 1 : H - 2;
      if (h > maxi) {
        erreurs.push(`${quoi} : trop profonde pour cette pièce (${mm(Math.max(0, maxi))} mm au plus).`);
        continue;
      }
      const us = centres(pu[0], pu[1], largeur, d.nombre, d.u === 'gauche' ? 'bas' : d.u === 'droite' ? 'haut' : 'centre', r.us);
      if (!us) {
        erreurs.push(`${quoi} : ne tient pas ${faceTexte(d.face, c.creux)} (${mm(Math.max(0, pu[1] - pu[0]))} mm de place en largeur).`);
        continue;
      }
      // Pièce creuse : l'encoche descend depuis le bord du haut (le câble se pose dedans).
      // Pièce pleine : rainure dessous, du bord jusqu'au milieu.
      const n = c.creux ? pn : r.cote < 0 ? ([c.min[r.n] - 1, (c.min[r.n] + c.max[r.n]) / 2] as [number, number]) : ([(c.min[r.n] + c.max[r.n]) / 2, c.max[r.n] + 1] as [number, number]);
      for (const u of us) {
        const rayon = largeur / 2;
        if (c.creux) {
          const bas = H - h + rayon;
          scad.push(`union() { ${pave(r, n[0], n[1], u - rayon, u + rayon, bas, H + 1)} ${cylindre(r, n[0], n[1], u, bas, largeur)} }`);
        } else {
          const haut = h - rayon;
          scad.push(`union() { ${pave(r, n[0], n[1], u - rayon, u + rayon, -1, haut)} ${cylindre(r, n[0], n[1], u, haut, largeur)} }`);
        }
      }
      continue;
    }

    let points: [number, number][] | null;
    if (d.coins) {
      const okU = pu[1] - pu[0] >= 2 * largeur + 1.5;
      const okV = pv[1] - pv[0] >= 2 * hauteur + 1.5;
      points = okU && okV
        ? [pu[0] + largeur / 2, pu[1] - largeur / 2].flatMap((u) => [pv[0] + hauteur / 2, pv[1] - hauteur / 2].map((w) => [u, w] as [number, number]))
        : null;
    } else {
      const us = centres(pu[0], pu[1], largeur, d.nombre, d.u === 'gauche' ? 'bas' : d.u === 'droite' ? 'haut' : 'centre', r.us);
      const vs = centres(pv[0], pv[1], hauteur, 1, d.v, r.vs);
      points = us && vs ? us.map((u) => [u, vs[0]!] as [number, number]) : null;
    }
    if (!points) {
      const plusieurs = d.nombre > 1 || d.coins;
      erreurs.push(
        plusieurs
          ? `${quoi} : ils ne tiennent pas côte à côte ${faceTexte(d.face, c.creux)} (${place} de place). Fais-les plus petits ou moins nombreux.`
          : `${quoi} : ne tient pas ${faceTexte(d.face, c.creux)} (${place} de place, en gardant les bords). Fais-le plus petit.`,
      );
      continue;
    }
    for (const [u, w] of points) {
      scad.push(d.forme === 'rond' ? cylindre(r, pn[0], pn[1], u, w, largeur) : pave(r, pn[0], pn[1], u - largeur / 2, u + largeur / 2, w - hauteur / 2, w + hauteur / 2));
    }
  }
  return { scad, erreurs };
}

// ---------------------------------------------------------------------------------------------
// Lire une phrase

export interface OpDecoupe {
  action: 'ajouter' | 'modifier' | 'enlever';
  /** `null` : n'importe laquelle (« les découpes »). */
  forme: FormeDecoupe | null;
  /** « trou », « passage » : rond, ou ouverture si on donne deux mesures. */
  souple: boolean;
  tous: boolean;
  faces: FaceDecoupe[];
  largeur?: number;
  hauteur?: number;
  nombre?: number;
  u?: PlaceU;
  v?: PlaceV;
  coins?: boolean;
  taille?: 'plus' | 'moins';
  profond?: 'plus' | 'moins';
  cable: boolean;
  vis: boolean;
}

const QUANTITES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, des: 2 };
const MOT_CLE = String.raw`(trous?|percages?|passe cables?|passages?|sorties? (?:de|pour) (?:le |les |un |des )?cables?|ouvertures?|fenetres?|encadrements?|decoupes?|fentes?|encoches?|entailles?|echancrures?)`;
const ARTICLE = String.raw`(?:(un|une|deux|trois|quatre|cinq|six|des|le|la|l|les|ce|cette|\d+) )?`;
const DEFINIS = new Set(['le', 'la', 'l', 'les', 'ce', 'cette']);
const RETRAIT = /(?:^| )(?:enleve|enlever|enleves|retire|retirer|retires|supprime|supprimer|bouche|boucher|rebouche|efface|effacer|vire|virer|sans|pas de|pas d|aucun|aucune)(?: moi| lui)?( tous| toutes)?\s*$/;

const N = String.raw`(\d+(?:\.\d+)?)`;
const U = String.raw`\s*(mm|millimetres?|cm|centimetres?)?`;
const PAIRE = new RegExp(String.raw`${N}${U}\s*(?:x|par|sur)\s*${N}${U}`);
const LARGE = new RegExp(String.raw`${N}${U}\s*(?:de |d )?(?:large|largeur)\b|\blargeur (?:de |d )?${N}${U}`);
const HAUT = new RegExp(String.raw`${N}${U}\s*(?:de |d )?(?:haut|hauteur|profondeur|profond|profonde)\b|\b(?:hauteur|profondeur) (?:de |d )?${N}${U}`);
const DIAMETRE = new RegExp(String.raw`\b(?:diametre|diam) (?:de |d )?${N}${U}|${N}${U}\s*(?:de |d )?diametre\b`);
const SEUL = new RegExp(String.raw`${N}${U}(?! ?(?:coins|trous?|encoches?|ouvertures?))`);

function lu(x: string | undefined, unite: string | undefined): number | undefined {
  if (x === undefined) return undefined;
  const v = Number(x);
  return unite && unite.startsWith('c') ? v * 10 : v;
}

const FACES_MOTS: [FaceDecoupe, RegExp][] = [
  ['couvercle', /\bcouvercle\b/],
  ['dessous', /\b(?:fond|dessous|par en dessous)\b/],
  ['dessus', /\b(?:dessus|plafond|toit)\b/],
  ['avant', /\b(?:avant|devant|facade)\b/],
  ['arriere', /\b(?:arriere|derriere)\b/],
  ['gauche', /\b(?:cote|flanc|face|bord|paroi) gauche\b/],
  ['droite', /\b(?:cote|flanc|face|bord|paroi) droite?\b/],
];
const DEUX_COTES = /\b(?:des deux cotes|de chaque cote|sur les cotes|sur les deux cotes|de part et d autre)\b/;
const UN_COTE = /\b(?:sur|du|au|d un) (?:le |un )?cote\b/;
const A_GAUCHE = /\b(?:a|sur la|vers la|tout a) gauche\b/;
const A_DROITE = /\b(?:a|sur la|vers la|tout a) droite\b/;

function lireSegment(article: string | undefined, cle: string, s: string, avant: string): OpDecoupe | null {
  const retrait = RETRAIT.exec(avant);
  const forme: FormeDecoupe | null = /^(?:ouverture|fenetre|encadrement|fente)/.test(cle)
    ? 'rect'
    : /^(?:encoche|entaille|echancrure)/.test(cle)
      ? 'encoche'
      : /^decoupe/.test(cle)
        ? null
        : /\b(?:carre|carree|rectangulaire)\b/.test(s)
          ? 'rect'
          : 'rond';
  const op: OpDecoupe = {
    action: 'ajouter',
    forme,
    souple: forme === 'rond' || forme === null,
    tous: Boolean(retrait?.[1]) || article === 'les' || (forme === null && /s$/.test(cle)),
    faces: [],
    cable: /\bcables?\b/.test(`${cle} ${s}`),
    vis: /\b(?:vis|fixation|fixations|visser|cheville)\b/.test(s),
  };

  // Mesures.
  const paire = PAIRE.exec(s);
  if (paire) {
    op.largeur = lu(paire[1], paire[2] ?? paire[4]);
    op.hauteur = lu(paire[3], paire[4]);
  } else {
    const large = LARGE.exec(s);
    const haut = HAUT.exec(s);
    const diametre = DIAMETRE.exec(s);
    if (large) op.largeur = lu(large[1] ?? large[3], large[2] ?? large[4]);
    if (haut) op.hauteur = lu(haut[1] ?? haut[3], haut[2] ?? haut[4]);
    if (diametre) op.largeur = lu(diametre[1] ?? diametre[3], diametre[2] ?? diametre[4]);
    if (op.largeur === undefined && op.hauteur === undefined) {
      const seul = SEUL.exec(s);
      if (seul) op.largeur = lu(seul[1], seul[2]);
    }
  }

  // Face, puis place sur la face (sans les mots de la face).
  let reste = ` ${s} `;
  if (DEUX_COTES.test(reste)) {
    op.faces = ['gauche', 'droite'];
    reste = reste.replace(DEUX_COTES, ' ');
  } else {
    // Une encoche se fait sur un côté : « une encoche dessous vers l'arrière » vise l'arrière.
    const ordre = forme === 'encoche' ? [...FACES_MOTS].sort((x, y) => Number(VERTICALES.includes(y[0])) - Number(VERTICALES.includes(x[0]))) : FACES_MOTS;
    for (const [face, re] of ordre) {
      if (re.test(reste)) {
        op.faces = [face];
        reste = reste.replace(re, ' ');
        break;
      }
    }
    if (!op.faces.length && UN_COTE.test(reste)) {
      op.faces = [A_GAUCHE.test(reste) ? 'gauche' : 'droite'];
      reste = reste.replace(UN_COTE, ' ').replace(A_GAUCHE, ' ').replace(A_DROITE, ' ');
    }
    if (!op.faces.length && A_GAUCHE.test(reste)) {
      op.faces = ['gauche'];
      reste = reste.replace(A_GAUCHE, ' ');
    } else if (!op.faces.length && A_DROITE.test(reste)) {
      op.faces = ['droite'];
      reste = reste.replace(A_DROITE, ' ');
    }
  }
  if (A_GAUCHE.test(reste)) op.u = 'gauche';
  else if (A_DROITE.test(reste)) op.u = 'droite';
  if (/\b(?:en|vers le|du|tout en) bas\b/.test(reste)) op.v = 'bas';
  else if (/\b(?:en|vers le|du|tout en) haut\b/.test(reste)) op.v = 'haut';
  if (/\b(?:au|du) (?:centre|milieu)\b|\bcentre\b/.test(reste)) {
    op.u ??= 'centre';
    op.v ??= 'centre';
  }
  if (/\b(?:aux|dans les|des|sur les) (?:4 |quatre )?coins\b/.test(reste)) op.coins = true;

  // Changements relatifs : dans la phrase, ou juste avant le mot (« plus gros le trou »).
  const autour = `${avant.split(' ').slice(-3).join(' ')} ${s}`;
  const grand = /\b(plus|moins) (?:un peu )?(gros|grosse|grand|grande|large|petit|petite)\b/.exec(autour);
  if (grand) op.taille = (grand[1] === 'plus') === !/^petit/.test(grand[2]!) ? 'plus' : 'moins';
  const profond = /\b(plus|moins) (?:un peu )?(?:profond|profonde)\b/.exec(autour);
  if (profond) op.profond = profond[1] === 'plus' ? 'plus' : 'moins';
  const plusHaut = /\bplus (haut|bas)\b/.exec(autour);
  if (plusHaut) op.v = plusHaut[1] === 'haut' ? 'haut' : 'bas';
  const plusCote = /\bplus a (gauche|droite)\b/.exec(autour);
  if (plusCote) op.u = plusCote[1] === 'gauche' ? 'gauche' : 'droite';

  const mesure = op.largeur !== undefined || op.hauteur !== undefined;
  const relatif = op.taille !== undefined || op.profond !== undefined || plusHaut !== null || plusCote !== null;
  if (retrait) op.action = 'enlever';
  else if ((article && DEFINIS.has(article)) || (!article && relatif && !mesure)) op.action = 'modifier';
  else if (article && article in QUANTITES) op.nombre = QUANTITES[article];
  else if (article && /^\d+$/.test(article)) op.nombre = Number(article);
  if (op.coins) op.nombre = 4;

  // « découpe » tout seul est un verbe (« découpe un trou ») : rien à lire.
  if (forme === null && op.action === 'ajouter' && !mesure && !op.faces.length) return null;
  return op;
}

/**
 * Les découpes dites dans une phrase pliée, et la phrase sans elles (pour lire les autres mesures).
 * `exigerFace` : la pièce a déjà sa mesure « trou » (entretoise) ; un trou n'est une découpe que
 * si la phrase dit où (« un trou de 3 sur le côté »).
 */
export function lireDecoupes(t: string, options: { exigerFace?: boolean } = {}): { ops: OpDecoupe[]; reste: string } {
  const texte = ` ${t} `;
  const re = new RegExp(String.raw`(?<= )${ARTICLE}${MOT_CLE}(?= )`, 'g');
  const trouves = [...texte.matchAll(re)];
  const ops: OpDecoupe[] = [];
  const coupes: [number, number][] = [];
  trouves.forEach((m, i) => {
    const debut = m.index;
    const finCle = debut + m[0].length;
    const suivant = trouves[i + 1]?.index ?? texte.length;
    let s = texte.slice(finCle, suivant);
    // Le morceau s'arrête à la virgule, à « avec », « puis », ou « et » qui ne continue pas la découpe.
    const suite = String.raw`(?:en (?:bas|haut)|tout en (?:bas|haut)|a (?:gauche|droite)|au (?:centre|milieu))`;
    const arret = new RegExp(String.raw` ,(?! ${suite})| avec | puis | et (?!\d|de \d|${suite})`).exec(s);
    if (arret) s = s.slice(0, arret.index);
    // « des trous comme des encadrements » : un seul genre de découpe, celui d'après.
    if (trouves[i + 1] && /^(?:comme|genre|style|facon|en forme d(?:e)?)$/.test(s.trim())) return;
    const op = lireSegment(m[1], m[2]!, s.trim(), texte.slice(0, debut).trim());
    if (!op) return;
    if (options.exigerFace && !op.faces.length) return;
    ops.push(op);
    coupes.push([debut, finCle + s.length]);
  });
  let reste = texte;
  for (const [a, b] of [...coupes].reverse()) reste = `${reste.slice(0, a)} ${reste.slice(b)}`;
  return { ops, reste: reste.replace(/\s+/g, ' ').trim() };
}

// ---------------------------------------------------------------------------------------------
// Appliquer à la pièce

function arrondi(x: number): number {
  return x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
}

function changer(x: number, sens: 'plus' | 'moins'): number {
  return sens === 'plus' ? arrondi(Math.max(x * 1.25, x + 1)) : arrondi(Math.max(1, Math.min(x * 0.8, x - 1)));
}

function correspond(d: Decoupe, op: OpDecoupe): boolean {
  if (op.forme === null) return true;
  if (op.souple) return d.forme === 'rond' || d.forme === 'rect';
  return d.forme === op.forme;
}

/**
 * Applique les découpes lues aux découpes de la pièce. `changements` : ce qui change, en mots
 * (« Ajout : trou de 8 mm à l'arrière »). Les tailles et la place sont contrôlées au rendu
 * (`placerDecoupes`), avec les mesures complètes de la pièce.
 */
export function appliquerDecoupes(
  g: { id: string; nom: string },
  existantes: readonly Decoupe[],
  ops: readonly OpDecoupe[],
): { decoupes: Decoupe[]; changements: string[]; erreurs: string[] } {
  const piece = PERCABLES[g.id];
  if (!piece) {
    return { decoupes: [...existantes], changements: [], erreurs: [`Je ne sais pas encore faire de découpes dans un ${g.nom} : je sais percer ${PIECES_PERCABLES}.`] };
  }
  const creux = piece.creux;
  let liste = [...existantes];
  const changements: string[] = [];
  const erreurs: string[] = [];

  for (const op of ops) {
    if (op.action === 'enlever') {
      const visees = liste.filter((d) => correspond(d, op) && (!op.faces.length || op.faces.includes(d.face)));
      if (!visees.length) {
        erreurs.push(liste.length ? 'Il n’y a pas de découpe comme ça à enlever.' : 'Cette pièce n’a pas de découpe à enlever.');
        continue;
      }
      const enlevees = op.tous ? visees : [visees[visees.length - 1]!];
      liste = liste.filter((d) => !enlevees.includes(d));
      changements.push(...enlevees.map((d) => `Retiré : ${direDecoupe(d, creux)}`));
      continue;
    }

    if (op.action === 'modifier') {
      let visees = liste.filter((d) => correspond(d, op));
      const surLaFace = visees.filter((d) => op.faces.includes(d.face));
      const changeTaille = op.largeur !== undefined || op.hauteur !== undefined || op.taille || op.profond;
      const deplacer = op.faces.length > 0 && !(surLaFace.length && changeTaille);
      if (surLaFace.length && !deplacer) visees = surLaFace;
      if (visees.length) {
        const cibles = op.tous ? visees : [visees[visees.length - 1]!];
        liste = liste.map((d) => {
          if (!cibles.includes(d)) return d;
          const n: Decoupe = { ...d };
          if (op.largeur !== undefined && op.hauteur !== undefined && n.forme === 'rond') n.forme = 'rect';
          if (op.largeur !== undefined) n.largeur = op.largeur;
          if (op.hauteur !== undefined) n.hauteur = op.hauteur;
          else if (op.largeur !== undefined && n.forme === 'rond') n.hauteur = op.largeur;
          if (op.taille) {
            n.largeur = changer(n.largeur, op.taille);
            if (n.forme === 'rond') n.hauteur = n.largeur;
            else if (n.forme === 'rect' || n.hauteur > 0) n.hauteur = changer(n.hauteur, op.taille);
          }
          if (op.profond && n.forme === 'encoche') n.hauteur = changer(n.hauteur > 0 ? n.hauteur : n.largeur, op.profond);
          if (deplacer) n.face = op.faces[0]!;
          if (op.u) n.u = op.u;
          if (op.v) n.v = op.v;
          if (op.coins) {
            n.coins = true;
            n.nombre = 4;
          }
          const avant = direDecoupe(d, creux);
          const apres = direDecoupe(n, creux);
          if (avant !== apres) changements.push(`${maj(avant)} → ${apres}`);
          return n;
        });
        continue;
      }
      // Rien à modifier : « fais le trou à l'arrière » sur une pièce sans trou, c'est un ajout.
    }

    const deux = op.largeur !== undefined && op.hauteur !== undefined;
    const forme: FormeDecoupe = op.forme === null ? 'rect' : op.souple && deux ? 'rect' : op.forme;
    const propose = op.largeur === undefined && op.hauteur === undefined;
    let largeur: number;
    let hauteur: number;
    if (forme === 'rond') {
      largeur = op.largeur ?? op.hauteur ?? (op.vis ? 4 : 8);
      hauteur = largeur;
    } else if (forme === 'rect') {
      largeur = op.largeur ?? op.hauteur ?? 20;
      hauteur = op.hauteur ?? (op.largeur ?? (propose ? 12 : largeur));
    } else {
      largeur = op.largeur ?? 8;
      hauteur = op.hauteur ?? 0;
    }
    const faces: FaceDecoupe[] = op.faces.length
      ? op.faces
      : [op.vis ? piece.faceVis : op.cable ? piece.faceCable : forme === 'encoche' && !VERTICALES.includes(piece.face) ? 'arriere' : piece.face];
    for (const face of faces) {
      const d: Decoupe = {
        forme,
        face: g.id === 'boite_couvercle' && face === 'dessus' ? 'couvercle' : face,
        largeur,
        hauteur,
        nombre: op.coins ? 4 : Math.min(Math.max(op.nombre ?? 1, 1), 6),
        u: op.coins ? 'centre' : (op.u ?? 'centre'),
        v: op.coins ? 'centre' : (op.v ?? 'centre'),
        ...(op.coins ? { coins: true } : {}),
      };
      liste.push(d);
      changements.push(`Ajout : ${direDecoupe(d, creux)}${propose ? ' (taille proposée)' : ''}`);
    }
  }
  if (liste.length > DECOUPES_MAX) erreurs.push(`Trop de découpes : ${DECOUPES_MAX} au plus sur une pièce.`);
  return { decoupes: liste, changements, erreurs };
}
