/**
 * Atelier 3D : relire un fichier STL produit par OpenSCAD, sans modèle et sans dépendance.
 *
 * But : ne jamais dire « la pièce est prête » sur un fichier abîmé. On vérifie que la surface est
 * **fermée** (chaque arête partagée par exactement deux triangles, dans les deux sens), et on mesure
 * la boîte qui l'entoure pour la comparer à `taille()` du gabarit.
 *
 * Pur : reçoit les octets du fichier. Unités du fichier (mm pour OpenSCAD).
 */

export interface AnalyseStl {
  format: 'ascii' | 'binaire';
  triangles: number;
  /** Triangles d'aire nulle (ignorés pour les arêtes). */
  degeneres: number;
  /** Arêtes portées par un seul triangle : un trou dans la surface. */
  aretesLibres: number;
  /** Arêtes portées par plus de deux triangles : surface qui se touche elle-même. */
  aretesMultiples: number;
  /** Arêtes parcourues deux fois dans le même sens : triangles retournés. */
  aretesMalOrientees: number;
  fermee: boolean;
  min: [number, number, number];
  max: [number, number, number];
  taille: [number, number, number];
  /** Volume en mm³ (positif si les triangles regardent vers l'extérieur). */
  volume: number;
}

type Vec = [number, number, number];

function estBinaire(octets: Uint8Array): boolean {
  if (octets.length < 84) return false;
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const n = vue.getUint32(80, true);
  return 84 + n * 50 === octets.length;
}

function lireBinaire(octets: Uint8Array): Vec[][] {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const n = vue.getUint32(80, true);
  const out: Vec[][] = [];
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50 + 12;
    const tri: Vec[] = [];
    for (let k = 0; k < 3; k++) {
      const o = base + k * 12;
      tri.push([vue.getFloat32(o, true), vue.getFloat32(o + 4, true), vue.getFloat32(o + 8, true)]);
    }
    out.push(tri);
  }
  return out;
}

function lireAscii(texte: string): Vec[][] {
  const out: Vec[][] = [];
  let courant: Vec[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (const m of texte.matchAll(re)) {
    const v: Vec = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (v.some((x) => !Number.isFinite(x))) throw new Error('STL illisible : coordonnée invalide');
    courant.push(v);
    if (courant.length === 3) {
      out.push(courant);
      courant = [];
    }
  }
  if (courant.length) throw new Error('STL illisible : triangle incomplet');
  return out;
}

/** Relit un STL (ASCII ou binaire). Lève une erreur si le fichier est vide ou illisible. */
export function analyserStl(octets: Uint8Array): AnalyseStl {
  const binaire = estBinaire(octets);
  const triangles = binaire ? lireBinaire(octets) : lireAscii(new TextDecoder().decode(octets));
  if (triangles.length === 0) throw new Error('STL vide : aucun triangle');

  const ids = new Map<string, number>();
  const id = (v: Vec): number => {
    const cle = `${v[0]},${v[1]},${v[2]}`;
    let n = ids.get(cle);
    if (n === undefined) {
      n = ids.size;
      ids.set(cle, n);
    }
    return n;
  };

  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  const dirigees = new Map<string, number>();
  let degeneres = 0;
  let volume = 0;

  for (const [a, b, c] of triangles as [Vec, Vec, Vec][]) {
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        if (v[k]! < min[k]!) min[k] = v[k]!;
        if (v[k]! > max[k]!) max[k] = v[k]!;
      }
    }
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const ia = id(a);
    const ib = id(b);
    const ic = id(c);
    if (ia === ib || ib === ic || ia === ic) {
      degeneres++;
      continue;
    }
    for (const [p, q] of [[ia, ib], [ib, ic], [ic, ia]] as [number, number][]) {
      const cle = `${p}>${q}`;
      dirigees.set(cle, (dirigees.get(cle) ?? 0) + 1);
    }
  }

  let aretesLibres = 0;
  let aretesMultiples = 0;
  let aretesMalOrientees = 0;
  const vues = new Set<string>();
  for (const [cle, n] of dirigees) {
    const [p, q] = cle.split('>');
    const inverse = `${q}>${p}`;
    const nonDirigee = Number(p) < Number(q) ? `${p}-${q}` : `${q}-${p}`;
    if (vues.has(nonDirigee)) continue;
    vues.add(nonDirigee);
    const m = dirigees.get(inverse) ?? 0;
    const total = n + m;
    if (total === 1) aretesLibres++;
    else if (total > 2) aretesMultiples++;
    else if (n !== 1 || m !== 1) aretesMalOrientees++;
  }

  const taille: Vec = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    format: binaire ? 'binaire' : 'ascii',
    triangles: triangles.length,
    degeneres,
    aretesLibres,
    aretesMultiples,
    aretesMalOrientees,
    fermee: aretesLibres === 0 && aretesMultiples === 0 && aretesMalOrientees === 0,
    min,
    max,
    taille,
    volume,
  };
}

/**
 * Compare la taille mesurée à celle annoncée par le gabarit, à `tolerance` mm près
 * (les cercles d'OpenSCAD sont des polygones : un diamètre peut être un peu plus court).
 * Rend les écarts en phrases simples ; vide = conforme.
 */
export function ecartsDeCotes(mesuree: [number, number, number], attendue: [number, number, number], tolerance = 0.2): string[] {
  const axes = ['X', 'Y', 'Z'];
  const out: string[] = [];
  for (let k = 0; k < 3; k++) {
    const d = mesuree[k]! - attendue[k]!;
    if (Math.abs(d) > tolerance) {
      out.push(`${axes[k]} : ${Math.round(mesuree[k]! * 100) / 100} mm mesurés pour ${Math.round(attendue[k]! * 100) / 100} mm attendus.`);
    }
  }
  return out;
}
