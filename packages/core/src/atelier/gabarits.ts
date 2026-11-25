/**
 * Atelier 3D : la bibliothèque de pièces réglables (cahier `docs/specs/atelier-3d.md`).
 *
 * Principe : **le gabarit fait la pièce, le modèle remplit les mesures.** Chaque gabarit décrit
 * ses mesures (bornes, valeur proposée, celles qu'il faut demander), sait dire la taille de la pièce,
 * refuse ce qui ne s'imprimerait pas, et écrit la pièce en OpenSCAD. OpenSCAD tourne ensuite comme
 * un programme à part sur le PC (jamais lié à l'application) pour produire le fichier 3D.
 *
 * Pur : aucune dépendance, aucun accès disque. Unités : millimètres et degrés.
 */

import { ajoutsDe, couvercleDe, direAjout, placerAjouts } from './ajouts.js';
import { decoupesDe, direDecoupe, placerDecoupes } from './decoupes.js';
import { ANGLE_MAX, ANGLE_MIN, CHOIX_HUB, dessinerBoitierEcran, type ChoixBoitierEcran } from './boitierEcran.js';

/** Volume d'impression de l'Ender 3 S1 Plus (fiche Creality) : 300 × 300 × 300 mm. */
export const ENDER3_S1_PLUS_VOLUME = { x: 300, y: 300, z: 300 } as const;

/** Paroi la plus fine acceptée : deux passages d'une buse de 0,4 mm. */
export const PAROI_MIN = 0.8;

export interface MesureNombre {
  id: string;
  /** Nom dit à l'utilisateur, au féminin ou masculin naturel : « hauteur », « diamètre du trou ». */
  nom: string;
  unite: 'mm' | '°' | '';
  min: number;
  max: number;
  defaut: number;
  entier?: boolean;
  /** Vrai : si la phrase ne la donne pas, Jarvis la demande (avec sa valeur proposée). */
  demander?: boolean;
  /** Mots qui la désignent dans une phrase (sans accent, minuscules), du plus précis au plus vague. */
  mots: string[];
}

export interface MesureChoix {
  id: string;
  nom: string;
  options: { valeur: string; mots: string[] }[];
  defaut: string;
  demander?: boolean;
}

export type Mesure = MesureNombre | MesureChoix;
export type Valeurs = Record<string, number | string>;

export interface Gabarit {
  id: string;
  nom: string;
  description: string;
  /** Mots qui désignent la pièce dans une phrase (sans accent). */
  mots: string[];
  mesures: Mesure[];
  /** Ordre des mesures pour « 80 par 50 par 30 » ou « 80 x 50 ». */
  suite: string[];
  taille(v: Valeurs): [number, number, number];
  /** Ce qui empêche de l'imprimer, en phrases simples. Vide : tout va bien. */
  verifier(v: Valeurs): string[];
  scad(v: Valeurs): string;
  /** Une phrase à ajouter à la fiche (sens d'impression inhabituel…), ou `null`. */
  note?(v: Valeurs): string | null;
}

export function estChoix(m: Mesure): m is MesureChoix {
  return 'options' in m;
}

/** Nombre écrit pour OpenSCAD : deux décimales au plus, jamais « NaN ». */
export function scadNombre(x: number): string {
  if (!Number.isFinite(x)) throw new Error('mesure invalide');
  return String(Math.round(x * 100) / 100);
}

function num(v: Valeurs, id: string): number {
  const value = v[id];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`mesure manquante : ${id}`);
  return value;
}

function m(
  id: string,
  nom: string,
  min: number,
  max: number,
  defaut: number,
  mots: string[],
  options: { unite?: MesureNombre['unite']; entier?: boolean; demander?: boolean } = {},
): MesureNombre {
  return { id, nom, unite: options.unite ?? 'mm', min, max, defaut, mots, entier: options.entier, demander: options.demander };
}

const LONGUEUR = ['longueur', 'long', 'longue'];
const LARGEUR = ['largeur', 'large'];
const HAUTEUR = ['hauteur', 'haut', 'haute'];
const PAROI = ['epaisseur des parois', 'epaisseur de paroi', 'paroi', 'parois', 'epaisseur', 'epais'];

const HEADER = '// Pièce écrite par Jarvis (atelier 3D). Unités : mm.\n$fn = 96;\n';

function boiteCreuse(L: number, W: number, H: number, e: number, f: number): string {
  return `difference() {\n  cube([${scadNombre(L)}, ${scadNombre(W)}, ${scadNombre(H)}]);\n  translate([${scadNombre(e)}, ${scadNombre(e)}, ${scadNombre(f)}]) cube([${scadNombre(L - 2 * e)}, ${scadNombre(W - 2 * e)}, ${scadNombre(H)}]);\n}\n`;
}

function verifBoite(L: number, W: number, H: number, e: number, f: number): string[] {
  const out: string[] = [];
  if (L - 2 * e < 2 || W - 2 * e < 2) out.push('Les parois sont trop épaisses pour cette taille : il ne reste pas de place à l’intérieur.');
  if (H - f < 1) out.push('Le fond est plus épais que la hauteur : il ne reste pas de creux.');
  return out;
}

