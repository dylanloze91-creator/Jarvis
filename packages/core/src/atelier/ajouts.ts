/**
 * Atelier 3D : la matière ajoutée dans une boîte (bossages à insert, plots de carte, nervures,
 * rebord intérieur qui porte un couvercle, couvercle qui s'emboîte).
 *
 * « Ajoute quatre bossages avec insert M3 à 7 mm des coins », « 4 plots M2,5 avec un entraxe de
 * 58 par 49 », « une nervure de 8 mm dans la longueur », « un rebord intérieur pour le couvercle »,
 * « fais que le couvercle s'emboîte », « le bossage plus haut », « enlève les plots ».
 *
 * Comme les découpes (`decoupes.ts`), les ajouts sont gardés dans les mesures de la pièce, sous
 * `ajouts` (texte JSON), et suivent les versions. Repère de la boîte : x de 0 à la longueur
 * (gauche → droite, vu de face), y de 0 à la largeur (avant → arrière), z de 0 à la hauteur.
 * Le couvercle d'une boîte à couvercle est imprimé à côté, retourné : (x, y) de la boîte fermée
 * devient (longueur + 10 + x, largeur − y).
 *
 * Pur : aucune dépendance, aucun accès disque.
 */
import type { Valeurs } from './gabarits.js';
import { composant, composantNomme, geometrieCarte, poserCarte, prochaineMesure, PLOT_CARTE, questionMesure, type MesuresComposant, type MesuresComposants, type Paroi } from './composants.js';
import { AVANT_TROU, choisirVisM3, INSERT_M3, PAROI_INSERT_MIN, VIS_M3_FRAISEE, VIS_M3_PASSAGE, type VisCarte } from './visserie.js';

export type GenreAjout = 'bossages' | 'plots' | 'nervure' | 'rebord' | 'emboitement' | 'composant';

export interface Ajout {
  genre: GenreAjout;
  /** Bossages : centre à `distance` mm des deux bords extérieurs, aux quatre coins. */
  distance?: number;
  /** Bossages, plots, nervure : hauteur au-dessus du fond (mm). Absente : choisie par l'atelier. */
  hauteur?: number;
  /** Bossages, plots : diamètre extérieur (mm). */
  diametre?: number;
  /** Plots : vis autotaraudeuse de la carte. */
  vis?: VisCarte;
  /** Plots : écart des trous (x, y) en mm. */
  entraxe?: [number, number];
  /** Plots : trou avant-gauche (vu de dessus). Nervure : sa place. Depuis les bords extérieurs (mm). */
  depuisGauche?: number;
  depuisAvant?: number;
  /** Nervure : dans la longueur (le long de x) ou dans la largeur (le long de y). */
  sens?: 'longueur' | 'largeur';
  /** Nervure : épaisseur. Rebord : épaisseur du couvercle posé dessus (boîte sans couvercle). */
  epaisseur?: number;
  /** Composant de la bibliothèque (`composants.ts`) posé dans la boîte, et la paroi de ses prises. */
  composant?: string;
  ports?: Paroi;
  /** Mesures de l'utilisateur pour un composant « à mesurer », recopiées à la pose (la pièce reste juste même si le fichier change). */
  mesures?: MesuresComposant;
}

/** Rebord intérieur : largeur d'appui et épaisseur, chanfrein à 45° dessous (sans support). */
export const REBORD_LARGEUR = 1.5;
export const REBORD_EP = 1.5;
/** Couvercle posé sur le rebord d'une boîte sans couvercle dessiné : épaisseur supposée (mm). */
export const COUVERCLE_POSE_EP = 2.5;
/** Emboîtement : lèvre de 1,2 mm, 0,25 mm de jeu par côté (mission des boîtiers). */
export const LEVRE_EP = 1.2;
export const LEVRE_JEU = 0.25;
/** Jeu autour d'un bossage dans l'entaille de la lèvre (mm). */
const ENTAILLE_JEU = 0.6;
/** Plots de carte : diamètre par vis, hauteur proposée (Raspberry Pi 5 de la référence : 5 mm). */
const PLOT_DIAMETRE: Record<VisCarte, number> = { M2: 5, 'M2.5': 6 };
const PLOT_HAUTEUR = 5;

const GENRES: readonly GenreAjout[] = ['bossages', 'plots', 'nervure', 'rebord', 'emboitement', 'composant'];

const PAROI_TEXTE: Record<Paroi, string> = { arriere: 'vers l’arrière', avant: 'vers l’avant', gauche: 'vers la gauche', droite: 'vers la droite' };

// ---------------------------------------------------------------------------------------------
// Rangement dans les mesures

function estAjout(x: unknown): x is Ajout {
  return Boolean(x) && typeof x === 'object' && GENRES.includes((x as Ajout).genre);
}

export function ajoutsDe(v: Valeurs): Ajout[] {
  const raw = v.ajouts;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(estAjout) : [];
  } catch {
    return [];
  }
}

export function avecAjouts(v: Valeurs, liste: readonly Ajout[]): Valeurs {
  const out: Valeurs = { ...v };
  delete out.ajouts;
  if (liste.length) out.ajouts = JSON.stringify(liste);
  return out;
}

/** Les pièces qui reçoivent des ajouts : les boîtes. */
const PIECES = new Set(['boite', 'boite_couvercle']);
export function recoitAjouts(gabaritId: string): boolean {
  return PIECES.has(gabaritId);
}

