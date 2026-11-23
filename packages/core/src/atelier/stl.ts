/**
 * Atelier 3D — lecture et contrôle d'un fichier STL (sortie d'OpenSCAD).
 *
 * Sert deux fois :
 * - l'écran 3D de l'atelier affiche le maillage lu ici ;
 * - avant de proposer l'impression, Jarvis vérifie que la pièce est **fermée** (chaque arête
 *   partagée par exactement deux triangles : sinon le trancheur peut faire n'importe quoi) et
 *   qu'elle a **la taille annoncée** (celle de `Gabarit.taille`).
 *
 * Pur : aucun accès disque, aucun module Node. Les normales sont recalculées à partir des
 * sommets (celles écrites dans le fichier sont souvent nulles ou fausses).
 */

export type Vec3 = [number, number, number];

export interface Maillage {
  /** 9 nombres par triangle (3 sommets × x, y, z), en millimètres. */
  positions: Float32Array;
  /** Une normale par sommet (la même pour les 3 sommets d'un triangle). */
  normales: Float32Array;
  triangles: number;
  min: Vec3;
  max: Vec3;
}

/** Au-delà, le fichier est refusé (une pièce de l'atelier en fait quelques dizaines de milliers). */
export const STL_TRIANGLES_MAX = 2_000_000;

function octets(data: ArrayBuffer | Uint8Array): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function construire(positions: Float32Array): Maillage {
  const triangles = positions.length / 9;
  const normales = new Float32Array(positions.length);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < triangles; t += 1) {
    const o = t * 9;
    const ax = positions[o]!;
    const ay = positions[o + 1]!;
    const az = positions[o + 2]!;
    const ux = positions[o + 3]! - ax;
    const uy = positions[o + 4]! - ay;
    const uz = positions[o + 5]! - az;
    const vx = positions[o + 6]! - ax;
    const vy = positions[o + 7]! - ay;
    const vz = positions[o + 8]! - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const n = Math.hypot(nx, ny, nz) || 1;
    nx /= n;
    ny /= n;
    nz /= n;
    for (let s = 0; s < 3; s += 1) {
      normales[o + s * 3] = nx;
      normales[o + s * 3 + 1] = ny;
      normales[o + s * 3 + 2] = nz;
      for (let axe = 0; axe < 3; axe += 1) {
        const valeur = positions[o + s * 3 + axe]!;
        if (valeur < min[axe]!) min[axe] = valeur;
        if (valeur > max[axe]!) max[axe] = valeur;
      }
    }
  }
  if (triangles === 0) {
    return { positions, normales, triangles, min: [0, 0, 0], max: [0, 0, 0] };
  }
  return { positions, normales, triangles, min, max };
}

function lireBinaire(buf: Uint8Array): Maillage {
  const vue = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const triangles = vue.getUint32(80, true);
  if (triangles > STL_TRIANGLES_MAX) throw new Error(`Fichier STL trop gros (${triangles} triangles).`);
  if (84 + triangles * 50 > buf.byteLength) throw new Error('Fichier STL coupé : il manque des triangles.');
  const positions = new Float32Array(triangles * 9);
  for (let t = 0; t < triangles; t += 1) {
    const base = 84 + t * 50 + 12; // la normale écrite (12 octets) est ignorée
    for (let k = 0; k < 9; k += 1) {
      const valeur = vue.getFloat32(base + k * 4, true);
      if (!Number.isFinite(valeur)) throw new Error('Fichier STL illisible : un sommet n’est pas un nombre.');
      positions[t * 9 + k] = valeur;
    }
  }
  return construire(positions);
}

function lireTexte(texte: string): Maillage {
  const nombres: number[] = [];
  const motif = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let trouve: RegExpExecArray | null;
  while ((trouve = motif.exec(texte)) !== null) {
    for (let k = 1; k <= 3; k += 1) {
      const valeur = Number(trouve[k]);
      if (!Number.isFinite(valeur)) throw new Error('Fichier STL illisible : un sommet n’est pas un nombre.');
      nombres.push(valeur);
    }
  }
  if (nombres.length % 9 !== 0) throw new Error('Fichier STL illisible : un triangle n’a pas trois sommets.');
  if (nombres.length / 9 > STL_TRIANGLES_MAX) throw new Error('Fichier STL trop gros.');
  return construire(Float32Array.from(nombres));
}

