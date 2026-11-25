/**
 * Atelier 3D : les contrôles du boîtier à écran, repris un à un du banc de la référence
 * (`reference/sources/banc_hub.py`, 64 contrôles pour le hub) : collisions, jeux des prises,
 * socle, caméra, écran, champ de vision, cache, visserie, liaisons, câbles, stabilité.
 *
 * Mêmes méthodes que la référence, sur le même arbre de formes que le .scad (`csg.ts`, `geo`) :
 * - volume commun de deux pièces sur une grille de 0,3 mm ;
 * - plus petite distance entre un composant et une pièce par transformée de distance sur une grille
 *   (au plus 6 millions de points) ;
 * - rayons du champ de la caméra, flexion des retenues, prise des vis, bascule.
 *
 * Pur : aucune dépendance. Long (de l'ordre de la minute) : à lancer hors du fil de la fenêtre.
 */
import { DONNEES_COMPOSANTS } from './composantsDonnees.js';
import { boite, cyl, dedans, diff, type Aabb, type Forme, type Geo } from './csg.js';
import { boiteCarte, carteDuBoitier, DESSIN_BOITIER_ECRAN as DB, type BoitierEcran } from './boitierEcran.js';
import { CAMERA, flexionRetenue, ALLONGEMENT_MAX, PROFONDEURS_CAMERA, RETENUE, reglageChariot } from './tenir.js';
import { choisirVisM3, PAROI_INSERT_MIN, PRISE_MAX, PRISE_MIN, AVANT_TROU } from './visserie.js';

const C = DONNEES_COMPOSANTS.composants;
const PI5 = C.raspberry_pi_5;
const ECR = C.touch_display_2_7;
const CAM = C.camera_module_3_wide;
const K = CAMERA;
const PW = PROFONDEURS_CAMERA;

export interface ControleBoitier {
  groupe: string;
  controle: string;
  ok: boolean;
  mesure: string;
  attendu: string;
}

const f1 = (x: number) => x.toFixed(1);

let dernierePause = Date.now();
/**
 * Rend la main toutes les 25 ms : le banc dure une minute, il tourne dans le processus principal de
 * Jarvis sans bloquer la fenêtre ni le téléphone.
 */
async function respirer(): Promise<void> {
  if (Date.now() - dernierePause < 25) return;
  await new Promise((r) => setTimeout(r, 0));
  dernierePause = Date.now();
}
const f2 = (x: number) => x.toFixed(2);

function geoDe(f: Forme): Geo {
  if (!f.geo) throw new Error('forme sans géométrie');
  return f.geo;
}

function interAabb(a: Aabb, b: Aabb): Aabb | null {
  const c: Aabb = [Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.min(a[3], b[3]), Math.max(a[4], b[4]), Math.min(a[5], b[5])];
  return c[0] < c[1] && c[2] < c[3] && c[4] < c[5] ? c : null;
}

function axe(a: number, b: number, h: number, decal: number): number[] {
  const out: number[] = [];
  for (let x = a + decal * h; x < b; x += h) out.push(x);
  return out;
}

/** Volume commun de deux formes (mm³), sur une grille de pas h. */
export async function volumeCommun(fa: Forme, fb: Forme, h = 0.3): Promise<number> {
  const ga = geoDe(fa);
  const gb = geoDe(fb);
  const c = interAabb(ga.aabb, gb.aabb);
  if (!c) return 0;
  const xs = axe(c[0], c[1], h, 0.1234);
  const ys = axe(c[2], c[3], h, 0.1234);
  const zs = axe(c[4], c[5], h, 0.1234);
  let n = 0;
  for (const z of zs)
    for (const y of ys) {
      await respirer();
      for (const x of xs) if (dedans(ga, x, y, z) && dedans(gb, x, y, z)) n += 1;
    }
  return n * h ** 3;
}

/** Valeur « loin » de la transformée (finie : l'algorithme fait des différences). */
const LOIN = 1e20;