const boite: Gabarit = {
  id: 'boite',
  nom: 'boîte',
  description: 'Boîte ouverte, à parois droites.',
  mots: ['boite', 'boitier', 'coffret', 'rangement'],
  mesures: [
    m('longueur', 'longueur', 10, 290, 80, LONGUEUR, { demander: true }),
    m('largeur', 'largeur', 10, 290, 50, LARGEUR, { demander: true }),
    m('hauteur', 'hauteur', 5, 290, 30, [...HAUTEUR, 'profondeur', 'profond'], { demander: true }),
    m('paroi', 'épaisseur des parois', PAROI_MIN, 10, 2, PAROI),
    m('fond', 'épaisseur du fond', 0.6, 10, 2, ['fond']),
  ],
  suite: ['longueur', 'largeur', 'hauteur'],
  taille: (v) => [num(v, 'longueur'), num(v, 'largeur'), num(v, 'hauteur')],
  verifier: (v) => verifBoite(num(v, 'longueur'), num(v, 'largeur'), num(v, 'hauteur'), num(v, 'paroi'), num(v, 'fond')),
  scad: (v) => HEADER + boiteCreuse(num(v, 'longueur'), num(v, 'largeur'), num(v, 'hauteur'), num(v, 'paroi'), num(v, 'fond')),
};

const boiteCouvercle: Gabarit = {
  id: 'boite_couvercle',
  nom: 'boîte avec couvercle',
  description: 'Boîte et son couvercle qui s’emboîte, imprimés côte à côte.',
  mots: ['boite avec couvercle', 'boite a couvercle', 'boitier avec couvercle', 'coffret avec couvercle'],
  mesures: [
    ...boite.mesures,
    m('jeu', 'jeu du couvercle', 0.1, 1, 0.3, ['jeu']),
    m('rebord', 'hauteur du rebord du couvercle', 3, 20, 6, ['rebord']),
    m('couvercle', 'épaisseur du couvercle', 1, 6, 2, ['epaisseur du couvercle']),
  ],
  suite: ['longueur', 'largeur', 'hauteur'],
  taille: (v) => {
    const L = num(v, 'longueur');
    const c = couvercleDe(v);
    // Couvercle posé sur un rebord intérieur : une plaque plus petite que la boîte, sans lèvre.
    if (c.plat) return [2 * L + 10 - 2 * num(v, 'paroi') - 2 * c.jeu, num(v, 'largeur'), num(v, 'hauteur')];
    return [2 * L + 10, num(v, 'largeur'), Math.max(num(v, 'hauteur'), num(v, 'couvercle') + num(v, 'rebord'))];
  },
  verifier: (v) => {
    const out = verifBoite(num(v, 'longueur'), num(v, 'largeur'), num(v, 'hauteur'), num(v, 'paroi'), num(v, 'fond'));
    const e = num(v, 'paroi');
    const j = num(v, 'jeu');
    if (num(v, 'longueur') - 4 * e - 2 * j < 1 || num(v, 'largeur') - 4 * e - 2 * j < 1) {
      out.push('Le rebord du couvercle ne tient pas dans la boîte : agrandis la boîte ou affine les parois.');
    }
    if (num(v, 'rebord') >= num(v, 'hauteur') - num(v, 'fond')) out.push('Le rebord du couvercle est plus haut que l’intérieur de la boîte.');
    return out;
  },
  scad: (v) => {
    const L = num(v, 'longueur');
    const W = num(v, 'largeur');
    const e = num(v, 'paroi');
    const t = num(v, 'couvercle');
    const r = num(v, 'rebord');
    // La lèvre : épaisseur et jeu par côté (la paroi et le jeu réglé, ou l'emboîtement de 1,2 mm).
    const c = couvercleDe(v);
    const j = c.jeu;
    const k = c.levre;
    const li = L - 2 * e - 2 * j;
    const wi = W - 2 * e - 2 * j;
    const boite = HEADER + '// La boîte\n' + boiteCreuse(L, W, num(v, 'hauteur'), e, num(v, 'fond'));
    if (c.plat) {
      return (
        boite +
        '// Le couvercle, à côté : une plaque posée sur le rebord intérieur\n' +
        `translate([${scadNombre(L + 10)}, ${scadNombre(e + j)}, 0]) cube([${scadNombre(li)}, ${scadNombre(wi)}, ${scadNombre(t)}]);\n`
      );
    }
    return (
      boite +
      '// Le couvercle, à côté\n' +
      `translate([${scadNombre(L + 10)}, 0, 0]) union() {\n  cube([${scadNombre(L)}, ${scadNombre(W)}, ${scadNombre(t)}]);\n  translate([${scadNombre(e + j)}, ${scadNombre(e + j)}, ${scadNombre(t)}]) difference() {\n    cube([${scadNombre(li)}, ${scadNombre(wi)}, ${scadNombre(r)}]);\n    translate([${scadNombre(k)}, ${scadNombre(k)}, -1]) cube([${scadNombre(li - 2 * k)}, ${scadNombre(wi - 2 * k)}, ${scadNombre(r + 2)}]);\n  }\n}\n`
    );
  },
};