// ---------------------------------------------------------------------------------------------
// Les mots

const mm = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');
const visTexte = (v: VisCarte) => v.replace('.', ',');

export function direAjout(a: Ajout): string {
  switch (a.genre) {
    case 'bossages': {
      const extra = [a.hauteur !== undefined ? `${mm(a.hauteur)} mm de haut` : '', a.diametre !== undefined ? `Ø ${mm(a.diametre)} mm` : ''].filter(Boolean);
      const ou = a.distance !== undefined ? ` à ${mm(a.distance)} mm des coins` : ' aux coins';
      return `4 bossages avec insert M3${ou}${extra.length ? `, ${extra.join(', ')}` : ''}`;
    }
    case 'plots': {
      const e = a.entraxe ?? [0, 0];
      const ou =
        a.depuisGauche !== undefined && a.depuisAvant !== undefined
          ? `, premier trou à ${mm(a.depuisGauche)} mm de la gauche et ${mm(a.depuisAvant)} mm de l’avant`
          : ', au centre du fond';
      return `4 plots ${visTexte(a.vis ?? 'M2.5')} de ${mm(a.hauteur ?? PLOT_HAUTEUR)} mm, entraxe ${mm(e[0])} × ${mm(e[1])} mm${ou}`;
    }
    case 'nervure': {
      const ou =
        a.sens === 'largeur'
          ? a.depuisGauche !== undefined ? `à ${mm(a.depuisGauche)} mm de la gauche` : 'au milieu'
          : a.depuisAvant !== undefined ? `à ${mm(a.depuisAvant)} mm de l’avant` : 'au milieu';
      const h = a.hauteur !== undefined ? ` de ${mm(a.hauteur)} mm de haut` : '';
      return `une nervure${h} dans la ${a.sens ?? 'longueur'}, ${ou}`;
    }
    case 'rebord':
      return a.epaisseur !== undefined ? `un rebord intérieur pour un couvercle de ${mm(a.epaisseur)} mm` : 'un rebord intérieur qui porte le couvercle';
    case 'emboitement':
      return `un couvercle qui s’emboîte (lèvre de ${mm(LEVRE_EP)} mm, ${mm(LEVRE_JEU)} mm de jeu par côté)`;
    case 'composant': {
      const c = a.composant ? composant(a.composant) : undefined;
      return `${c ? `le ${c.nom}` : 'une carte'} sur ses plots, prises ${PAROI_TEXTE[a.ports ?? 'arriere']}`;
    }
  }
}

export function ajoutsAffiches(v: Valeurs): { nom: string; valeur: string }[] {
  return ajoutsDe(v).map((a) => ({ nom: 'Ajout', valeur: direAjout(a) }));
}

// ---------------------------------------------------------------------------------------------
// La boîte et son couvercle

interface Boite {
  L: number;
  W: number;
  H: number;
  e: number;
  f: number;
  couvercle: boolean;
  /** Épaisseur du couvercle (boîte à couvercle). */
  t: number;
  /** Hauteur de la lèvre du couvercle (boîte à couvercle). */
  levreH: number;
}

function nb(v: Valeurs, id: string, d = Number.NaN): number {
  const x = v[id];
  return typeof x === 'number' && Number.isFinite(x) ? x : d;
}

function boiteDe(gabaritId: string, v: Valeurs): Boite | null {
  if (!PIECES.has(gabaritId)) return null;
  return {
    L: nb(v, 'longueur'),
    W: nb(v, 'largeur'),
    H: nb(v, 'hauteur'),
    e: nb(v, 'paroi'),
    f: nb(v, 'fond'),
    couvercle: gabaritId === 'boite_couvercle',
    t: nb(v, 'couvercle', 2),
    levreH: nb(v, 'rebord', 6),
  };
}

/** Le couvercle d'une boîte à couvercle, selon ses ajouts : lèvre (épaisseur, jeu) ou plaque posée. */
export function couvercleDe(v: Valeurs): { plat: boolean; levre: number; jeu: number } {
  const ajouts = ajoutsDe(v);
  if (ajouts.some((a) => a.genre === 'rebord')) return { plat: true, levre: 0, jeu: LEVRE_JEU };
  if (ajouts.some((a) => a.genre === 'emboitement')) return { plat: false, levre: LEVRE_EP, jeu: LEVRE_JEU };
  return { plat: false, levre: nb(v, 'paroi', 2), jeu: nb(v, 'jeu', 0.3) };
}

/** Haut du rebord intérieur (z), ou `null` sans rebord. */
function hautRebord(b: Boite, ajouts: readonly Ajout[]): number | null {
  const r = ajouts.find((a) => a.genre === 'rebord');
  if (!r) return null;
  return b.H - (b.couvercle ? b.t : (r.epaisseur ?? COUVERCLE_POSE_EP));
}

function f(x: number): string {
  if (!Number.isFinite(x)) throw new Error('mesure invalide');
  return String(Math.round(x * 1000) / 1000);
}

function cube(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): string {
  return `translate([${f(x0)}, ${f(y0)}, ${f(z0)}]) cube([${f(x1 - x0)}, ${f(y1 - y0)}, ${f(z1 - z0)}]);`;
}