/** Transformée de distance euclidienne exacte (au carré) d'une grille, en nombre de cases (Felzenszwalb). */
function distanceAuCarre(f: Float64Array, nx: number, ny: number, nz: number): void {
  const n = Math.max(nx, ny, nz);
  const g = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const zt = new Float64Array(n + 1);
  const passe = (len: number) => {
    let k = 0;
    v[0] = 0;
    zt[0] = -Infinity;
    zt[1] = Infinity;
    for (let q = 1; q < len; q += 1) {
      let s = (g[q]! + q * q - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= zt[k]!) {
        k -= 1;
        s = (g[q]! + q * q - (g[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k += 1;
      v[k] = q;
      zt[k] = s;
      zt[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q += 1) {
      while (zt[k + 1]! < q) k += 1;
      const p = v[k]!;
      d[q] = (q - p) * (q - p) + g[p]!;
    }
  };
  // le long de x
  for (let iz = 0; iz < nz; iz += 1)
    for (let iy = 0; iy < ny; iy += 1) {
      const o = (iz * ny + iy) * nx;
      for (let i = 0; i < nx; i += 1) g[i] = f[o + i]!;
      passe(nx);
      for (let i = 0; i < nx; i += 1) f[o + i] = d[i]!;
    }
  for (let iz = 0; iz < nz; iz += 1)
    for (let ix = 0; ix < nx; ix += 1) {
      for (let i = 0; i < ny; i += 1) g[i] = f[(iz * ny + i) * nx + ix]!;
      passe(ny);
      for (let i = 0; i < ny; i += 1) f[(iz * ny + i) * nx + ix] = d[i]!;
    }
  for (let iy = 0; iy < ny; iy += 1)
    for (let ix = 0; ix < nx; ix += 1) {
      for (let i = 0; i < nz; i += 1) g[i] = f[(i * ny + iy) * nx + ix]!;
      passe(nz);
      for (let i = 0; i < nz; i += 1) f[(i * ny + iy) * nx + ix] = d[i]!;
    }
}

/** Plus petite distance (mm) entre un composant et une pièce, à h près ; 0 s'ils se touchent. */
export async function jeuMini(comp: Forme, piece: Forme, marge = 6, h0 = 0.2): Promise<number> {
  const gc = geoDe(comp);
  const gp = geoDe(piece);
  const b = gc.aabb;
  const reg: Aabb = [b[0] - marge, b[1] + marge, b[2] - marge, b[3] + marge, b[4] - marge, b[5] + marge];
  if (!interAabb(reg, gp.aabb)) return Infinity;
  const vol = (reg[1] - reg[0]) * (reg[3] - reg[2]) * (reg[5] - reg[4]);
  const h = Math.max(h0, Math.cbrt(vol / 6e6));
  const xs = axe(reg[0], reg[1], h, 0);
  const ys = axe(reg[2], reg[3], h, 0);
  const zs = axe(reg[4], reg[5], h, 0);
  const nx = xs.length;
  const ny = ys.length;
  const nz = zs.length;
  const f = new Float64Array(nx * ny * nz);
  const cc = new Uint8Array(nx * ny * nz);
  let unePiece = false;
  let i = 0;
  for (let iz = 0; iz < nz; iz += 1)
    for (let iy = 0; iy < ny; iy += 1) {
      await respirer();
      for (let ix = 0; ix < nx; ix += 1, i += 1) {
        const x = xs[ix]!;
        const y = ys[iy]!;
        const z = zs[iz]!;
        const p = dedans(gp, x, y, z);
        const k = dedans(gc, x, y, z);
        if (p && k) return 0;
        f[i] = p ? 0 : LOIN;
        if (p) unePiece = true;
        if (k) cc[i] = 1;
      }
    }
  if (!unePiece) return Infinity;
  distanceAuCarre(f, nx, ny, nz);
  let m = Infinity;
  for (let j = 0; j < f.length; j += 1) if (cc[j] && f[j]! < m) m = f[j]!;
  return Math.sqrt(m) * h - h / 2;
}

function linspace(a: number, b: number, n: number, fin = true): number[] {
  const out: number[] = [];
  const pas = (b - a) / (fin ? n - 1 : n);
  for (let i = 0; i < n; i += 1) out.push(a + i * pas);
  return out;
}

/** Avancement du banc (part de 0 à 1, et ce qui est en cours). */
export type AvancementBanc = (part: number, quoi: string) => void;

/**
 * Les contrôles du boîtier, dans l'ordre du banc de la référence. Pour le hub (caméra et cache), il
 * y en a 64 ; sans cache ou sans caméra, ceux qui n'ont pas d'objet ne sont pas comptés.
 */
export async function controlerBoitierEcran(b: BoitierEcran, avancement: AvancementBanc = () => undefined): Promise<ControleBoitier[]> {
  const res: ControleBoitier[] = [];
  const note = (groupe: string, controle: string, ok: boolean, mesure: string, attendu = '') => res.push({ groupe, controle, ok, mesure, attendu });
  const c = b.c;
  const ch = b.choix;
  const carte = carteDuBoitier(b);
  const [piX0, piX1, piY0, piY1] = carte.rect;
  const REG = K.reglage;
  const decals = ch.camera ? [0, -REG, REG] : [0];

  // ------------------------------------------------------------------ 1. collisions
  const etats: ['ouvert' | 'ferme', number][] = ch.camera ? [['ouvert', 0], ['ferme', 0], ['ouvert', -REG], ['ferme', REG]] : [['ouvert', 0]];
  const socle = b.socle();
  const capot = b.capot();
  const carteF = b.carte();
  for (const [e, [etat, decal]] of etats.entries()) {
    avancement(0.05 + 0.3 * (e / etats.length), 'collisions');
    const mod = b.piecesModule({ cache: etat, decalCam: decal });
    const compMod: Record<string, Forme> = { '[Ecran]': b.ecran(7.5) };
    if (ch.camera) compMod['[Camera]'] = b.cameraModule(decal);
    const pire: string[] = [];
    const essayer = async (na: string, fa: Forme, nb: string, fb: Forme) => {
      const v = await volumeCommun(fa, fb);
      if (v > 0.05) pire.push(`${na} / ${nb} : ${f2(v)} mm³`);
    };
    // dans le repère du module : pièces du module entre elles, et avec l'écran et la caméra
    const nm = Object.keys(mod);
    for (let i = 0; i < nm.length; i += 1) for (let j = i + 1; j < nm.length; j += 1) await essayer(nm[i]!, mod[nm[i]!]!, nm[j]!, mod[nm[j]!]!);
    for (const [ncp, fcp] of Object.entries(compMod)) for (const n of nm) await essayer(n, mod[n]!, ncp, fcp);
    // dans le monde : socle et capot avec tout
    const monde: Record<string, Forme> = {};
    for (const n of nm) monde[n] = b.versMonde(mod[n]!);
    for (const [ncp, fcp] of Object.entries(compMod)) monde[ncp] = b.versMonde(fcp);
    monde['[Raspberry Pi 5]'] = carteF;
    for (const [n, f] of Object.entries(monde)) {
      await essayer('Socle', socle, n, f);
      await essayer('Capot', capot, n, f);
    }
    await essayer('Socle', socle, 'Capot', capot);
    const titre = ch.camera ? `aucune pièce ne rentre dans une autre (cache ${ch.cache ? etat : 'absent'}, caméra décalée de ${decal >= 0 ? '+' : ''}${decal} mm)` : 'aucune pièce ne rentre dans une autre';
    note('collisions', titre, !pire.length, pire.length ? pire.join(' ; ') : 'aucune', 'aucune');
  }

  // ------------------------------------------------------------------ 2. jeux autour des composants
  avancement(0.4, 'prises');
  for (const p of b.prises) {
    const [x, y, zcen] = p.centre;
    const z0 = zcen - p.hauteur / 2;
    const z1 = zcen + p.hauteur / 2;
    const bord = p.paroi === 'arriere' ? piY1 : piX1;
    const f =
      p.paroi === 'arriere'
        ? boite(x - p.largeur / 2, x + p.largeur / 2, bord - 2, DB.SOC_P + 3, z0, z1)
        : boite(bord - 2, c.FW / 2 + 3, y - p.largeur / 2, y + p.largeur / 2, z0, z1);
    const j = await jeuMini(f, socle, 6, 0.1);
    const mini = p.depasse ? DB.JEU_PORT - 0.15 : 0.45;
    note('ports', `${p.nom} : jeu autour de la prise dans la paroi ${p.paroi === 'arriere' ? 'arrière' : 'droite'}`, j >= mini, `${f2(j)} mm`, `≥ ${f2(mini)}`);
  }
  const paroiRas = b.prises.find((p) => !p.depasse)?.paroi ?? 'droite';
  note(
    'ports',
    `paroi restante devant USB-C et micro-HDMI (creux de ${f1(DB.CREUX_PAROI)} mm)`,
    true,
    `${f1(DB.PAROI - DB.CREUX_PAROI)} mm, prise à ${f1(DB.JEU_PI_RAS + DB.PAROI - DB.CREUX_PAROI)} mm du bord de la carte (paroi ${paroiRas === 'arriere' ? 'arrière' : 'droite'})`,
  );
  avancement(0.45, 'socle');
  const v = PI5.ventilateur_officiel.enveloppe_prudente;
  const fan = boiteCarte(b, v.px[0], v.px[1], v.py[0], v.py[1]);
  let j = await jeuMini(boite(fan[0], fan[1], fan[2], fan[3], c.zPcb1, c.zPcb1 + v.hauteur), capot, 10, 0.2);
  note('socle', 'ventilateur du Pi -> dessous du capot (air pour l’aspiration)', j >= PI5.ventilateur_officiel.air_au_dessus_mini, `${f1(j)} mm`, `≥ ${PI5.ventilateur_officiel.air_au_dessus_mini}`);
  j = await jeuMini(
    boite(piX0, piX1, piY0, piY1, c.zPcb0, c.zPcb1, PI5.carte.rayon_coins),
    diff(socle, ...carte.trous.map(([x, y]) => cyl(x, y, 0, c.zPcb0 + 0.01, 3.2))),
    3,
    0.1,
  );
  note('socle', 'carte du Pi -> parois et bossages (hors plots)', j >= 0.4, `${f2(j)} mm`, '≥ 0,4');
  const gp = boiteCarte(b, 7, 13, 50.5, 55.5);
  j = await jeuMini(boite(gp[0], gp[1], gp[2], gp[3], c.zPcb1, c.zPcb1 + PI5.gpio.hauteur_avec_fil_dupont), capot, 8, 0.2);
  note('socle', 'fils Dupont sur le GPIO -> capot', j >= 3, `${f1(j)} mm`, '≥ 3');

  if (ch.camera) {
    for (const [i, decal] of decals.entries()) {
      avancement(0.5 + 0.08 * (i / 3), 'caméra');
      const mod = b.piecesModule({ decalCam: decal });
      const cam = b.cameraModule(decal);
      for (const n of ['Facade', 'Volet', 'Dos']) {
        if (!mod[n]) continue;
        const jj = await jeuMini(cam, mod[n]!, 6, 0.15);
        note('caméra', `caméra (décalée de ${decal >= 0 ? '+' : ''}${decal}) -> ${n}`, jj >= 0.25, `${f2(jj)} mm`, '≥ 0,25');
      }
    }
  }
  avancement(0.6, 'écran');
  const dosF = b.dos();
  const facF = b.facade();
  j = c.W_TOT - c.DOS_EP - (c.PEAU + ECR.profondeur_totale.valeur);
  note('écran', `dos de l’écran (${ECR.profondeur_totale.valeur} mm, doc) -> fond du dos (place pour les nappes)`, j >= 6, `${f1(j)} mm`, '≥ 6');
  const ecr = b.ecran(ECR.epaisseur_au_bord.valeur);
  j = await jeuMini(ecr, dosF, 6, 0.15);
  note('écran', 'écran -> dos du boîtier (jeu le plus petit, au bord de la vitre)', j >= 1, `${f1(j)} mm`, '≥ 1');
  if (ch.camera) {
    j = await jeuMini(ecr, b.piecesModule().Chariot_camera!, 6, 0.2);
    note('écran', 'écran -> chariot de la caméra', j >= 1, `${f1(j)} mm`, '≥ 1');
  }

  // ------------------------------------------------------------------ 3. écran : maintien et zone visible
  const [t0, t1] = ECR.epaisseur_au_bord.plage_a_accepter;
  for (const t of [t0, ECR.epaisseur_au_bord.valeur, t1]) {
    const fl = flexionRetenue(t);
    note(
      'écran',
      `écran épais de ${f1(t)} mm au bord : flexion des 4 retenues`,
      fl.fleche >= 0 && fl.fleche <= 3.05 && fl.allongement <= ALLONGEMENT_MAX,
      `flèche ${f1(fl.fleche)} mm, ${f1(fl.effort)} N par retenue, allongement ${f1(fl.allongement)} %`,
      `0 à 3 mm, ≤ ${String(ALLONGEMENT_MAX).replace('.', ',')} % (PETG)`,
    );
  }
  note('écran', 'bosse des retenues sur le bord de la vitre', true, `de 1.0 à ${f1(RETENUE.recouvrement - 0.3)} mm à l’intérieur du bord de la vitre`);
  const [vu, vv] = [ECR.zone_visible.longueur, ECR.zone_visible.hauteur];
  let cache = 0;
  const us = linspace(-vu / 2, vu / 2, 200);
  const vs = linspace(c.vVit0 + (c.ECR_H - vv) / 2, c.vVit1 - (c.ECR_H - vv) / 2, 120);
  for (const w of linspace(-0.01, c.PEAU - 0.05, 12))
    for (const vy of vs) {
      await respirer();
      for (const ux of us) if (dedans(facF, ux, vy, w)) cache += 1;
    }
  note('écran', `zone visible (${String(vu).replace('.', ',')} × ${vv}, centrée) entièrement dégagée`, cache === 0, `${cache} points cachés`, '0');
  const fu = c.uVit - c.REBORD;
  note(
    'écran',
    'marge entre la fenêtre et la zone visible',
    true,
    `${f1(fu - vu / 2)} mm sur les côtés, ${f1((c.ECR_H - 2 * c.REBORD - vv) / 2)} mm en haut et en bas (si la zone visible n’est pas centrée, elle peut se décaler d’autant)`,
  );

  // ------------------------------------------------------------------ 4. caméra : champ de vision et cache
  if (ch.camera) {
    avancement(0.65, 'champ de la caméra');
    const champ = CAM.champ.wide;
    const rObj = CAM.objectif.rayon_utile;
    const volOuvert = ch.cache ? b.voletPlace('ouvert') : null;
    const rayonBloque = (x0: number, y0: number, dx: number, dy: number) => {
      for (const t of linspace(0, PW.objectif + 0.02, 40)) {
        const x = x0 + dx * t;
        const y = y0 + dy * t;
        const w = PW.objectif - t;
        if (dedans(facF, x, y, w) || (volOuvert && dedans(volOuvert, x, y, w))) return true;
      }
      return false;
    };
    for (const decal of [0, -0.5, 0.5]) {
      let bloque = 0;
      let total = 0;
      for (const ang of linspace(0, 2 * Math.PI, 72, false)) {
        await respirer();
        const dx = Math.tan(((champ.horizontal / 2) * Math.cos(ang) * Math.PI) / 180);
        const dy = Math.tan(((champ.vertical / 2) * Math.sin(ang) * Math.PI) / 180);
        for (const rr of linspace(0, rObj, 5))
          for (const phi of linspace(0, 2 * Math.PI, 8, false)) {
            total += 1;
            if (rayonBloque(decal + rr * Math.cos(phi), c.vCam + rr * Math.sin(phi), dx, dy)) bloque += 1;
          }
      }
      note('caméra', `champ de vision libre (objectif décalé de ${decal >= 0 ? '+' : ''}${f1(decal)} mm${ch.cache ? ', cache ouvert' : ''})`, bloque === 0, `${bloque} rayons bloqués sur ${total}`, '0');
    }
    let bloque = 0;
    const k = Math.tan((champ.diagonale / 2) * (Math.PI / 180)) / Math.hypot(4, 3);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const rr of linspace(0, rObj, 5))
          for (const phi of linspace(0, 2 * Math.PI, 12, false)) if (rayonBloque(rr * Math.cos(phi), c.vCam + rr * Math.sin(phi), sx * 4 * k, sy * 3 * k)) bloque += 1;
    note('caméra', `coins de l’image (diagonale ${champ.diagonale}°)`, bloque === 0, `${bloque} rayons bloqués sur 240`, '0');
    if (ch.cache) {
      const vol = b.voletPlace('ferme');
      let passe = 0;
      for (const x of linspace(-9, 9, 37))
        for (const y of linspace(-7.5, 7.5, 31)) {
          const couvert = linspace(PW.volet0 + 0.05, PW.volet1 - 0.05, 4).some((w) => dedans(vol, x, c.vCam + y, w));
          if (!couvert && !dedans(facF, x, c.vCam + y, 0.6)) passe += 1;
        }
      note('caméra', 'cache fermé : la fenêtre est entièrement couverte', passe === 0, `${passe} points de la fenêtre à découvert`, '0');
    }
    const [lo, hi] = reglageChariot();
    const trouvees = CAM.objectif.b_depuis_bord_haut.valeurs_trouvees;
    note(
      'caméra',
      'réglage du chariot (position de l’objectif sur la carte)',
      trouvees.every((x) => x >= lo && x <= hi),
      `${f1(lo)} à ${f1(hi)} mm depuis le bord haut ; valeurs trouvées : ${trouvees.map((x) => String(x).replace('.', ',')).join(', ')}`,
      'toutes couvertes',
    );
    if (ch.cache) note('caméra', 'course du cache', true, `${K.voletSPlein - K.voletSTrou} mm (trou devant l’objectif -> plein devant l’objectif)`);
  }

  // ------------------------------------------------------------------ 5. vis, inserts, liaisons
  avancement(0.75, 'visserie');
  const vis = (nom: string, traversee: number, fraisee = false, rondelle = 0) => {
    const v2 = choisirVisM3(traversee + rondelle);
    note(
      'visserie',
      nom,
      Boolean(v2),
      v2 ? `M3 × ${v2.longueur}${fraisee ? ' tête fraisée' : ''}${rondelle ? ' + rondelle' : ''} : ${f1(v2.prise)} mm vissés dans l’insert` : `aucune vis de la liste courante pour ${f1(traversee + rondelle)} mm à traverser`,
      `${String(PRISE_MIN).replace('.', ',')} à ${f1(PRISE_MAX)}`,
    );
  };
  vis('Dos -> façade (4)', c.W_TOT - 3 - c.W_JOINT);
  const { p: pv } = b.axeVisModule(1);
  const tb = (pv[2] - c.zCap0) / c.ct;
  vis('Capot -> module (2)', tb - c.lamageCapot);
  vis('Capot -> socle (4)', c.CAP_EP, true);
  vis('Retenues de l’écran (4)', RETENUE.epaisseur);
  if (ch.camera) vis('Chariot de caméra (2)', K.chariotEp, false, 0.5);
  if (ch.camera) {
    const prise = 6 - CAM.carte.epaisseur;
    note('visserie', 'Caméra (4 vis M2 × 6 autotaraudeuses)', prise <= K.plotCam + K.chariotEp, `${f1(prise)} mm dans le plot et le chariot (avant-trou traversant, ${f1(K.plotCam + K.chariotEp)} mm)`);
  }
  if (ch.cache) {
    const longBouton = PW.volet0 - (K.wBoutTete - K.boutTete[1]);
    const prise = 4 - K.voletEp;
    note('visserie', 'Bouton du cache (vis M2 × 4 par l’arrière, au travers du cache)', prise >= 2 && prise <= longBouton - 0.4 + 0.01, `${f1(prise)} mm vissés dans le bouton (avant-trou de ${f1(longBouton - 0.4)} mm, la pointe reste dedans)`);
    const jav = DB.PISTE[0] - K.wBoutTete;
    const jar = PW.volet0 - K.peauCam;
    note('visserie', 'Le cache coulisse sans être serré', jav > 0.05 && jar > 0.05, `jeu de ${f2(jav)} mm devant (tête / piste) et ${f2(jar)} mm derrière (cache / façade)`, '> 0,05');
  }
  note('visserie', 'Raspberry Pi (4 vis M2,5 × 6 du sachet de l’écran)', 6 - PI5.carte.epaisseur <= DB.PLOT_PI - 0.6 + 0.2, `${f1(6 - PI5.carte.epaisseur)} mm dans les plots (avant-trou Ø${f1(AVANT_TROU['M2.5'])}, ${f1(DB.PLOT_PI - 0.6)} mm de profondeur)`);
  const murs: [string, number][] = [
    ['coins façade', 4],
    ['retenues', Math.min(...RETENUE.bossage) / 2],
    ...(ch.camera ? ([['chariot', 4]] as [string, number][]) : []),
    ['socle', 4.6],
    ['bas du dos', 4.5],
  ];
  for (const [n, r] of murs) {
    const e = r - DB.INS_D / 2;
    note('visserie', `paroi autour de l’insert (${n})`, e >= PAROI_INSERT_MIN, `${f1(e)} mm`, '≥ 1,5');
  }
  const { p, d } = b.axeVisModule(1);
  const ins = b.point(DB.U_BOS_BAS, DB.INS_P / 2, DB.W_BOS_BAS);
  const a = [ins[0] - p[0], ins[1] - p[1], ins[2] - p[2]];
  const cr = [a[1]! * d[2] - a[2]! * d[1], a[2]! * d[0] - a[0]! * d[2], a[0]! * d[1] - a[1]! * d[0]];
  const dist = Math.hypot(cr[0]!, cr[1]!, cr[2]!);
  note('visserie', 'alignement trou du capot / insert du dos', dist < 0.01, `${dist.toFixed(3)} mm`, '0');
  const dosM = b.versMonde(dosF);
  const facM = b.versMonde(facF);
  for (const y of [c.CALE_Y[0] + 0.5, c.CALE_Y[1] - 0.5]) {
    const zc = b.zBasModule(y);
    const cap = dedans(capot, 0, y, zc - 0.05);
    const mod = dedans(dosM, 60, y, zc + 0.05) || dedans(facM, 60, y, zc + 0.05);
    note('liaisons', `module posé sur la cale à y = ${f1(y)}`, cap && mod, `cale ${cap ? 'oui' : 'non'}, module ${mod ? 'oui' : 'non'}`);
  }

  // ------------------------------------------------------------------ 6. câbles
  avancement(0.8, 'câbles');
  note(
    'câbles',
    'passage dans le bas du module',
    DB.PASS_U[1] - DB.PASS_U[0] >= 22 && DB.PASS_W[1] - DB.PASS_W[0] >= 7,
    `${DB.PASS_U[1] - DB.PASS_U[0]} × ${DB.PASS_W[1] - DB.PASS_W[0]} mm`,
    '≥ 22 × 7 : bout 15 broches de la nappe (16 mm) + 2 fils Dupont',
  );
  const xs = linspace(DB.PASS_U[0] + 2.5, DB.PASS_U[1] - 2.5, 9);
  const ys = linspace(DB.Y0 + DB.PASS_W[0] * c.ct + 2.5, DB.Y0 + DB.PASS_W[1] * c.ct - 2.5, 5);
  let bouchees = 0;
  for (const x of xs)
    for (const y of ys) {
      const zs = linspace(c.zCap0 - 0.5, b.zBasModule(y) + 3, 60);
      if ([capot, dosM, facM, socle].some((f) => zs.some((z) => dedans(f, x, y, z)))) bouchees += 1;
    }
  note('câbles', 'passage vertical libre du socle jusque dans le dos de l’écran', bouchees === 0, `${bouchees} colonnes bouchées sur ${xs.length * ys.length}`, '0');
  if (ch.camera) {
    const L = c.vCam + 12 + 25 + 70;
    note('câbles', 'nappe de la caméra : longueur nécessaire', L <= 260, `≈ ${Math.round(L)} mm (caméra -> bas du module ${Math.round(c.vCam)}, socle -> Pi 95) : prendre 300 mm`, '≤ 260 pour 300 mm');
  }
  const Le = 0.75 * c.vLog1 + 95;
  note('câbles', 'nappe de l’écran : longueur nécessaire', Le <= 260, `≈ ${Math.round(Le)} mm au pire (connecteur de l’écran tout en haut) : prendre 300 mm`, '≤ 260');

  // ------------------------------------------------------------------ 7. stabilité
  avancement(0.85, 'stabilité');
  const s = await stabilite(b);
  for (const r of s.appuis) note('stabilité', `appui sur le ${r.nom} avant de basculer en arrière`, r.force >= 3, `${f1(r.force)} N (${Math.round(r.force / 9.81e-3)} g de pression)`, '≥ 3 N (un appui franc fait 1 à 2 N)');
  note('stabilité', 'glissement sur le bureau (patins caoutchouc)', s.glissement >= 2, `${f1(s.glissement)} N`, '≥ 2 N');
  note('stabilité', 'masse totale et centre de gravité', true, `${Math.round(s.masse)} g, centre à y = ${Math.round(s.yc)} mm (socle de ${DB.SOC_P}), z = ${Math.round(s.zc)} mm`);
  avancement(1, 'fini');
  return res;
}

/** Volume (mm³) et centre d'une forme, sur une grille de pas h. */
export async function volumeEtCentre(f: Forme, h = 0.7): Promise<{ volume: number; centre: [number, number, number] }> {
  const g = geoDe(f);
  const bb = g.aabb;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const z of axe(bb[4], bb[5], h, 0.1234))
    for (const y of axe(bb[2], bb[3], h, 0.1234)) {
      await respirer();
      for (const x of axe(bb[0], bb[1], h, 0.1234))
        if (g.dedansBrut(x, y, z)) {
          n += 1;
          sx += x;
          sy += y;
          sz += z;
        }
    }
  return { volume: n * h ** 3, centre: n ? [sx / n, sy / n, sz / n] : [0, 0, 0] };
}

/** Bascule et glissement (formule de `composants.json`, PETG à 85 %). */
export async function stabilite(b: BoitierEcran): Promise<{ masse: number; yc: number; zc: number; appuis: { nom: string; force: number }[]; glissement: number; volumes: Record<string, number> }> {
  const c = b.c;
  const rho = 1.27e-3 * 0.85;
  let tot = 0;
  let my = 0;
  let mz = 0;
  const volumes: Record<string, number> = {};
  for (const [n, f] of Object.entries(b.piecesModule())) {
    const { volume, centre } = await volumeEtCentre(f);
    volumes[n] = volume;
    const w = b.point(centre[0], centre[1], centre[2]);
    const m = volume * rho;
    tot += m;
    my += m * w[1];
    mz += m * w[2];
  }
  for (const [n, f] of [['Socle', b.socle()], ['Capot', b.capot()]] as const) {
    const { volume, centre } = await volumeEtCentre(f);
    volumes[n] = volume;
    const m = volume * rho;
    tot += m;
    my += m * centre[1];
    mz += m * centre[2];
  }
  const [piX0, piX1, piY0, piY1] = carteDuBoitier(b).rect;
  void piX0;
  void piX1;
  const comps: [number, [number, number, number]][] = [
    [ECR.poids_pour_calculs.valeur, b.point(0, (c.vVit0 + c.vVit1) / 2, c.PEAU + 6)],
    [75, [0, (piY0 + piY1) / 2, c.zPcb1 + 4]],
    [b.choix.camera ? 40 : 25, b.point(0, 80, 15)],
  ];
  for (const [m, w] of comps) {
    tot += m;
    my += m * w[1];
    mz += m * w[2];
  }
  const yc = my / tot;
  const zc = mz / tot;
  const W = tot * 9.81e-3;
  const appuis: { nom: string; force: number }[] = [];
  for (const [nom, v] of [
    ['centre de l’écran', (c.vVit0 + c.vVit1) / 2],
    ['haut de la zone tactile', c.vVit1 - 16],
  ] as const) {
    const pt = b.point(0, v, 0);
    const bras = c.ct * pt[2] - c.st * (DB.SOC_P - pt[1]);
    appuis.push({ nom, force: (W * (DB.SOC_P - yc)) / bras });
  }
  const mu = 0.5;
  return { masse: tot, yc, zc, appuis, glissement: (mu * W) / (c.ct - mu * c.st), volumes };
}