/** Lit un STL binaire ou texte. Lève une erreur en français s'il est illisible. */
export function lireStl(data: ArrayBuffer | Uint8Array): Maillage {
  const buf = octets(data);
  if (buf.byteLength < 15) throw new Error('Fichier STL vide.');
  if (buf.byteLength >= 84) {
    const triangles = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(80, true);
    if (84 + triangles * 50 === buf.byteLength) return lireBinaire(buf);
  }
  const debut = new TextDecoder('utf-8').decode(buf.subarray(0, Math.min(buf.byteLength, 512))).trimStart().toLowerCase();
  if (debut.startsWith('solid')) {
    const texte = new TextDecoder('utf-8').decode(buf);
    if (/facet/i.test(texte)) return lireTexte(texte);
    if (/endsolid/i.test(texte)) return construire(new Float32Array(0));
  }
  if (buf.byteLength >= 84) return lireBinaire(buf);
  throw new Error('Ce fichier n’est pas un STL.');
}

/** Écrit un STL binaire (pour les essais et les aperçus). */
export function ecrireStlBinaire(positions: Float32Array | readonly number[]): Uint8Array {
  const valeurs = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  if (valeurs.length % 9 !== 0) throw new Error('Il faut 9 nombres par triangle.');
  const triangles = valeurs.length / 9;
  const buf = new Uint8Array(84 + triangles * 50);
  const vue = new DataView(buf.buffer);
  const entete = 'Jarvis atelier 3D';
  for (let i = 0; i < entete.length; i += 1) buf[i] = entete.charCodeAt(i);
  vue.setUint32(80, triangles, true);
  const maillage = construire(valeurs);
  for (let t = 0; t < triangles; t += 1) {
    const base = 84 + t * 50;
    for (let k = 0; k < 3; k += 1) vue.setFloat32(base + k * 4, maillage.normales[t * 9 + k]!, true);
    for (let k = 0; k < 9; k += 1) vue.setFloat32(base + 12 + k * 4, valeurs[t * 9 + k]!, true);
  }
  return buf;
}

export function tailleMaillage(maillage: Maillage): Vec3 {
  return [maillage.max[0] - maillage.min[0], maillage.max[1] - maillage.min[1], maillage.max[2] - maillage.min[2]];
}

/**
 * Arêtes qui ne sont pas partagées par exactement deux triangles. 0 = pièce fermée.
 * Les sommets sont rapprochés au micromètre près (OpenSCAD écrit des nombres arrondis).
 */
export function aretesOuvertes(maillage: Maillage): number {
  const cles = new Map<string, number>();
  const indexDe = (o: number): number => {
    const cle = `${Math.round(maillage.positions[o]! * 1000)},${Math.round(maillage.positions[o + 1]! * 1000)},${Math.round(maillage.positions[o + 2]! * 1000)}`;
    let index = cles.get(cle);
    if (index === undefined) {
      index = cles.size;
      cles.set(cle, index);
    }
    return index;
  };
  const aretes = new Map<string, number>();
  for (let t = 0; t < maillage.triangles; t += 1) {
    const a = indexDe(t * 9);
    const b = indexDe(t * 9 + 3);
    const c = indexDe(t * 9 + 6);
    if (a === b || b === c || a === c) continue; // triangle aplati : ne compte pas
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const cle = p < q ? `${p}-${q}` : `${q}-${p}`;
      aretes.set(cle, (aretes.get(cle) ?? 0) + 1);
    }
  }
  let ouvertes = 0;
  for (const nombre of aretes.values()) if (nombre !== 2) ouvertes += 1;
  return ouvertes;
}

export interface ControleStl {
  ok: boolean;
  fermee: boolean;
  aretesOuvertes: number;
  triangles: number;
  taille: Vec3;
  /** Phrases simples : ce qui ne va pas. Vide si tout va bien. */
  problemes: string[];
}

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');

/**
 * Contrôle d'une pièce rendue : fermée, et à la taille annoncée (à `toleranceMm` près, défaut
 * 0,2 mm). `attendue` : la taille de `Gabarit.taille` ; absente = taille non contrôlée.
 */