const bac: Gabarit = {
  id: 'bac',
  nom: 'bac à compartiments',
  description: 'Bac ouvert, partagé en cases égales.',
  mots: ['bac', 'organiseur', 'compartiments', 'compartiment', 'cases', 'casier', 'tri'],
  mesures: [
    m('longueur', 'longueur', 20, 290, 160, LONGUEUR, { demander: true }),
    m('largeur', 'largeur', 20, 290, 100, LARGEUR, { demander: true }),
    m('hauteur', 'hauteur', 5, 200, 40, [...HAUTEUR, 'profondeur', 'profond'], { demander: true }),
    m('colonnes', 'nombre de colonnes', 1, 12, 2, ['colonnes', 'colonne', 'compartiments', 'compartiment', 'cases', 'case'], { unite: '', entier: true, demander: true }),
    m('rangees', 'nombre de rangées', 1, 12, 1, ['rangees', 'rangee', 'lignes', 'ligne'], { unite: '', entier: true }),
    m('paroi', 'épaisseur des parois', PAROI_MIN, 10, 2, PAROI),
    m('fond', 'épaisseur du fond', 0.6, 10, 2, ['fond']),
    m('cloison', 'épaisseur des cloisons', PAROI_MIN, 5, 1.2, ['cloison', 'cloisons', 'separation', 'separations']),
  ],
  suite: ['longueur', 'largeur', 'hauteur'],
  taille: (v) => [num(v, 'longueur'), num(v, 'largeur'), num(v, 'hauteur')],
  verifier: (v) => {
    const out = verifBoite(num(v, 'longueur'), num(v, 'largeur'), num(v, 'hauteur'), num(v, 'paroi'), num(v, 'fond'));
    const caseL = (num(v, 'longueur') - 2 * num(v, 'paroi')) / num(v, 'colonnes');
    const caseW = (num(v, 'largeur') - 2 * num(v, 'paroi')) / num(v, 'rangees');
    if (caseL < 5 || caseW < 5) out.push('Trop de cases pour cette taille : chaque case ferait moins de 5 mm.');
    return out;
  },
  scad: (v) => {
    const L = num(v, 'longueur');
    const W = num(v, 'largeur');
    const H = num(v, 'hauteur');
    const e = num(v, 'paroi');
    const k = num(v, 'cloison');
    const c = num(v, 'colonnes');
    const r = num(v, 'rangees');
    let body = HEADER + 'union() {\n' + boiteCreuse(L, W, H, e, num(v, 'fond')).replace(/^/gm, '  ');
    if (c > 1) body += `  for (i = [1 : ${c - 1}]) translate([${scadNombre(e)} + i * ${scadNombre((L - 2 * e) / c)} - ${scadNombre(k / 2)}, ${scadNombre(e)}, 0]) cube([${scadNombre(k)}, ${scadNombre(W - 2 * e)}, ${scadNombre(H)}]);\n`;
    if (r > 1) body += `  for (j = [1 : ${r - 1}]) translate([${scadNombre(e)}, ${scadNombre(e)} + j * ${scadNombre((W - 2 * e) / r)} - ${scadNombre(k / 2)}, 0]) cube([${scadNombre(L - 2 * e)}, ${scadNombre(k)}, ${scadNombre(H)}]);\n`;
    return body + '}\n';
  },
};

const entretoise: Gabarit = {
  id: 'entretoise',
  nom: 'entretoise',
  description: 'Cylindre percé (entretoise, rondelle, bague). Trou à 0 : cylindre plein.',
  mots: ['entretoise', 'rondelle', 'bague', 'cylindre', 'tube'],
  mesures: [
    m('diametre', 'diamètre extérieur', 3, 280, 12, ['diametre exterieur', 'diametre ext', 'diametre', 'diam'], { demander: true }),
    m('trou', 'diamètre du trou', 0, 270, 4, ['diametre du trou', 'diametre interieur', 'trou', 'percage', 'vis de', 'vis'], { demander: true }),
    m('hauteur', 'hauteur', 0.6, 200, 5, [...HAUTEUR, 'epaisseur', 'epais', 'longueur', 'long']),
  ],
  suite: ['diametre', 'trou', 'hauteur'],
  taille: (v) => [num(v, 'diametre'), num(v, 'diametre'), num(v, 'hauteur')],
  verifier: (v) => {
    const trou = num(v, 'trou');
    if (trou > 0 && trou > num(v, 'diametre') - 2 * PAROI_MIN) return ['Le trou est trop grand pour le diamètre : la paroi ferait moins de 0,8 mm.'];
    return [];
  },
  scad: (v) => {
    const D = num(v, 'diametre');
    const d = num(v, 'trou');
    const H = num(v, 'hauteur');
    if (d <= 0) return HEADER + `cylinder(h = ${scadNombre(H)}, d = ${scadNombre(D)});\n`;
    return HEADER + `difference() {\n  cylinder(h = ${scadNombre(H)}, d = ${scadNombre(D)});\n  translate([0, 0, -1]) cylinder(h = ${scadNombre(H + 2)}, d = ${scadNombre(d)});\n}\n`;
  },
};