function cylindre(x: number, y: number, z0: number, z1: number, d: number, d2?: number): string {
  const r = d2 === undefined ? `d = ${f(d)}` : `d1 = ${f(d)}, d2 = ${f(d2)}`;
  return `translate([${f(x)}, ${f(y)}, ${f(z0)}]) cylinder(h = ${f(z1 - z0)}, ${r});`;
}

/** Point de la boîte fermée → point du couvercle imprimé à côté, retourné. */
function versCouvercle(b: Boite, x: number, y: number): [number, number] {
  return [b.L + 10 + x, b.W - y];
}

export interface AjoutsPlaces {
  /** Matière ajoutée (union avec la pièce). */
  plus: string[];
  /** Trous (inserts, avant-trous, passages de vis, entailles de la lèvre). */
  moins: string[];
  erreurs: string[];
  /** Ce qu'il faut savoir pour monter la pièce : vis choisies. */
  notes: string[];
}

/** Ce que l'ajout veut dire en OpenSCAD, et ce qui ne va pas, en phrases simples. */
export function placerAjouts(gabaritId: string, v: Valeurs): AjoutsPlaces {
  const out: AjoutsPlaces = { plus: [], moins: [], erreurs: [], notes: [] };
  const ajouts = ajoutsDe(v);
  if (!ajouts.length) return out;
  const b = boiteDe(gabaritId, v);
  if (!b) {
    out.erreurs.push('Je sais ajouter des bossages, des plots, des nervures et des rebords dans les boîtes seulement, pour l’instant.');
    return out;
  }
  const { L, W, H, e, f: fond } = b;
  const couv = couvercleDe(v);
  const zRebord = hautRebord(b, ajouts);
  /** Haut de ce qui peut monter dans la boîte : le rebord, ou le bord. */
  const zHaut = zRebord ?? H;
  /** Bas de la lèvre du couvercle (boîte à couvercle à lèvre) : rien ne doit monter plus haut, sauf les bossages entaillés. */
  const zLevre = b.couvercle && !couv.plat ? H - b.levreH : H;

  for (const a of ajouts) {
    const quoi = majuscule(direAjout(a));
    switch (a.genre) {
      case 'bossages': {
        const d = a.diametre ?? INSERT_M3.bossageMini;
        const r = d / 2;
        const matiere = (d - INSERT_M3.percage) / 2;
        if (matiere < PAROI_INSERT_MIN - 1e-9) {
          out.erreurs.push(`${quoi} : il faut au moins ${mm(PAROI_INSERT_MIN)} mm de matière autour de l’insert, donc un bossage de ${mm(INSERT_M3.percage + 2 * PAROI_INSERT_MIN)} mm de diamètre au moins.`);
          continue;
        }
        const dist = a.distance ?? e + r - 1;
        if (dist - INSERT_M3.percage / 2 < PAROI_INSERT_MIN - 1e-9) {
          out.erreurs.push(`${quoi} : l’insert serait trop près du bord extérieur. Il faut au moins ${mm(INSERT_M3.percage / 2 + PAROI_INSERT_MIN)} mm entre le coin et le centre du bossage.`);
          continue;
        }
        if (2 * (dist + r) > Math.min(L, W) - 1) {
          out.erreurs.push(`${quoi} : les bossages se toucheraient, la boîte est trop petite pour eux.`);
          continue;
        }
        const haut = a.hauteur !== undefined ? fond + a.hauteur : zHaut;
        if (haut > zHaut + 1e-9) {
          out.erreurs.push(`${quoi} : plus haut que ${zRebord !== null ? 'le rebord' : 'la boîte'} (${mm(zHaut - fond)} mm au-dessus du fond au plus).`);
          continue;
        }
        if (haut - INSERT_M3.profondeur < fond + 0.6 - 1e-9) {
          out.erreurs.push(`${quoi} : trop court pour l’insert (${mm(INSERT_M3.profondeur)} mm de profondeur). Il faut ${mm(INSERT_M3.profondeur + 0.6 - fond)} mm de haut au moins.`);
          continue;
        }
        const coins: [number, number, number, number][] = [
          [dist, dist, -1, -1],
          [L - dist, dist, 1, -1],
          [dist, W - dist, -1, 1],
          [L - dist, W - dist, 1, 1],
        ];
        // Collé à la paroi quand il en est près : un bloc d'angle le relie aux deux parois.
        const colle = dist - r - e < 3;
        for (const [x, y, sx, sy] of coins) {
          out.plus.push(cylindre(x, y, fond - 0.01, haut, d));
          if (colle) {
            const xa = sx < 0 ? e - 0.01 : x;
            const xb = sx < 0 ? x : L - e + 0.01;
            const ya = sy < 0 ? e - 0.01 : y;
            const yb = sy < 0 ? y : W - e + 0.01;
            out.plus.push(cube(xa, ya, fond - 0.01, xb, yb, haut));
          }
          out.moins.push(cylindre(x, y, haut - INSERT_M3.profondeur, haut + 0.01, INSERT_M3.percage));
        }
        // Le couvercle dessiné : trous de passage, tête fraisée, et la lèvre entaillée autour.
        if (b.couvercle && Math.abs(haut - zHaut) < 1e-9) {
          for (const [x, y, sx, sy] of coins) {
            const [X, Y] = versCouvercle(b, x, y);
            out.moins.push(cylindre(X, Y, -1, b.t + 1, VIS_M3_PASSAGE));
            if (b.t >= 2) {
              const p = (VIS_M3_FRAISEE.diametreTete - VIS_M3_PASSAGE) / 2;
              out.moins.push(cylindre(X, Y, -0.01, p, VIS_M3_FRAISEE.diametreTete, VIS_M3_PASSAGE));
            }
            if (!couv.plat) {
              out.moins.push(cylindre(X, Y, b.t, b.t + b.levreH + 1, d + 2 * ENTAILLE_JEU));
              if (colle) {
                const [Xa, Ya] = versCouvercle(b, sx < 0 ? -1 : x - ENTAILLE_JEU, sy < 0 ? -1 : y - ENTAILLE_JEU);
                const [Xb, Yb] = versCouvercle(b, sx < 0 ? x + ENTAILLE_JEU : L + 1, sy < 0 ? y + ENTAILLE_JEU : W + 1);
                out.moins.push(cube(Math.min(Xa, Xb), Math.min(Ya, Yb), b.t, Math.max(Xa, Xb), Math.max(Ya, Yb), b.t + b.levreH + 1));
              }
            }
          }
          const vis = choisirVisM3(b.t);
          if (!vis) out.erreurs.push(`${quoi} : aucune vis M3 courante ne convient pour un couvercle de ${mm(b.t)} mm.`);
          else out.notes.push(`Couvercle : 4 vis M3 × ${vis.longueur}${b.t >= 2 ? ' à tête fraisée' : ''} (${mm(vis.prise)} mm dans les inserts).`);
        }
        break;
      }
      case 'plots': {
        if (!a.entraxe) {
          out.erreurs.push('Plots : dis-moi l’écart des trous de la carte, par exemple « entraxe de 58 par 49 ».');
          continue;
        }
        const vis = a.vis ?? 'M2.5';
        const d = a.diametre ?? PLOT_DIAMETRE[vis];
        const h = a.hauteur ?? PLOT_HAUTEUR;
        const [ex, ey] = a.entraxe;
        const x0 = a.depuisGauche ?? L / 2 - ex / 2;
        const y0 = a.depuisAvant ?? W / 2 - ey / 2;
        const trous = [
          [x0, y0],
          [x0 + ex, y0],
          [x0, y0 + ey],
          [x0 + ex, y0 + ey],
        ] as const;
        if ((d - AVANT_TROU[vis]) / 2 < 1 - 1e-9) {
          out.erreurs.push(`${quoi} : plot trop fin autour de l’avant-trou (${mm(AVANT_TROU[vis])} mm).`);
          continue;
        }
        const dehors = trous.some(([x, y]) => x - d / 2 < e - 1e-9 || x + d / 2 > L - e + 1e-9 || y - d / 2 < e - 1e-9 || y + d / 2 > W - e + 1e-9);
        if (dehors) {
          out.erreurs.push(`${quoi} : ils ne tiennent pas dans le fond (${mm(L - 2 * e)} × ${mm(W - 2 * e)} mm de place à l’intérieur).`);
          continue;
        }
        if (fond + h > zLevre - 0.5 || fond + h > zHaut - 1) {
          out.erreurs.push(`${quoi} : trop hauts pour cette boîte.`);
          continue;
        }
        for (const [x, y] of trous) {
          out.plus.push(cylindre(x, y, fond - 0.01, fond + h, d));
          out.moins.push(cylindre(x, y, fond + 0.6, fond + h + 0.01, AVANT_TROU[vis]));
        }
        break;
      }
      case 'nervure': {
        const ep = a.epaisseur ?? e;
        const h = a.hauteur ?? Math.min(8, Math.round((zLevre - fond) / 2));
        if (ep < 0.8 || ep > 10) {
          out.erreurs.push(`${quoi} : épaisseur de 0,8 à 10 mm.`);
          continue;
        }
        if (h < 1 || fond + h > Math.min(zHaut, zLevre - 0.5) + 1e-9) {
          out.erreurs.push(`${quoi} : trop haute pour cette boîte (${mm(Math.max(0, Math.min(zHaut, zLevre - 0.5) - fond))} mm au plus).`);
          continue;
        }
        if (a.sens === 'largeur') {
          const x = a.depuisGauche ?? L / 2;
          if (x - ep / 2 < e || x + ep / 2 > L - e) {
            out.erreurs.push(`${quoi} : en dehors de la boîte.`);
            continue;
          }
          out.plus.push(cube(x - ep / 2, e - 0.01, fond - 0.01, x + ep / 2, W - e + 0.01, fond + h));
        } else {
          const y = a.depuisAvant ?? W / 2;
          if (y - ep / 2 < e || y + ep / 2 > W - e) {
            out.erreurs.push(`${quoi} : en dehors de la boîte.`);
            continue;
          }
          out.plus.push(cube(e - 0.01, y - ep / 2, fond - 0.01, L - e + 0.01, y + ep / 2, fond + h));
        }
        break;
      }
      case 'rebord': {
        const zt = zRebord!;
        if (zt - REBORD_EP - REBORD_LARGEUR < fond + 1) {
          out.erreurs.push(`${quoi} : la boîte est trop basse pour un rebord.`);
          continue;
        }
        if (L - 2 * e - 2 * REBORD_LARGEUR < 5 || W - 2 * e - 2 * REBORD_LARGEUR < 5) {
          out.erreurs.push(`${quoi} : la boîte est trop petite pour un rebord.`);
          continue;
        }
        const z0 = zt - REBORD_EP - REBORD_LARGEUR;
        const k = REBORD_LARGEUR;
        out.plus.push(
          `difference() { ${cube(e - 0.01, e - 0.01, z0, L - e + 0.01, W - e + 0.01, zt)} ` +
            `hull() { ${cube(e, e, z0 - 0.02, L - e, W - e, z0 - 0.01)} ${cube(e + k, e + k, zt - REBORD_EP, L - e - k, W - e - k, zt - REBORD_EP + 0.01)} } ` +
            `${cube(e + k, e + k, zt - REBORD_EP, L - e - k, W - e - k, zt + 1)} }`,
        );
        break;
      }
      case 'emboitement':
        if (!b.couvercle) out.erreurs.push('Cette boîte n’a pas de couvercle : demande-moi « une boîte avec couvercle ».');
        break;
      case 'composant': {
        const c = a.composant ? composant(a.composant) : undefined;
        const g = c ? geometrieCarte(c, a.mesures ? { [c.id]: a.mesures } : {}) : null;
        if (!c || !g) {
          out.erreurs.push(`${quoi} : je n’ai pas ses cotes.`);
          continue;
        }
        const pose = poserCarte(`le ${c.nom}`, g, { L, W, H, e, f: fond, zHaut: Math.min(zHaut, zLevre) }, a.ports ?? 'arriere');
        if (pose.erreurs.length) {
          out.erreurs.push(...pose.erreurs);
          continue;
        }
        out.plus.push(...pose.plus.map((x) => x.scad));
        out.moins.push(...pose.moins.map((x) => x.scad));
        const vis = g.trous[0]?.vis ?? 'M2.5';
        const longueur = Math.round(g.epaisseur + PLOT_CARTE - 0.6 + 0.1);
        out.notes.push(`${majuscule(c.nom)} : ${g.trous.length} vis autotaraudeuses ${vis.replace('.', ',')} × ${longueur} (${mm(longueur - g.epaisseur)} mm dans les plots).`);
        out.notes.push(...pose.incertitudes);
        break;
      }
    }
  }
  return out;
}