export function controlerStl(maillage: Maillage, attendue?: Vec3, toleranceMm = 0.2): ControleStl {
  const problemes: string[] = [];
  const ouvertes = aretesOuvertes(maillage);
  const taille = tailleMaillage(maillage);
  if (maillage.triangles === 0) problemes.push('Le fichier ne contient aucune forme.');
  if (ouvertes > 0) problemes.push(`La pièce n’est pas fermée (${ouvertes} arête(s) ouverte(s)) : le trancheur risque de mal la lire.`);
  if (attendue) {
    const noms = ['longueur', 'largeur', 'hauteur'];
    for (let axe = 0; axe < 3; axe += 1) {
      if (Math.abs(taille[axe]! - attendue[axe]!) > toleranceMm) {
        problemes.push(`${noms[axe]} : ${fmt(taille[axe]!)} mm au lieu de ${fmt(attendue[axe]!)} mm.`);
      }
    }
  }
  return { ok: problemes.length === 0, fermee: ouvertes === 0 && maillage.triangles > 0, aretesOuvertes: ouvertes, triangles: maillage.triangles, taille, problemes };
}

/** Triangles d'un pavé plein (pour les aperçus et les essais). */
function pave(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces = 'xXyYzZ'): number[] {
  const p = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const quads: Record<string, number[]> = {
    z: [0, 3, 2, 1],
    Z: [4, 5, 6, 7],
    y: [0, 1, 5, 4],
    Y: [3, 7, 6, 2],
    x: [0, 4, 7, 3],
    X: [1, 2, 6, 5],
  };
  const out: number[] = [];
  for (const face of faces) {
    const [a, b, c, d] = quads[face]! as [number, number, number, number];
    out.push(...p[a]!, ...p[b]!, ...p[c]!, ...p[a]!, ...p[c]!, ...p[d]!);
  }
  return out;
}

/**
 * Boîte ouverte fermée au sens du maillage (pour les aperçus et les essais) :
 * longueur × largeur × hauteur, parois `e`, fond `f`. Même forme que le gabarit `boite`.
 */
export function maillageBoiteCreuse(L: number, W: number, H: number, e: number, f: number): Float32Array {
  const out: number[] = [];
  // Faces extérieures, sauf le dessus.
  out.push(...pave(0, 0, 0, L, W, H, 'xXyYz'));
  // Intérieur (normales vers le creux) : pavé du creux retourné, sans son dessus.
  const creux = pave(e, e, f, L - e, W - e, H, 'xXyYz');
  for (let t = 0; t < creux.length; t += 9) {
    out.push(...creux.slice(t, t + 3), ...creux.slice(t + 6, t + 9), ...creux.slice(t + 3, t + 6));
  }
  // Dessus des parois : le cadre entre l'extérieur et le creux, en 8 triangles qui partagent
  // exactement les arêtes des faces extérieures et intérieures.
  const ext = [
    [0, 0],
    [L, 0],
    [L, W],
    [0, W],
  ];
  const int = [
    [e, e],
    [L - e, e],
    [L - e, W - e],
    [e, W - e],
  ];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    out.push(ext[i]![0]!, ext[i]![1]!, H, ext[j]![0]!, ext[j]![1]!, H, int[j]![0]!, int[j]![1]!, H);
    out.push(ext[i]![0]!, ext[i]![1]!, H, int[j]![0]!, int[j]![1]!, H, int[i]![0]!, int[i]![1]!, H);
  }
  return Float32Array.from(out);
}

/** Tube (entretoise) : diamètre extérieur `D`, trou `d`, hauteur `H`, `n` côtés. */
export function maillageTube(D: number, d: number, H: number, n = 48): Float32Array {
  const out: number[] = [];
  const R = D / 2;
  const r = d / 2;
  const pt = (rayon: number, i: number, z: number) => [R + rayon * Math.cos((2 * Math.PI * i) / n), R + rayon * Math.sin((2 * Math.PI * i) / n), z];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const [a, b, c, dd] = [pt(R, i, 0), pt(R, j, 0), pt(R, j, H), pt(R, i, H)];
    out.push(...a!, ...b!, ...c!, ...a!, ...c!, ...dd!); // extérieur
    const [e1, e2, e3, e4] = [pt(r, i, 0), pt(r, j, 0), pt(r, j, H), pt(r, i, H)];
    out.push(...e1!, ...e3!, ...e2!, ...e1!, ...e4!, ...e3!); // trou (vers l'axe)
    out.push(...dd!, ...c!, ...e3!, ...dd!, ...e3!, ...e4!); // dessus
    out.push(...a!, ...e2!, ...b!, ...a!, ...e1!, ...e2!); // dessous
  }
  return Float32Array.from(out);
}