const equerre: Gabarit = {
  id: 'equerre',
  nom: 'équerre',
  description: 'Équerre à deux branches, un trou de vis par branche (trou à 0 : sans trou).',
  mots: ['equerre', 'angle de fixation', 'corniere'],
  mesures: [
    m('branche1', 'longueur de la première branche', 15, 250, 40, ['premiere branche', 'branche', 'longueur', 'long'], { demander: true }),
    m('branche2', 'longueur de la deuxième branche', 15, 250, 40, ['deuxieme branche', 'seconde branche', 'autre branche'], { demander: true }),
    m('largeur', 'largeur', 8, 150, 20, LARGEUR),
    m('epaisseur', 'épaisseur', 2, 15, 4, ['epaisseur', 'epais']),
    m('trou', 'diamètre des trous', 0, 12, 4, ['trous', 'trou', 'vis', 'percage']),
  ],
  suite: ['branche1', 'branche2', 'largeur'],
  taille: (v) => [num(v, 'branche1'), num(v, 'largeur'), num(v, 'branche2')],
  verifier: (v) => {
    const out: string[] = [];
    const t = num(v, 'epaisseur');
    const d = num(v, 'trou');
    if (num(v, 'branche1') < t + d + 4 || num(v, 'branche2') < t + d + 4) out.push('Les branches sont trop courtes pour leur trou.');
    if (num(v, 'largeur') < d + 4) out.push('L’équerre est trop étroite pour ses trous.');
    return out;
  },
  scad: (v) => {
    const A = num(v, 'branche1');
    const B = num(v, 'branche2');
    const l = num(v, 'largeur');
    const t = num(v, 'epaisseur');
    const d = num(v, 'trou');
    let s = HEADER + `difference() {\n  union() {\n    cube([${scadNombre(A)}, ${scadNombre(l)}, ${scadNombre(t)}]);\n    cube([${scadNombre(t)}, ${scadNombre(l)}, ${scadNombre(B)}]);\n  }\n`;
    if (d > 0) {
      s += `  translate([${scadNombre(t + (A - t) / 2)}, ${scadNombre(l / 2)}, -1]) cylinder(h = ${scadNombre(t + 2)}, d = ${scadNombre(d)});\n`;
      s += `  translate([-1, ${scadNombre(l / 2)}, ${scadNombre(t + (B - t) / 2)}]) rotate([0, 90, 0]) cylinder(h = ${scadNombre(t + 2)}, d = ${scadNombre(d)});\n`;
    }
    return s + '}\n';
  },
};

const crochet: Gabarit = {
  id: 'crochet',
  nom: 'crochet mural',
  description: 'Crochet à visser au mur : une plaque, un bras, un bout relevé.',
  mots: ['crochet', 'patere', 'porte manteau', 'accroche'],
  mesures: [
    m('largeur', 'largeur', 10, 120, 25, LARGEUR),
    m('hauteur', 'hauteur de la plaque', 20, 200, 60, HAUTEUR, { demander: true }),
    m('avancee', 'avancée du crochet', 10, 150, 30, ['avancee', 'profondeur', 'profond', 'depasse', 'longueur', 'long'], { demander: true }),
    m('bout', 'hauteur du bout relevé', 3, 40, 10, ['bout', 'rebord']),
    m('epaisseur', 'épaisseur', 2, 12, 4, ['epaisseur', 'epais']),
    m('vis', 'diamètre des vis', 0, 8, 4, ['vis', 'trou', 'trous']),
  ],
  suite: ['largeur', 'hauteur', 'avancee'],
  taille: (v) => [num(v, 'avancee'), num(v, 'largeur'), num(v, 'hauteur')],
  verifier: (v) => {
    const out: string[] = [];
    if (num(v, 'largeur') < num(v, 'vis') + 4) out.push('Le crochet est trop étroit pour ses vis.');
    if (num(v, 'avancee') <= 2 * num(v, 'epaisseur')) out.push('Le crochet n’avance pas assez pour accrocher quelque chose.');
    if (num(v, 'hauteur') < 3 * num(v, 'vis') + 10) out.push('La plaque est trop petite pour deux vis.');
    return out;
  },
  scad: (v) => {
    const w = num(v, 'largeur');
    const h = num(v, 'hauteur');
    const p = num(v, 'avancee');
    const b = num(v, 'bout');
    const t = num(v, 'epaisseur');
    const d = num(v, 'vis');
    let s = HEADER + `difference() {\n  union() {\n    cube([${scadNombre(t)}, ${scadNombre(w)}, ${scadNombre(h)}]);\n    cube([${scadNombre(p)}, ${scadNombre(w)}, ${scadNombre(t)}]);\n    translate([${scadNombre(p - t)}, 0, 0]) cube([${scadNombre(t)}, ${scadNombre(w)}, ${scadNombre(t + b)}]);\n  }\n`;
    if (d > 0) {
      for (const z of [h - Math.max(8, 2 * d), h / 2 + t / 2]) {
        s += `  translate([-1, ${scadNombre(w / 2)}, ${scadNombre(z)}]) rotate([0, 90, 0]) cylinder(h = ${scadNombre(t + 2)}, d = ${scadNombre(d)});\n`;
      }
    }
    return s + '}\n';
  },
};

const RAD = Math.PI / 180;