function majuscule(texte: string): string {
  return texte ? `${texte[0]!.toUpperCase()}${texte.slice(1)}` : texte;
}

// ---------------------------------------------------------------------------------------------
// Lire une phrase (texte déjà plié : minuscules, sans accent)

export interface OpAjout {
  action: 'ajouter' | 'modifier' | 'enlever';
  genre: GenreAjout;
  champs: Partial<Ajout>;
  plus?: { mesure: 'hauteur' | 'diametre'; sens: 1 | -1 };
  /** Phrase comprise mais refusée (une carte connue avant l'étape des composants…). */
  refus?: string;
}

const N = String.raw`(\d+(?:\.\d+)?)`;
const MOTS_GENRES: [GenreAjout, RegExp][] = [
  ['bossages', /\bbossages?\b/],
  ['plots', /\b(?:plots?|picots?)\b/],
  ['nervure', /\b(?:nervures?|renforts?)\b/],
  ['rebord', /\brebord (?:interieur|a l interieur|dedans|qui porte|qui tient|pour (?:le |un |poser |porter |tenir )?(?:le |un )?couvercle|porteur)\b|\bcouvercle (?:qui )?(?:pose|repose|posee|se pose) sur un rebord\b/],
  ['emboitement', /\b(?:s emboite|s emboitent|s emboiter|emboite|emboitement|emboiter|emboitable|se clipse|se clippe|clipse|clippe|clipsable|s encastre|encastrable)\b/],
];
const QUANTITES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, huit: 8 };
const RETRAIT = /\b(?:enleve|enlever|retire|retirer|supprime|supprimer|vire|virer|sans|pas de|plus de|efface)\b/;
const CARTE = /\b(?:raspberry|rpi|pi ?[345]\b|arduino|esp ?32|esp ?8266|carte (?:mere|electronique|pi)|ecran tactile|camera)/;
const CLAUSE_FIN = / , (?!a \d|\d)| puis | et (?=ajoute|mets|met|fais|perce|une?|des|deux|quatre)/;
const PETITS_MOTS = new Set(['un', 'une', 'des', 'deux', 'trois', 'quatre', 'cinq', 'six', 'huit', 'le', 'la', 'les', 'l', 'ce', 'cette', 'ces', 'ajoute', 'ajouter', 'mets', 'met', 'mettre', 'avec', 'de', 'd', 'du', 'moi', 'et', '4', '2', '6', '8']);

