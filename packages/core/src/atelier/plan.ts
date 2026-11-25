/**
 * Atelier 3D : lire le plan d'une carte publié par son fabricant (fichier DXF), sans modèle.
 *
 * Demande de l'utilisateur, 25 novembre : « les plans en PDF des fabricants, pour trouver les trous
 * de fixation et la position des prises ; une cote retrouvée sur le plan, sinon manquante, jamais
 * devinée ». Un plan DXF est de la géométrie : le contour de la carte, ses perçages, ce qui dépasse
 * de ses bords. Jarvis la lit lui-même :
 *
 * - **contour** : le calque du contour (« BOARD_OUTLINE », « Edge.Cuts », « Outline »…) ; sans lui,
 *   rien n'est lu. Unité : celle du fichier, ou le millimètre si une cote écrite sur le plan
 *   (« 62.74mm ») tombe sur un côté du contour ; sinon le plan est refusé.
 * - **trous de fixation** : les cercles de 1,8 à 6,5 mm dans le contour, sur un calque de perçage ;
 *   quatre en rectangle donnent les cotes de fixation. Un calque de perçage sans aucun cercle de
 *   cette taille : « aucun trou de fixation sur le plan ».
 * - **ce qui dépasse des bords** : la géométrie (hors cotes, cartouche et contour) qui sort du
 *   contour, groupée le long de chaque bord. Avec un texte du plan tout près qui nomme une prise
 *   (« USB », « UART », « HDMI »…) : une prise, avec sa place et sa largeur ; sans : un dépassement
 *   (antenne d'un module…), gardé dans la boîte sans ouverture.
 *
 * Repère de la carte : x le long du plus grand côté, depuis un coin du contour. Pur : aucune
 * dépendance, aucun accès disque.
 */
import { CODES_BORD, type BordCarte } from './composants.js';

export interface PriseDuPlan {
  bord: BordCarte;
  /** Centre le long du bord (repère de la carte). */
  centre: number;
  largeur: number;
  depasse: number;
  /** Le texte du plan qui la nomme (« USB »). */
  nom: string;
}

export interface PlanLu {
  /** Le calque du contour, et comment l'unité a été établie. */
  calque: string;
  unite: string;
  longueur: number;
  largeur: number;
  /** Trous de fixation trouvés (repère de la carte), ou `null` s'il n'y a pas de calque de perçage. */
  trous: { x: number; y: number; diametre: number }[] | null;
  prises: PriseDuPlan[];
  depassements: Partial<Record<BordCarte, number>>;
  /** Les textes du plan (cartouche compris) : ils disent de quelle carte il s'agit. */
  textes: string[];
}

interface Entite {
  type: string;
  calque: string;
  g: [string, string][];
}

const CALQUE_CONTOUR = /board[ _.-]?outline|edge[ _.-]?cuts|^outline$|^contour|pcb[ _.-]?outline|board[ _.-]?edge|^dimension$/i;
const CALQUE_PERCAGE = /drill|hole|trou|percage|per[cç]age|mount/i;
const CALQUE_NOTES = /dim|cote|anno|title|cartouche|frame|border|^text|note|logo|ref/i;
const TEXTE_PRISE = /\b(?:usb(?:[ -]?c)?|uart|type[ -]?c|micro[ -]?usb|hdmi|jack|dc[ -]?in|power|pwr|alim\w*|rj45|ethernet|lan|sd|tf|audio|vin)\b/i;

/** Les entités du fichier (section ENTITIES), et l'unité déclarée. */
function lireEntites(texte: string): { entites: Entite[]; insunits: number | null } {
  const lignes = texte.split(/\r?\n/);
  const entites: Entite[] = [];
  let insunits: number | null = null;
  let section = '';
  let courante: Entite | null = null;
  let polyligne: Entite | null = null;
  for (let i = 0; i + 1 < lignes.length; i += 2) {
    const code = lignes[i]!.trim();
    const valeur = lignes[i + 1]!.trim();
    if (code === '0' && valeur === 'SECTION') {
      section = '';
      courante = null;
      continue;
    }
    if (code === '2' && section === '' && courante === null) {
      section = valeur;
      continue;
    }
    if (code === '9' && valeur === '$INSUNITS' && i + 3 < lignes.length) insunits = Number(lignes[i + 3]!.trim());
    if (section !== 'ENTITIES') continue;
    if (code === '0') {
      if (valeur === 'ENDSEC') {
        section = '';
        courante = null;
        continue;
      }
      // Ancienne polyligne : ses sommets (VERTEX) lui sont rattachés jusqu'à SEQEND.
      if (valeur === 'VERTEX' && polyligne) {
        courante = { type: 'VERTEX', calque: polyligne.calque, g: [] };
        continue;
      }
      if (valeur === 'SEQEND') {
        polyligne = null;
        courante = null;
        continue;
      }
      courante = { type: valeur, calque: '', g: [] };
      entites.push(courante);
      polyligne = valeur === 'POLYLINE' ? courante : null;
      continue;
    }
    if (!courante) continue;
    if (courante.type === 'VERTEX' && polyligne) {
      if (code === '10' || code === '20' || code === '42') polyligne.g.push([code, valeur]);
      continue;
    }
    if (code === '8') courante.calque = valeur;
    courante.g.push([code, valeur]);
  }
  return { entites, insunits };
}