const supportTelephone: Gabarit = {
  id: 'support_telephone',
  nom: 'support de téléphone',
  description: 'Support de téléphone posé sur la table, incliné, avec une rainure pour le téléphone.',
  mots: ['support de telephone', 'support telephone', 'support pour telephone', 'support de portable', 'support pour portable', 'support de smartphone', 'support smartphone', 'support pour mon telephone', 'support pour mon portable'],
  mesures: [
    m('largeur', 'largeur', 40, 200, 80, LARGEUR),
    m('angle', 'inclinaison', 40, 80, 60, ['inclinaison', 'incline a', 'incline', 'angle'], { unite: '°', demander: true }),
    m('rainure', 'épaisseur du téléphone (rainure)', 5, 25, 12, ['rainure', 'epaisseur du telephone', 'epaisseur du portable', 'telephone de', 'coque']),
    m('dos', 'hauteur du dossier', 40, 160, 90, ['dossier', 'dos', ...HAUTEUR]),
    m('base', 'profondeur de la base', 40, 160, 90, ['base', 'profondeur', 'profond']),
  ],
  suite: ['largeur', 'dos', 'base'],
  // Même géométrie que `scad` : le dossier (t × dos) tourne de (90° − angle) autour de son coin
  // bas, en x = t + rainure. Son coin haut arrière monte à dos·sin(angle) ; en longueur, il
  // avance de dos·cos(angle) + t·sin(angle). La lèvre avant monte à t + lip.
  // Sous 45°, la pièce s'imprime couchée sur le côté (voir `supportCouche`) : hauteur et largeur s'échangent.
  taille: (v) => {
    const [x, y, z] = tailleSupportDebout(v);
    return supportCouche(v) ? [x, z, y] : [x, y, z];
  },
  note: (v) =>
    supportCouche(v)
      ? `Il s’imprime couché sur le côté (cotes dans ce sens) : à ${String(num(v, 'angle')).replace('.', ',')}°, le dossier debout pencherait trop pour s’imprimer sans support.`
      : null,
  verifier: (v) => {
    const a = num(v, 'angle') * RAD;
    const reach = 4 + num(v, 'rainure') + num(v, 'dos') * Math.cos(a) * 0.6;
    return num(v, 'base') < reach ? ['La base est trop courte : le support basculerait en arrière. Allonge la base.'] : [];
  },
  scad: (v) => {
    const t = 4;
    const lip = 12;
    const w = num(v, 'largeur');
    const e = num(v, 'rainure');
    const h = num(v, 'dos');
    const p = num(v, 'base');
    const tilt = 90 - num(v, 'angle');
    const piece = `intersection() {\n  union() {\n    cube([${scadNombre(p)}, ${scadNombre(w)}, ${scadNombre(t)}]);\n    cube([${scadNombre(t)}, ${scadNombre(w)}, ${scadNombre(t + lip)}]);\n    translate([${scadNombre(t + e)}, 0, 0]) rotate([0, ${scadNombre(tilt)}, 0]) cube([${scadNombre(t)}, ${scadNombre(w)}, ${scadNombre(h)}]);\n  }\n  translate([-1, -1, 0]) cube([1000, ${scadNombre(w + 2)}, 1000]);\n}\n`;
    if (!supportCouche(v)) return HEADER + piece;
    // Couché sur le côté : son profil (le même sur toute la largeur) à plat sur le plateau.
    const z = tailleSupportDebout(v)[2];
    return `${HEADER}// Imprimé couché sur le côté : le dossier debout demanderait un support.\ntranslate([0, ${scadNombre(z)}, 0]) rotate([90, 0, 0]) {\n${piece}}\n`;
  },
};

/** Le support debout : longueur, largeur, hauteur. */
function tailleSupportDebout(v: Valeurs): [number, number, number] {
  const t = 4;
  const lip = 12;
  const a = num(v, 'angle') * RAD;
  const dos = num(v, 'dos');
  const bout = t + num(v, 'rainure') + dos * Math.cos(a) + t * Math.sin(a);
  return [Math.max(num(v, 'base'), bout), num(v, 'largeur'), Math.max(dos * Math.sin(a), t + lip)];
}

/**
 * Sous 45°, le dessous du dossier penche de plus de 45° : debout, il faudrait un support
 * d'impression (grand contrôle du 24 novembre, variante à 40°). Le support est un profil tiré sur
 * toute sa largeur : couché sur le côté, il s'imprime sans aucun surplomb.
 */
function supportCouche(v: Valeurs): boolean {
  return num(v, 'angle') < 45;
}