function nombreDe(m: RegExpExecArray | null, i = 1): number | undefined {
  return m && m[i] !== undefined ? Number(m[i]) : undefined;
}

function lireOp(genre: GenreAjout, s: string, avant: string): OpAjout {
  const retrait = RETRAIT.test(avant.split(' ').slice(-3).join(' ')) || /^(?:enleve|retire|supprime|vire|sans)\b/.test(s);
  const defini = /\b(?:le|la|les|l|ce|cette|ces)\s*$/.test(avant);
  const op: OpAjout = { action: retrait ? 'enlever' : 'ajouter', genre, champs: { genre } };
  if (retrait) return op;
  const c = op.champs;
  const hauteur = nombreDe(new RegExp(String.raw`${N} ?(?:mm )?(?:de haut|de hauteur|de hauts?)\b`).exec(s)) ?? nombreDe(new RegExp(String.raw`\bhauteur (?:de )?${N}`).exec(s));
  const diametre = nombreDe(new RegExp(String.raw`${N} ?(?:mm )?de diametre\b`).exec(s)) ?? nombreDe(new RegExp(String.raw`\bdiametre (?:de )?${N}`).exec(s));
  if (hauteur !== undefined) c.hauteur = hauteur;
  if (diametre !== undefined) c.diametre = diametre;
  const rel = /\b(plus|moins) (?:un peu )?(hauts?|hautes?|bas|basses?|gros|grosses?|larges?|petits?|petites?|fins?|fines?)\b/.exec(`${avant.split(' ').slice(-3).join(' ')} ${s}`);
  if (rel) {
    const mot = rel[2]!;
    const mesure = /^(?:haut|bas)/.test(mot) ? 'hauteur' : 'diametre';
    const grand = /^(?:haut|gros|large)/.test(mot);
    op.plus = { mesure, sens: (rel[1] === 'plus') === grand ? 1 : -1 };
  }

  switch (genre) {
    case 'bossages': {
      const n = /\b(\d+|un|une|deux|trois|quatre|cinq|six|huit) bossages?\b/.exec(`${avant} ${s}`);
      const combien = n ? (QUANTITES[n[1]!] ?? Number(n[1])) : undefined;
      const dist = nombreDe(new RegExp(String.raw`\ba ${N} ?(?:mm |millimetres )?(?:des|du) (?:quatre |4 )?(?:coins?|angles?|bords?)\b`).exec(s));
      if (dist !== undefined) c.distance = dist;
      if (/\bm(?:2|2\.5|4|5)\b/.test(s)) op.refus = 'Je ne connais que les inserts M3 (perçage de 4 mm, 6 mm de profondeur).';
      else if (combien !== undefined && combien !== 4 && !defini) op.refus = 'Pour l’instant, je pose les bossages par quatre, un dans chaque coin.';
      break;
    }
    case 'plots': {
      if (CARTE.test(`${avant} ${s}`)) {
        op.refus = `Je ne connais pas cette carte. Je connais : ${CARTES_CONNUES}. Pour une autre, donne-moi l’écart des trous, par exemple « 4 plots M2,5 avec un entraxe de 58 par 49 ».`;
        break;
      }
      if (/\bm2\.5\b|\bm25\b/.test(s)) c.vis = 'M2.5';
      else if (/\bm2\b/.test(s)) c.vis = 'M2';
      else if (/\bm3\b/.test(s)) op.refus = 'Pour du M3, prends des bossages avec insert : « ajoute quatre bossages avec insert M3 ».';
      const e = new RegExp(String.raw`\b(?:entraxe|entre axes?|ecartes?|ecartement|espaces?|espacement)(?: des trous)?(?: de| d)? ${N} ?(?:mm )?(?:x|par|sur) ${N}`).exec(s);
      if (e) c.entraxe = [Number(e[1]), Number(e[2])];
      lirePlace(s, c);
      break;
    }
    case 'nervure': {
      if (/\b(?:dans la largeur|en travers|transversale|d avant en arriere)\b/.test(s)) c.sens = 'largeur';
      else if (/\b(?:dans la longueur|en long|longitudinale|de gauche a droite)\b/.test(s)) c.sens = 'longueur';
      const ep = nombreDe(new RegExp(String.raw`${N} ?(?:mm )?d epaisseur\b`).exec(s)) ?? nombreDe(new RegExp(String.raw`\bepaisse de ${N}`).exec(s));
      if (ep !== undefined) c.epaisseur = ep;
      lirePlace(s, c);
      if (hauteur === undefined && !op.plus) {
        // « une nervure de 8 mm » : le nombre seul est sa hauteur.
        const seul = new RegExp(String.raw`\bde ${N} ?(?:mm)?\b(?! d epaisseur| de la| du)`).exec(s);
        if (seul) c.hauteur = Number(seul[1]);
      }
      break;
    }
    case 'rebord': {
      const t = nombreDe(new RegExp(String.raw`\bcouvercle de ${N}`).exec(s));
      if (t !== undefined) c.epaisseur = t;
      break;
    }
    case 'emboitement':
      break;
  }
  if (defini && (op.plus || hauteur !== undefined || diametre !== undefined)) op.action = 'modifier';
  return op;
}