const nb = (v: string | undefined) => (v === undefined ? Number.NaN : Number(v));
function premier(e: Entite, code: string): string | undefined {
  return e.g.find(([c]) => c === code)?.[1];
}

/** Sommets d'une polyligne (x, y, renflement). */
function sommets(e: Entite): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [c, v] of e.g) {
    if (c === '10') out.push([Number(v), Number.NaN, 0]);
    else if (c === '20' && out.length) out[out.length - 1]![1] = Number(v);
    else if (c === '42' && out.length) out[out.length - 1]![2] = Number(v);
  }
  return out.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

/** Les points d'une entité (pour le contour et ce qui dépasse). */
function points(e: Entite): [number, number][] {
  switch (e.type) {
    case 'LINE':
      return [
        [nb(premier(e, '10')), nb(premier(e, '20'))],
        [nb(premier(e, '11')), nb(premier(e, '21'))],
      ];
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return sommets(e).map(([x, y]) => [x, y]);
    case 'CIRCLE':
    case 'ARC': {
      const cx = nb(premier(e, '10'));
      const cy = nb(premier(e, '20'));
      const r = nb(premier(e, '40'));
      const a0 = e.type === 'ARC' ? nb(premier(e, '50')) : 0;
      let a1 = e.type === 'ARC' ? nb(premier(e, '51')) : 360;
      if (a1 <= a0) a1 += 360;
      const out: [number, number][] = [];
      for (let k = 0; k <= 16; k += 1) {
        const a = ((a0 + ((a1 - a0) * k) / 16) * Math.PI) / 180;
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return out;
    }
    default:
      return [];
  }
}

/** Les points d'une entité, avec ses traits découpés tous les 0,5 mm (un rectangle n'a pas que ses coins). */
function pointsDenses(e: Entite): [number, number][] {
  const p = points(e);
  if (e.type !== 'LINE' && e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') return p;
  const ferme = (e.type !== 'LINE' && (nb(premier(e, '70')) & 1) === 1) ? [p[0]!] : [];
  const suite = [...p, ...ferme];
  const out: [number, number][] = [];
  for (let i = 0; i < suite.length; i += 1) {
    const a = suite[i]!;
    out.push(a);
    const b = suite[i + 1];
    if (!b) continue;
    const n = Math.min(400, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let k = 1; k < n; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Un cercle (perçage) : CIRCLE, arc complet, ou polyligne de deux demi-cercles. */
function cercle(e: Entite): { x: number; y: number; d: number } | null {
  if (e.type === 'CIRCLE') return { x: nb(premier(e, '10')), y: nb(premier(e, '20')), d: 2 * nb(premier(e, '40')) };
  if (e.type === 'ARC') {
    let a1 = nb(premier(e, '51'));
    const a0 = nb(premier(e, '50'));
    if (a1 <= a0) a1 += 360;
    return a1 - a0 >= 359 ? { x: nb(premier(e, '10')), y: nb(premier(e, '20')), d: 2 * nb(premier(e, '40')) } : null;
  }
  if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
    const s = sommets(e);
    if (s.length === 2 && Math.abs(Math.abs(s[0]![2]) - 1) < 1e-3 && Math.abs(Math.abs(s[1]![2]) - 1) < 1e-3) {
      const d = Math.hypot(s[1]![0] - s[0]![0], s[1]![1] - s[0]![1]);
      return { x: (s[0]![0] + s[1]![0]) / 2, y: (s[0]![1] + s[1]![1]) / 2, d };
    }
  }
  return null;
}

/** Texte d'une entité TEXT, MTEXT ou DIMENSION, sans les codes de mise en forme. */
function texteDe(e: Entite): string | null {
  if (e.type !== 'TEXT' && e.type !== 'MTEXT' && e.type !== 'DIMENSION') return null;
  const brut = e.g.filter(([c]) => c === '1' || (e.type === 'MTEXT' && c === '3')).map(([, v]) => v).join('');
  if (e.type === 'DIMENSION' && (!brut || brut.includes('<>'))) {
    const mesure = nb(premier(e, '42'));
    return Number.isFinite(mesure) ? `${brut.replace('<>', String(Math.round(mesure * 100) / 100)) || Math.round(mesure * 100) / 100}` : null;
  }
  return brut.replace(/\\[PpNn]/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim() || null;
}

/** Valeurs en millimètres écrites sur le plan (« 62.74mm », « 25,40 mm »). */
function cotesEcrites(textes: readonly string[]): number[] {
  const out: number[] = [];
  for (const t of textes) for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*mm\b/gi)) out.push(Number(m[1]!.replace(',', '.')));
  return out;
}

const FACTEURS: Record<number, number> = { 1: 25.4, 4: 1, 5: 10, 6: 1000 };

export type LectureDxf = { ok: true; plan: PlanLu } | { ok: false; raison: string };

/** Lit un plan DXF. `ok: false` avec une phrase quand rien de sûr ne peut en être tiré. */
export function lireDxf(texte: string): LectureDxf {
  if (!/\bSECTION\b/.test(texte.slice(0, 4000)) || !/\bENTITIES\b/.test(texte)) return { ok: false, raison: 'ce n’est pas un fichier DXF lisible' };
  const { entites, insunits } = lireEntites(texte);
  const textesEntites = entites.map((e) => ({ e, t: texteDe(e) })).filter((x): x is { e: Entite; t: string } => Boolean(x.t));
  const textes = textesEntites.map((x) => x.t);

  // Le contour : le calque nommé comme tel, le plus garni.
  const calques = new Map<string, Entite[]>();
  for (const e of entites) calques.set(e.calque, [...(calques.get(e.calque) ?? []), e]);
  const contourCalque = [...calques.keys()].filter((c) => CALQUE_CONTOUR.test(c)).sort((a, b) => calques.get(b)!.length - calques.get(a)!.length)[0];
  if (!contourCalque) return { ok: false, raison: 'je n’y trouve pas de calque de contour de carte' };
  const pc = calques.get(contourCalque)!.flatMap(points).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pc.length < 3) return { ok: false, raison: 'le contour de la carte est vide' };
  const X0 = Math.min(...pc.map((p) => p[0]));
  const X1 = Math.max(...pc.map((p) => p[0]));
  const Y0 = Math.min(...pc.map((p) => p[1]));
  const Y1 = Math.max(...pc.map((p) => p[1]));
  const cotesBrutes = [X1 - X0, Y1 - Y0];

  // L'unité : déclarée, ou confirmée par une cote écrite qui tombe sur un côté du contour.
  const ecrites = cotesEcrites(textes);
  const confirme = (k: number) => ecrites.some((v) => cotesBrutes.some((c) => Math.abs(v - c * k) <= Math.max(0.3, 0.01 * v)));
  let k: number | null = null;
  let unite = '';
  if (confirme(1)) {
    k = 1;
    unite = 'millimètre (cote écrite sur le plan)';
  } else if (insunits !== null && FACTEURS[insunits] !== undefined) {
    k = FACTEURS[insunits]!;
    unite = insunits === 1 ? 'pouce, converti' : 'déclarée dans le fichier';
  }
  if (k === null) return { ok: false, raison: 'je ne sais pas en quelle unité il est dessiné' };

  // Repère de la carte : x le long du plus grand côté.
  const tourne = Y1 - Y0 > X1 - X0;
  const versCarte = (X: number, Y: number): [number, number] => (tourne ? [(Y - Y0) * k!, (X1 - X) * k!] : [(X - X0) * k!, (Y - Y0) * k!]);
  const longueur = Math.max(X1 - X0, Y1 - Y0) * k;
  const largeur = Math.min(X1 - X0, Y1 - Y0) * k;
  const dedans = (X: number, Y: number) => X > X0 + 0.05 && X < X1 - 0.05 && Y > Y0 + 0.05 && Y < Y1 - 0.05;

  // Les trous de fixation, sur un calque de perçage (ou le contour).
  const percage = [...calques.keys()].filter((c) => CALQUE_PERCAGE.test(c) || c === contourCalque);
  const cercles = percage.flatMap((c) => calques.get(c)!.map(cercle)).filter((c): c is { x: number; y: number; d: number } => Boolean(c) && dedans(c!.x, c!.y));
  const aDesPercages = [...calques.keys()].some((c) => CALQUE_PERCAGE.test(c) && calques.get(c)!.length > 0);
  const fixation: { x: number; y: number; diametre: number }[] = [];
  for (const c of cercles) {
    const d = c.d * k;
    if (d < 1.8 || d > 6.5) continue;
    const [x, y] = versCarte(c.x, c.y);
    // Deux cercles au même centre (perçage et pastille) : le plus petit est le trou.
    const meme = fixation.find((t) => Math.hypot(t.x - x, t.y - y) < 0.1);
    if (meme) meme.diametre = Math.min(meme.diametre, d);
    else fixation.push({ x, y, diametre: d });
  }

  // Ce qui dépasse des bords : géométrie hors contour, hors calques de notes et de cotes.
  const notes = new Set(
    [...calques.keys()].filter((c) => CALQUE_NOTES.test(c) || calques.get(c)!.some((e) => {
      const t = texteDe(e);
      return e.type === 'DIMENSION' || (t !== null && (/\d\s*mm\b/i.test(t) || /\b(?:date|title|rev|scale|sheet|drawn)\b/i.test(t)));
    })),
  );
  const dehors: { bord: BordCarte; a: number; d: number }[] = [];
  for (const [calque, es] of calques) {
    if (calque === contourCalque || notes.has(calque)) continue;
    for (const e of es) {
      for (const [X, Y] of pointsDenses(e)) {
        if (!Number.isFinite(X) || !Number.isFinite(Y)) continue;
        const [x, y] = versCarte(X, Y);
        const sorties = [
          { bord: 'x-' as const, d: -x, a: y, dansA: y >= 0 && y <= largeur },
          { bord: 'x+' as const, d: x - longueur, a: y, dansA: y >= 0 && y <= largeur },
          { bord: 'y-' as const, d: -y, a: x, dansA: x >= 0 && x <= longueur },
          { bord: 'y+' as const, d: y - largeur, a: x, dansA: x >= 0 && x <= longueur },
        ].filter((s) => s.d > 0.05);
        // Un point sorti par un seul bord, en face de la carte, à moins de 30 mm : un dépassement.
        if (sorties.length === 1 && sorties[0]!.dansA && sorties[0]!.d <= 30) dehors.push({ bord: sorties[0]!.bord, a: sorties[0]!.a, d: sorties[0]!.d });
      }
    }
  }
  const prises: PriseDuPlan[] = [];
  const depassements: Partial<Record<BordCarte, number>> = {};
  for (const bord of CODES_BORD) {
    const pts = dehors.filter((p) => p.bord === bord).sort((a, b) => a.a - b.a);
    // Groupes le long du bord : un écart de plus de 1,5 mm sépare deux objets.
    const groupes: { a0: number; a1: number; d: number }[] = [];
    for (const p of pts) {
      const g = groupes[groupes.length - 1];
      if (g && p.a - g.a1 <= 1.5) {
        g.a1 = p.a;
        g.d = Math.max(g.d, p.d);
      } else groupes.push({ a0: p.a, a1: p.a, d: p.d });
    }
    for (const g of groupes) {
      if (g.a1 - g.a0 < 1.5) continue; // un point isolé : un trait de cote, une flèche
      // Une prise fait moins de 20 mm de large (une rangée de broches qui déborde n'en est pas une) ;
      // elle est nommée par le texte du plan le plus proche de son milieu, à moins de 10 mm du bord.
      const centre = (g.a0 + g.a1) / 2;
      const nom =
        g.a1 - g.a0 <= 20
          ? textesEntites
              .filter(({ e }) => !notes.has(e.calque))
              .map(({ e, t }) => {
                const p = versCarte(nb(premier(e, '10')), nb(premier(e, '20')));
                const [a, profondeur] = bord === 'x-' ? [p[1], p[0]] : bord === 'x+' ? [p[1], longueur - p[0]] : bord === 'y-' ? [p[0], p[1]] : [p[0], largeur - p[1]];
                return { t, a, profondeur, distance: Math.hypot(a - centre, profondeur) };
              })
              .filter((x) => TEXTE_PRISE.test(x.t) && Number.isFinite(x.distance) && x.profondeur >= -1 && x.profondeur <= 10 && x.a >= g.a0 - 4 && x.a <= g.a1 + 4)
              .sort((a, b) => a.distance - b.distance)[0]?.t
          : undefined;
      if (nom) prises.push({ bord, centre, largeur: g.a1 - g.a0, depasse: g.d, nom });
      else depassements[bord] = Math.max(depassements[bord] ?? 0, g.d);
    }
  }
  return {
    ok: true,
    plan: {
      calque: contourCalque,
      unite,
      longueur,
      largeur,
      trous: aDesPercages ? fixation : fixation.length ? fixation : null,
      prises,
      depassements,
      textes,
    },
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Les cotes qu'un plan donne, par champ (ceux des mesures de la bibliothèque). Quatre trous en
 * rectangle donnent la fixation ; un calque de perçage sans trou de fixation donne « sans_trous » ;
 * les prises d'un même bord (trois au plus) et les dépassements suivent.
 */
export function cotesDuPlan(plan: PlanLu): { champ: string; valeur: number }[] {
  const out: { champ: string; valeur: number }[] = [
    { champ: 'longueur', valeur: r2(plan.longueur) },
    { champ: 'largeur', valeur: r2(plan.largeur) },
  ];
  const t = plan.trous;
  if (t && t.length === 0) out.push({ champ: 'sans_trous', valeur: 1 });
  if (t && t.length === 4) {
    const xs = [...new Set(t.map((p) => r2(p.x)))].sort((a, b) => a - b);
    const ys = [...new Set(t.map((p) => r2(p.y)))].sort((a, b) => a - b);
    const proches = (v: number[]) => v.length === 2 || (v.length > 2 && v[v.length - 1]! - v[0]! < 0.2);
    // Quatre trous en rectangle (deux x, deux y, à 0,1 mm près).
    const gx = [...new Set(t.map((p) => Math.round(p.x * 10)))];
    const gy = [...new Set(t.map((p) => Math.round(p.y * 10)))];
    if (gx.length === 2 && gy.length === 2 && proches(xs) && proches(ys)) {
      out.push(
        { champ: 'trou_diametre', valeur: r2(Math.min(...t.map((p) => p.diametre))) },
        { champ: 'entraxe_x', valeur: r2(xs[xs.length - 1]! - xs[0]!) },
        { champ: 'entraxe_y', valeur: r2(ys[ys.length - 1]! - ys[0]!) },
        { champ: 'trou_bord_x', valeur: r2(xs[0]!) },
        { champ: 'trou_bord_y', valeur: r2(ys[0]!) },
      );
    }
  }
  // Les prises : le bord qui en a le plus, trois au plus, dans l'ordre le long du bord.
  const parBord = new Map<BordCarte, PriseDuPlan[]>();
  for (const p of plan.prises) parBord.set(p.bord, [...(parBord.get(p.bord) ?? []), p]);
  const [bord, prises] = [...parBord.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (bord && prises) {
    out.push({ champ: 'prise_bord', valeur: CODES_BORD.indexOf(bord) + 1 });
    prises
      .sort((a, b) => a.centre - b.centre)
      .slice(0, 3)
      .forEach((p, i) => {
        out.push({ champ: `prise${i + 1}_centre`, valeur: r2(p.centre) }, { champ: `prise${i + 1}_largeur`, valeur: r2(p.largeur) }, { champ: `prise${i + 1}_depasse`, valeur: r2(p.depasse) });
      });
  }
  const codes: Record<BordCarte, string> = { 'x+': 'xp', 'x-': 'xm', 'y+': 'yp', 'y-': 'ym' };
  for (const [b, d] of Object.entries(plan.depassements) as [BordCarte, number][]) out.push({ champ: `depasse_${codes[b]}`, valeur: r2(d) });
  return out;
}

/** Ce que le plan a donné, en une phrase. */
export function direPlan(plan: PlanLu): string {
  const morceaux = [`carte de ${String(r2(plan.longueur)).replace('.', ',')} × ${String(r2(plan.largeur)).replace('.', ',')} mm`];
  if (plan.trous && plan.trous.length === 0) morceaux.push('aucun trou de fixation');
  else if (plan.trous?.length) morceaux.push(`${plan.trous.length} trou${plan.trous.length > 1 ? 's' : ''} de fixation`);
  if (plan.prises.length) morceaux.push(`${plan.prises.length} prise${plan.prises.length > 1 ? 's' : ''} (${plan.prises.map((p) => p.nom).join(', ')})`);
  if (Object.keys(plan.depassements).length) morceaux.push('un module qui dépasse du bord');
  return morceaux.join(', ');
}