const socle: Gabarit = {
  id: 'socle',
  nom: 'socle',
  description: 'Socle rond ou carré, avec un logement creusé dessus si besoin (logement à 0 : plein).',
  mots: ['socle', 'pied', 'support rond', 'presentoir', 'base pour'],
  mesures: [
    { id: 'forme', nom: 'forme', defaut: 'rond', options: [
      { valeur: 'rond', mots: ['rond', 'ronde', 'circulaire', 'cylindrique'] },
      { valeur: 'carre', mots: ['carre', 'carree', 'rectangulaire'] },
    ], demander: true },
    m('taille', 'diamètre ou côté', 20, 280, 80, ['diametre', 'diam', 'cote', 'taille', 'large', 'largeur'], { demander: true }),
    m('hauteur', 'hauteur', 3, 100, 15, [...HAUTEUR, 'epaisseur', 'epais']),
    m('logement', 'taille du logement', 0, 270, 0, ['logement', 'creux', 'emplacement', 'empreinte']),
    m('profondeur', 'profondeur du logement', 0, 90, 5, ['profondeur', 'profond']),
  ],
  suite: ['taille', 'hauteur'],
  taille: (v) => [num(v, 'taille'), num(v, 'taille'), num(v, 'hauteur')],
  verifier: (v) => {
    const out: string[] = [];
    if (num(v, 'logement') > 0 && num(v, 'logement') > num(v, 'taille') - 4) out.push('Le logement est trop grand pour le socle : il faut au moins 2 mm de bord.');
    if (num(v, 'logement') > 0 && num(v, 'profondeur') > num(v, 'hauteur') - 1) out.push('Le logement est plus profond que le socle.');
    return out;
  },
  scad: (v) => {
    const T = num(v, 'taille');
    const H = num(v, 'hauteur');
    const L = num(v, 'logement');
    const P = num(v, 'profondeur');
    const rond = v.forme !== 'carre';
    const corps = rond ? `cylinder(h = ${scadNombre(H)}, d = ${scadNombre(T)})` : `translate([${scadNombre(-T / 2)}, ${scadNombre(-T / 2)}, 0]) cube([${scadNombre(T)}, ${scadNombre(T)}, ${scadNombre(H)}])`;
    if (L <= 0 || P <= 0) return HEADER + `${corps};\n`;
    const creux = rond
      ? `translate([0, 0, ${scadNombre(H - P)}]) cylinder(h = ${scadNombre(P + 1)}, d = ${scadNombre(L)})`
      : `translate([${scadNombre(-L / 2)}, ${scadNombre(-L / 2)}, ${scadNombre(H - P)}]) cube([${scadNombre(L)}, ${scadNombre(L)}, ${scadNombre(P + 1)}])`;
    return HEADER + `difference() {\n  ${corps};\n  ${creux};\n}\n`;
  },
};

const porteEtiquette: Gabarit = {
  id: 'porte_etiquette',
  nom: 'porte-étiquette',
  description: 'Porte-étiquette à coller, où l’étiquette se glisse par le haut.',
  mots: ['porte etiquette', 'porte etiquettes', 'etiquette', 'etiquettes'],
  mesures: [
    m('largeur', 'largeur de l’étiquette', 20, 200, 60, LARGEUR, { demander: true }),
    m('hauteur', 'hauteur de l’étiquette', 10, 120, 25, HAUTEUR, { demander: true }),
    m('epaisseur', 'épaisseur', 1.2, 5, 2, ['epaisseur', 'epais']),
    m('rebord', 'largeur du rebord', 1, 6, 2, ['rebord']),
  ],
  suite: ['largeur', 'hauteur'],
  taille: (v) => [num(v, 'largeur') + 4, num(v, 'hauteur') + 2, 2 * num(v, 'epaisseur') + 1],
  verifier: (v) => (num(v, 'largeur') - 2 * num(v, 'rebord') < 10 ? ['Les rebords cachent presque toute l’étiquette.'] : []),
  scad: (v) => {
    const w = num(v, 'largeur') + 4;
    const h = num(v, 'hauteur') + 2;
    const t = num(v, 'epaisseur');
    const r = num(v, 'rebord');
    const g = 1;
    return (
      HEADER +
      `union() {\n  cube([${scadNombre(w)}, ${scadNombre(h)}, ${scadNombre(t)}]);\n  cube([2, ${scadNombre(h)}, ${scadNombre(2 * t + g)}]);\n  translate([${scadNombre(w - 2)}, 0, 0]) cube([2, ${scadNombre(h)}, ${scadNombre(2 * t + g)}]);\n  cube([${scadNombre(w)}, 2, ${scadNombre(2 * t + g)}]);\n  translate([0, 0, ${scadNombre(t + g)}]) cube([${scadNombre(r + 2)}, ${scadNombre(h)}, ${scadNombre(t)}]);\n  translate([${scadNombre(w - r - 2)}, 0, ${scadNombre(t + g)}]) cube([${scadNombre(r + 2)}, ${scadNombre(h)}, ${scadNombre(t)}]);\n  translate([0, 0, ${scadNombre(t + g)}]) cube([${scadNombre(w)}, ${scadNombre(r + 2)}, ${scadNombre(t)}]);\n}\n`
    );
  },
};

const cale: Gabarit = {
  id: 'cale',
  nom: 'cale',
  description: 'Cale en biseau (bas à 0 : pointe).',
  mots: ['cale', 'biseau', 'coin de porte', 'butee'],
  mesures: [
    m('longueur', 'longueur', 10, 250, 60, LONGUEUR, { demander: true }),
    m('largeur', 'largeur', 5, 200, 30, LARGEUR),
    m('haut', 'hauteur du côté haut', 1, 100, 10, ['cote haut', 'hauteur', 'haut', 'haute', 'epaisseur', 'epais'], { demander: true }),
    m('bas', 'hauteur du côté bas', 0, 100, 2, ['cote bas', 'bas', 'pointe']),
  ],
  suite: ['longueur', 'largeur', 'haut'],
  taille: (v) => [num(v, 'longueur'), num(v, 'largeur'), Math.max(num(v, 'haut'), num(v, 'bas'))],
  verifier: () => [],
  scad: (v) => {
    const L = num(v, 'longueur');
    const W = num(v, 'largeur');
    return HEADER + `translate([0, ${scadNombre(W)}, 0]) rotate([90, 0, 0]) linear_extrude(height = ${scadNombre(W)}) polygon([[0, 0], [${scadNombre(L)}, 0], [${scadNombre(L)}, ${scadNombre(num(v, 'bas'))}], [0, ${scadNombre(num(v, 'haut'))}]]);\n`;
  },
};