/** Les cartes qu'on sait poser, pour les phrases. */
const CARTES_CONNUES = 'le Raspberry Pi 5, et après mesure au pied à coulisse : l’ESP32-S3 sur sa carte à borniers, l’ampli MAX98357A et le petit écran OLED';

/** « ports vers l'arrière », « prises sur le côté droit », « USB à gauche » : la paroi des prises. */
export function lirePorts(t: string): Paroi | undefined {
  const m = /\b(?:ports?|prises?|connecteurs?|usb)\b(?: [a-z0-9]+){0,4}? (?:vers l |a l |sur l |de l |cote |du cote |sur le cote |vers la |a |sur la |sur |vers |au )?(arriere|avant|gauche|droite?|derriere|devant|fond)\b/.exec(t);
  if (!m) return undefined;
  // « ports derrière » = à l'arrière, « devant » = à l'avant, « au fond » = à l'arrière.
  const mot = m[1]!;
  return mot === 'droit' ? 'droite' : mot === 'derriere' || mot === 'fond' ? 'arriere' : mot === 'devant' ? 'avant' : (mot as Paroi);
}

function lireComposant(t: string, id: string): OpAjout {
  const c = composant(id)!;
  if (/\b(?:enleve|enlever|retire|retirer|supprime|supprimer|vire|sans)\b/.test(t)) return { action: 'enlever', genre: 'composant', champs: { genre: 'composant', composant: id } };
  const op: OpAjout = { action: 'ajouter', genre: 'composant', champs: { genre: 'composant', composant: id } };
  const ports = lirePorts(t);
  if (ports) op.champs.ports = ports;
  if (!c.carte) {
    op.refus = `Je sais poser les cartes (${CARTES_CONNUES}) sur leurs plots. ${majuscule(c.nom)} se tient autrement (logement et retenues pour l’écran, chariot réglable pour la caméra) : ça viendra avec le boîtier électronique.`;
  }
  return op;
}