/** Les choix d'un boîtier à écran, lus dans ses valeurs. */
export function choixBoitierEcran(v: Valeurs): ChoixBoitierEcran {
  return {
    angle: typeof v.inclinaison === 'number' ? v.inclinaison : CHOIX_HUB.angle,
    ports: v.ports === 'cote' ? 'cote' : 'arriere',
    camera: v.camera !== 'non',
    cache: v.cache !== 'non',
  };
}

/**
 * Le boîtier à écran (le hub de la mission des boîtiers) : un ensemble de pièces, dessiné par
 * `boitierEcran.ts`. Il n'est pas rendu d'un seul bloc : chaque pièce a son fichier, et le
 * contrôle complet (`bancBoitierEcran.ts`) passe avant de le montrer. `scad` écrit le boîtier monté.
 */
const boitierEcran: Gabarit = {
  id: 'boitier_ecran',
  nom: 'boîtier à écran',
  description: 'Boîtier pour un Raspberry Pi 5 avec l’écran tactile 7 pouces (et la caméra) : écran incliné sur un socle.',
  mots: ['boitier a ecran', 'boitier pour ecran tactile'],
  mesures: [
    m(
      'inclinaison',
      'inclinaison de l’écran',
      ANGLE_MIN,
      ANGLE_MAX,
      CHOIX_HUB.angle,
      ['inclinaison de l ecran', 'incline l ecran de', 'incline l ecran a', 'ecran incline de', 'ecran incline a', 'inclinaison', 'incline de', 'incline a', 'penche de', 'angle'],
      { unite: '°' },
    ),
    {
      id: 'ports',
      nom: 'côté des prises',
      options: [
        { valeur: 'cote', mots: ['sur le cote', 'sur les cotes', 'sur le flanc', 'laterales', 'lateraux'] },
        { valeur: 'arriere', mots: ['a l arriere', 'derriere', 'vers l arriere', 'au dos'] },
      ],
      defaut: 'arriere',
    },
    {
      id: 'camera',
      nom: 'caméra',
      options: [
        { valeur: 'non', mots: ['sans camera', 'pas de camera', 'enleve la camera', 'retire la camera'] },
        { valeur: 'oui', mots: ['camera'] },
      ],
      defaut: 'non',
    },
    {
      id: 'cache',
      nom: 'cache de la caméra',
      options: [
        { valeur: 'non', mots: ['sans cache', 'pas de cache', 'enleve le cache', 'retire le cache'] },
        { valeur: 'oui', mots: ['avec cache', 'avec un cache', 'remets le cache', 'ajoute un cache', 'ajoute le cache'] },
      ],
      defaut: 'oui',
    },
  ],
  suite: [],
  taille: (v) => dessinerBoitierEcran(choixBoitierEcran(v)).encombrement,
  verifier: () => [],
  scad: (v) => dessinerBoitierEcran(choixBoitierEcran(v)).scadAssemblage(),
};

/** Les gabarits, du plus précis au plus vague (« boîte avec couvercle » avant « boîte »). */
export const GABARITS: readonly Gabarit[] = [boitierEcran, boiteCouvercle, supportTelephone, porteEtiquette, bac, boite, entretoise, equerre, crochet, socle, cale];

export function gabarit(id: string): Gabarit | undefined {
  return GABARITS.find((g) => g.id === id);
}

export type Piece =
  | { ok: true; gabarit: Gabarit; valeurs: Valeurs; taille: [number, number, number]; scad: string; notes?: string[] }
  | { ok: false; gabarit: Gabarit; erreurs: string[] };

function unite(mesure: MesureNombre, x: number): string {
  const s = String(x).replace('.', ',');
  return mesure.unite === 'mm' ? `${s} mm` : mesure.unite === '°' ? `${s}°` : s;
}

/**
 * Complète avec les valeurs proposées, vérifie les bornes et l'impression, puis écrit la pièce.
 * Une mesure hors bornes n'est jamais ramenée en silence : c'est une erreur dite.
 */
export interface VolumeImpression {
  x: number;
  y: number;
  z: number;
}

/**
 * `volume` : la surface réellement réglée dans le trancheur de l'utilisateur (lue dans son
 * préréglage d'imprimante OrcaSlicer), pour que l'atelier ne propose jamais une pièce que le
 * trancheur refuserait. Absent : le volume de la fiche de l'Ender 3 S1 Plus.
 */