function lirePlace(s: string, c: Partial<Ajout>): void {
  const g = new RegExp(String.raw`\b${N} ?(?:mm )?(?:du bord |de la |du cote |du )?gauche\b`).exec(s);
  const av = new RegExp(String.raw`\b${N} ?(?:mm )?(?:du bord |de l |du cote |du )?avant\b`).exec(s);
  if (g) c.depuisGauche = Number(g[1]);
  if (av) c.depuisAvant = Number(av[1]);
}

/**
 * Les ajouts dits dans une phrase pliée, et la phrase sans eux (pour lire les découpes et les
 * mesures ensuite : « l'avant-trou » n'est pas un trou à percer).
 */
export function lireAjouts(t: string): { ops: OpAjout[]; reste: string } {
  const texte = ` ${t} `;
  // Un composant de la bibliothèque posé dans la boîte : « mets des plots pour un Raspberry Pi 5
  // dans le fond, ports vers l'arrière », « pose l'ESP32 dans la boîte ». Toute la phrase est pour lui.
  const nomme = composantNomme(texte);
  // « Rajoute un écran tactile » (essai du 24 novembre) : « rajoute » n'était pas lu.
  if (nomme && (/\bplots?\b/.test(texte) || /\b(?:mets|met|mettre|pose|poser|place|placer|ajoute|ajouter|rajoute|rajouter|installe|installer|integre|integrer|monte|monter|fixe|fixer|range|enleve|retire|supprime)\b/.test(texte))) {
    // Le reste de la phrase garde ses mesures (« une boîte de 120 par 80 par 40 avec un Raspberry Pi 5 ») ;
    // le nom du composant (et son « 5 »), les prises et les plots partent.
    const reste = texte
      .replace(new RegExp(nomme.mots.source, 'g'), ' ')
      .replace(/\b(?:ports?|prises?|connecteurs?|usb)\b(?: [a-z0-9]+){0,4}? (?:vers l |a l |sur l |de l |cote |du cote |sur le cote |vers la |a |sur la |sur |vers |au )?(?:arriere|avant|gauche|droite?|derriere|devant|fond)\b/, ' ')
      .replace(/\b(?:des |les |de |4 |quatre )?plots?\b/, ' ');
    return { ops: [lireComposant(texte, nomme.id)], reste: reste.replace(/\s+/g, ' ').trim() };
  }
  const ops: OpAjout[] = [];
  let reste = texte;
  for (const [genre, re] of MOTS_GENRES) {
    const m = re.exec(reste);
    if (!m) continue;
    // La clause : de l'article (ou du verbe) qui précède le mot, jusqu'à la fin de la proposition.
    const debutMot = m.index;
    const avant = reste.slice(0, debutMot).trim();
    let s = reste.slice(debutMot + m[0].length);
    const fin = CLAUSE_FIN.exec(s);
    if (fin) s = s.slice(0, fin.index);
    // Le mot clé compte : « emboîte » est tout le sens de la phrase, « pour le couvercle » aussi.
    const op = lireOp(genre, `${m[0].trim()} ${s.trim()}`.trim(), avant);
    ops.push(op);
    // Les petits mots juste avant (« ajoute quatre », « avec des ») partent avec la clause.
    const mots = avant ? avant.split(' ') : [];
    while (mots.length && PETITS_MOTS.has(mots[mots.length - 1]!)) mots.pop();
    reste = ` ${mots.join(' ')} ${reste.slice(debutMot + m[0].length + s.length)} `;
  }
  return { ops, reste: reste.replace(/\s+/g, ' ').trim() };
}

// ---------------------------------------------------------------------------------------------
// Appliquer à la pièce

function arrondi(x: number): number {
  return x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
}

/** Hauteur actuelle d'un ajout (choisie par l'atelier quand elle n'a pas été dite). */
function hauteurActuelle(a: Ajout, gabaritId: string, v: Valeurs): number {
  if (a.hauteur !== undefined) return a.hauteur;
  const b = boiteDe(gabaritId, v)!;
  const zHaut = hautRebord(b, ajoutsDe(v)) ?? b.H;
  if (a.genre === 'plots') return PLOT_HAUTEUR;
  if (a.genre === 'nervure') {
    const couv = couvercleDe(v);
    const zLevre = b.couvercle && !couv.plat ? b.H - b.levreH : b.H;
    return Math.min(8, Math.round((zLevre - b.f) / 2));
  }
  return zHaut - b.f;
}

export function appliquerAjouts(
  g: { id: string; nom: string },
  v: Valeurs,
  ops: readonly OpAjout[],
  mesures: MesuresComposants = {},
): { ajouts: Ajout[]; changements: string[]; erreurs: string[]; question?: { composant: string; champ: string; texte: string } } {
  const existants = ajoutsDe(v);
  const erreurs: string[] = [];
  const changements: string[] = [];
  let liste = [...existants];
  if (!PIECES.has(g.id)) {
    return { ajouts: liste, changements, erreurs: [`Je sais ajouter des bossages, des plots, des nervures et des rebords dans les boîtes seulement, pour l’instant (pas dans un ${g.nom}).`] };
  }
  for (const op of ops) {
    if (op.refus) {
      erreurs.push(op.refus);
      continue;
    }
    // Un composant « à mesurer » ne sert pas tant que ses mesures ne sont pas toutes données.
    if (op.genre === 'composant' && op.action === 'ajouter' && op.champs.composant) {
      const c = composant(op.champs.composant)!;
      const q = prochaineMesure(c, mesures);
      if (q) return { ajouts: [...existants], changements: [], erreurs: [], question: { composant: c.id, champ: q.champ, texte: questionMesure(c, q, mesures) } };
      if (c.etat === 'a_mesurer') op.champs.mesures = { ...(mesures[c.id] ?? {}) };
      // Un composant de chaque sorte : le reposer remplace l'ancien (autres prises, nouvelles mesures).
      const ancien = liste.filter((a) => a.genre === 'composant' && a.composant === c.id);
      liste = liste.filter((a) => !ancien.includes(a));
      const nouveau: Ajout = { ...op.champs, genre: 'composant' };
      liste.push(nouveau);
      changements.push(ancien.length ? `${majuscule(direAjout(ancien[0]!))} → ${direAjout(nouveau)}` : `Ajout : ${direAjout(nouveau)}`);
      continue;
    }
    const visees = liste.filter((a) => a.genre === op.genre);
    if (op.action === 'enlever') {
      if (!visees.length) {
        erreurs.push('Il n’y a rien de tel à enlever.');
        continue;
      }
      liste = liste.filter((a) => a.genre !== op.genre);
      changements.push(...visees.map((a) => `Retiré : ${direAjout(a)}`));
      continue;
    }
    if (op.action === 'modifier' || (op.plus && visees.length)) {
      if (!visees.length) {
        erreurs.push(`Il n’y a pas encore de ${op.genre === 'bossages' ? 'bossage' : op.genre === 'plots' ? 'plot' : op.genre} sur cette pièce.`);
        continue;
      }
      const cible = visees[visees.length - 1]!;
      const n: Ajout = { ...cible, ...op.champs, genre: cible.genre };
      if (op.plus?.mesure === 'hauteur') {
        const actuelle = hauteurActuelle(cible, g.id, avecAjouts(v, liste));
        const nouvelle = op.plus.sens > 0 ? arrondi(Math.max(actuelle * 1.25, actuelle + 2)) : arrondi(Math.min(actuelle * 0.8, actuelle - 1));
        if (op.plus.sens > 0 && cible.genre === 'bossages' && cible.hauteur === undefined) {
          erreurs.push('Les bossages montent déjà jusqu’en haut de la boîte.');
          continue;
        }
        n.hauteur = nouvelle;
      }
      if (op.plus?.mesure === 'diametre') {
        const actuelle = cible.diametre ?? (cible.genre === 'plots' ? PLOT_DIAMETRE[cible.vis ?? 'M2.5'] : INSERT_M3.bossageMini);
        n.diametre = op.plus.sens > 0 ? arrondi(actuelle + 1) : arrondi(actuelle - 1);
      }
      liste = liste.map((a) => (a === cible ? n : a));
      const avant = direAjout(cible);
      const apres = direAjout(n);
      if (avant !== apres) changements.push(`${majuscule(avant)} → ${apres}`);
      continue;
    }
    // Ajouter. Un seul jeu de bossages, un seul rebord ; le rebord et l'emboîtement s'excluent.
    const nouveau: Ajout = { ...op.champs, genre: op.genre };
    if (op.genre === 'emboitement' && g.id !== 'boite_couvercle') {
      erreurs.push('Cette boîte n’a pas de couvercle : demande-moi « une boîte avec couvercle ».');
      continue;
    }
    const remplaces = liste.filter(
      (a) => (['bossages', 'rebord', 'emboitement'].includes(op.genre) && a.genre === op.genre) || (op.genre === 'rebord' && a.genre === 'emboitement') || (op.genre === 'emboitement' && a.genre === 'rebord'),
    );
    liste = liste.filter((a) => !remplaces.includes(a));
    changements.push(...remplaces.filter((a) => a.genre !== op.genre).map((a) => `Retiré : ${direAjout(a)}`));
    liste.push(nouveau);
    changements.push(`Ajout : ${direAjout(nouveau)}`);
  }
  return { ajouts: liste, changements, erreurs };
}