export function fabriquer(g: Gabarit, donnees: Valeurs, volume: VolumeImpression = ENDER3_S1_PLUS_VOLUME): Piece {
  const valeurs: Valeurs = {};
  const erreurs: string[] = [];
  for (const mesure of g.mesures) {
    const given = donnees[mesure.id];
    if (estChoix(mesure)) {
      const choix = typeof given === 'string' && mesure.options.some((o) => o.valeur === given) ? given : mesure.defaut;
      valeurs[mesure.id] = choix;
      continue;
    }
    const value = typeof given === 'number' && Number.isFinite(given) ? given : mesure.defaut;
    if (mesure.entier && !Number.isInteger(value)) erreurs.push(`Le ${mesure.nom} doit être un nombre entier.`);
    if (value < mesure.min || value > mesure.max) {
      erreurs.push(`${mesure.nom[0]!.toUpperCase()}${mesure.nom.slice(1)} : ${unite(mesure, value)}, hors des limites (de ${unite(mesure, mesure.min)} à ${unite(mesure, mesure.max)}).`);
    }
    valeurs[mesure.id] = value;
  }
  if (erreurs.length) return { ok: false, gabarit: g, erreurs };
  // Les découpes (trous, ouvertures, encoches) suivent les versions avec les mesures.
  if (typeof donnees.decoupes === 'string' && donnees.decoupes) valeurs.decoupes = donnees.decoupes;
  // Les ajouts (bossages, plots, nervures, rebord, emboîtement) aussi.
  if (typeof donnees.ajouts === 'string' && donnees.ajouts) valeurs.ajouts = donnees.ajouts;
  erreurs.push(...g.verifier(valeurs));
  const decoupes = placerDecoupes(g.id, g.nom, valeurs, decoupesDe(valeurs));
  erreurs.push(...decoupes.erreurs);
  const ajouts = placerAjouts(g.id, valeurs);
  erreurs.push(...ajouts.erreurs);
  const taille = g.taille(valeurs);
  const V = volume;
  if (taille[0] > V.x || taille[1] > V.y || taille[2] > V.z) {
    erreurs.push(`La pièce ne tient pas dans l’imprimante (${taille.map((x) => Math.ceil(x)).join(' × ')} mm pour ${V.x} × ${V.y} × ${V.z} mm).`);
  }
  if (erreurs.length) return { ok: false, gabarit: g, erreurs };
  return {
    ok: true,
    gabarit: g,
    valeurs,
    taille,
    scad: avecLesDecoupes(g.scad(valeurs), [...decoupes.scad, ...ajouts.moins], ajouts.plus),
    ...(ajouts.notes.length || g.note?.(valeurs) ? { notes: [...ajouts.notes, ...(g.note?.(valeurs) ? [g.note(valeurs)!] : [])] } : {}),
  };
}

/**
 * La pièce, plus ses ajouts, moins ses découpes : `difference() { union() { pièce ; ajouts } ;
 * découpes }`. Sans ajout ni découpe : la pièce telle quelle.
 */
function avecLesDecoupes(scad: string, decoupes: string[], ajouts: string[] = []): string {
  if (!decoupes.length && !ajouts.length) return scad;
  const corps = scad.startsWith(HEADER) ? scad.slice(HEADER.length) : scad;
  const retrait = (texte: string) => texte.replace(/^(?=.)/gm, '    ');
  const plus = ajouts.map((a) => `    ${a}\n`).join('');
  return `${HEADER}// La pièce${ajouts.length ? ', plus ses ajouts' : ''}, moins ses découpes (trous, ouvertures, encoches)\ndifference() {\n  union() {\n${retrait(corps)}${plus}  }\n${decoupes.map((d) => `  ${d}\n`).join('')}}\n`;
}

/** Une phrase qui résume la pièce : « Boîte de 80 × 50 × 30 mm, parois de 2 mm. » */
export function fichePiece(piece: Extract<Piece, { ok: true }>): string {
  const [x, y, z] = piece.taille.map((v) => String(Math.round(v * 10) / 10).replace('.', ','));
  const nom = piece.gabarit.nom;
  // Boîte avec couvercle : la taille de la pièce compte la boîte et le couvercle côte à côte sur le
  // plateau (« de 210 × 60 × 40 » pour une boîte de 100 de long). On dit les cotes de la boîte.
  const dit = (id: string) => String(Math.round(Number(piece.valeurs[id]) * 10) / 10).replace('.', ',');
  const base =
    piece.gabarit.id === 'boite_couvercle' && ['longueur', 'largeur', 'hauteur'].every((id) => typeof piece.valeurs[id] === 'number')
      ? `${nom[0]!.toUpperCase()}${nom.slice(1)} de ${dit('longueur')} × ${dit('largeur')} × ${dit('hauteur')} mm (boîte et couvercle côte à côte sur le plateau : ${x} × ${y} mm).`
      : `${nom[0]!.toUpperCase()}${nom.slice(1)} de ${x} × ${y} × ${z} mm.`;
  // Les ajouts, puis les vis à prévoir (« Couvercle : 4 vis M3 × 6 à tête fraisée… »).
  const ajouts = ajoutsDe(piece.valeurs);
  const avecAjouts = ajouts.length === 1 ? ` Avec ${direAjout(ajouts[0]!)}.` : ajouts.length > 1 ? ` Avec ${ajouts.map(direAjout).join(', ')}.` : '';
  const notes = piece.notes?.length ? ` ${piece.notes.join(' ')}` : '';
  const fiche = `${base}${avecAjouts}${notes}`;
  const decoupes = decoupesDe(piece.valeurs);
  if (!decoupes.length) return fiche;
  const creux = ['boite', 'boite_couvercle', 'bac'].includes(piece.gabarit.id);
  if (decoupes.length > 1) return `${fiche} Avec ${decoupes.length} découpes.`;
  const d = decoupes[0]!;
  const article = d.nombre > 1 ? '' : d.forme === 'rond' ? 'un ' : 'une ';
  return `${fiche} Avec ${article}${direDecoupe(d, creux)}.`;
}
