/**
 * Atelier 3D : la bibliothèque de composants (étape 2 de la mission des boîtiers).
 *
 * Les cotes viennent de `composantsDonnees.ts` (copie de `donnees/composants.json`), avec leur état :
 * « sûr », « incertain » (le boîtier s'en accommode : jeu, réglage, pièce souple) ou « à mesurer ».
 * Un composant « à mesurer » ne sert pas tant que l'utilisateur n'a pas donné ses mesures, une
 * question à la fois, en lui disant où poser le pied à coulisse. Les mesures données sont gardées
 * par le PC (`composants-mesures.json`, dans le dossier de l'atelier) et servent ensuite partout.
 *
 * Ce que sait un composant :
 * - son encombrement (enveloppe prudente) ;
 * - ses trous de fixation et ses prises, chacune avec son jeu ;
 * - poser ses plots dans une boîte ;
 * - percer ses prises dans la paroi qui leur fait face, en amincissant la paroi de l'extérieur
 *   quand la prise ne dépasse pas de la carte (USB-C et micro-HDMI du Raspberry Pi 5 de la
 *   référence : 1 mm de paroi restante).
 *
 * Repère d'une carte : x le long de sa longueur (Raspberry Pi 5 : « px », du bord de la carte SD
 * vers les USB), y le long de sa largeur (« py », du bord USB-C vers le GPIO), z depuis le dessus
 * de la carte. Pur : aucune dépendance, aucun accès disque.
 */
import { DONNEES_COMPOSANTS } from './composantsDonnees.js';
import { boite as pave, cyl, type Forme } from './csg.js';
import { AVANT_TROU, type VisCarte } from './visserie.js';

export type EtatCote = 'sur' | 'incertain' | 'a_mesurer';

/** Un bord de la carte : `x+` est le bord x = longueur, `y-` le bord y = 0… */
export type BordCarte = 'x-' | 'x+' | 'y-' | 'y+';

export interface PriseCarte {
  nom: string;
  bord: BordCarte;
  /** Centre le long du bord (mm, repère de la carte). */
  centre: number;
  largeur: number;
  hauteur: number;
  /** Ce qui dépasse du bord de la carte (mm). 0 : la fiche doit entrer jusqu'à la carte. */
  depasse: number;
  /** Jeu autour de la prise, par côté (mm). */
  jeu: number;
}

export interface TrouCarte {
  x: number;
  y: number;
  diametre: number;
  vis: VisCarte;
}

/** Ce qui est sûr pour poser une carte : sa forme, ses trous, ses prises, sa hauteur. */
export interface CarteGeometrie {
  longueur: number;
  largeur: number;
  epaisseur: number;
  trous: TrouCarte[];
  prises: PriseCarte[];
  /** Hauteur à laisser libre au-dessus de la carte (mm) : composants, ventilateur et air, fils. */
  hauteurLibre: number;
  /** Ce qui dépasse sous la carte d'un bord (carte SD…) : bord et longueur. */
  dessous?: { bord: BordCarte; depasse: number };
  /** Phrases sur ce qui n'est pas sûr et comment le boîtier s'en accommode. */
  incertitudes: string[];
}

export interface Composant {
  id: string;
  nom: string;
  etat: EtatCote;
  sources: string[];
  /** Mots qui le désignent dans une phrase pliée (sans accent), du plus précis au plus vague. */
  mots: RegExp;
  /** La géométrie de carte, quand le composant se pose sur des plots. */
  carte?: (mesures: MesuresComposant) => CarteGeometrie | null;
  /** Les mesures à demander, dans l'ordre, s'il est « à mesurer ». */
  aMesurer?: QuestionMesure[];
}

export interface QuestionMesure {
  champ: string;
  nom: string;
  /** Où poser le pied à coulisse, en français simple. */
  ou: string;
  min: number;
  max: number;
}

export type MesuresComposant = Record<string, number>;
/** Les mesures données par l'utilisateur, par composant. */
export type MesuresComposants = Record<string, MesuresComposant>;

const D = DONNEES_COMPOSANTS;
const R = D.regles_de_dessin;

/** Jeu autour d'une prise (règles de dessin) ; un peu plus dans une paroi amincie (référence : 0,6). */
export const JEU_PRISE = R.jeu_prise;
export const JEU_PRISE_AMINCIE = R.jeu_prise + 0.1;
export const PAROI_RESTANTE = R.paroi_amincie_devant_prises_laterales;
export const JEU_CARTE_PAROI = R.jeu_carte_paroi;

// ---------------------------------------------------------------------------------------------
// Raspberry Pi 5 : tout est « sûr » pour la carte, les trous et les prises (deux recopies du plan
// officiel concordent) ; le ventilateur et le bouton sont « incertains ».

function pi5(): CarteGeometrie {
  const p = D.composants.raspberry_pi_5;
  const [ex, ey] = p.trous.entraxe;
  const x0 = p.trous.depuis_bord_carte_sd;
  const y0 = p.trous.depuis_bords_longs;
  const trous: TrouCarte[] = [];
  for (const x of [x0, x0 + ex]) for (const y of [y0, y0 + ey]) trous.push({ x, y, diametre: p.trous.diametre, vis: 'M2.5' });
  const prises: PriseCarte[] = [
    ...p.prises_bord_usb.map((q, i) => ({ nom: q.nom === 'USB (2 étages)' ? `USB ${i}` : q.nom, bord: 'x+' as const, centre: q.py_centre, largeur: q.largeur, hauteur: q.hauteur, depasse: q.depasse, jeu: JEU_PRISE })),
    ...p.prises_bord_usbc.map((q) => ({ nom: q.nom, bord: 'y-' as const, centre: q.px_centre, largeur: q.largeur, hauteur: q.hauteur, depasse: 0, jeu: JEU_PRISE_AMINCIE })),
  ];
  const v = p.ventilateur_officiel;
  const hauteurLibre = Math.max(v.enveloppe_prudente.hauteur + v.air_au_dessus_mini, p.gpio.hauteur_avec_fil_dupont + 3, ...prises.map((q) => q.hauteur));
  return {
    longueur: p.carte.longueur,
    largeur: p.carte.largeur,
    epaisseur: p.carte.epaisseur,
    trous,
    prises,
    hauteurLibre,
    dessous: { bord: 'x-', depasse: p.carte_sd.depasse_bord_sd },
    incertitudes: [
      `Ventilateur officiel (incertain) : on garde ${fmt(v.enveloppe_prudente.hauteur)} mm de haut plus ${fmt(v.air_au_dessus_mini)} mm d’air au-dessus.`,
      `Fils Dupont sur le GPIO : ${fmt(p.gpio.hauteur_avec_fil_dupont)} mm plus 3 mm de marge.`,
      'Bouton marche (incertain) : il reste à l’intérieur, on ne le perce pas.',
    ],
  };
}

/** Carte « à mesurer » : sa géométrie vient seulement des mesures de l'utilisateur. */
const QUESTIONS_CARTE: QuestionMesure[] = [
  { champ: 'longueur', nom: 'la longueur de la carte', ou: 'pose les becs du pied à coulisse sur les deux petits bords de la carte, sans compter ce qui dépasse', min: 5, max: 250 },
  { champ: 'largeur', nom: 'la largeur de la carte', ou: 'pose les becs sur les deux grands bords de la carte', min: 5, max: 250 },
  { champ: 'epaisseur', nom: 'l’épaisseur de la carte', ou: 'serre le bord de la carte entre les becs, là où il n’y a aucun composant', min: 0.5, max: 5 },
  { champ: 'trou_diametre', nom: 'le diamètre des trous de fixation', ou: 'mets les petits becs du haut (ceux pour l’intérieur) dans un trou et écarte-les', min: 1, max: 6 },
  { champ: 'entraxe_x', nom: 'l’écart entre les trous dans la longueur, de centre à centre', ou: 'mesure du bord gauche d’un trou au bord gauche du trou voisin dans la longueur : c’est l’écart de centre à centre', min: 2, max: 250 },
  { champ: 'entraxe_y', nom: 'l’écart entre les trous dans la largeur, de centre à centre', ou: 'même chose dans la largeur : du bord d’un trou au même bord du trou voisin', min: 2, max: 250 },
  { champ: 'trou_bord_x', nom: 'la distance du centre d’un trou au petit bord le plus proche', ou: 'mets la jauge de profondeur (la tige au bout) contre le petit bord, et lis jusqu’au bord du trou ; ajoute la moitié du diamètre du trou', min: 0.5, max: 50 },
  { champ: 'trou_bord_y', nom: 'la distance du centre d’un trou au grand bord le plus proche', ou: 'même chose depuis le grand bord le plus proche du trou', min: 0.5, max: 50 },
  { champ: 'hauteur_dessus', nom: 'la hauteur du composant le plus haut au-dessus de la carte', ou: 'pose la carte à plat, et mesure avec la jauge de profondeur du dessus de la carte au sommet du composant le plus haut (fils branchés compris)', min: 0.5, max: 80 },
];

function carteMesuree(m: MesuresComposant): CarteGeometrie | null {
  if (QUESTIONS_CARTE.some((q) => typeof m[q.champ] !== 'number')) return null;
  const x0 = m.trou_bord_x!;
  const y0 = m.trou_bord_y!;
  const trous: TrouCarte[] = [];
  for (const x of [x0, x0 + m.entraxe_x!]) for (const y of [y0, y0 + m.entraxe_y!]) trous.push({ x, y, diametre: m.trou_diametre!, vis: m.trou_diametre! >= 2.6 ? 'M2.5' : 'M2' });
  return {
    longueur: m.longueur!,
    largeur: m.largeur!,
    epaisseur: m.epaisseur!,
    trous,
    prises: [],
    hauteurLibre: m.hauteur_dessus! + 3,
    incertitudes: ['Prises : je ne les connais pas. Dis-moi chaque ouverture en millimètres (« une ouverture de 9 par 4 à l’arrière, à 12 mm du bord gauche »).'],
  };
}

const MOTS: Record<string, RegExp> = {
  raspberry_pi_5: /\b(?:raspberry(?: pi)?(?: 5)?|rpi ?5|pi ?5)\b/,
  touch_display_2_7: /\b(?:ecran tactile|touch display|ecran (?:de )?7 pouces|ecran officiel)\b/,
  camera_module_3_wide: /\b(?:camera(?: module)?(?: 3)?(?: (?:wide|grand angle))?)\b/,
  esp32_s3_devkitc_1_borniers: /\besp ?32\b/,
  max98357a: /\b(?:max ?98357a?|ampli(?:ficateur)?(?: i2s)?)\b/,
  inmp441: /\b(?:inmp ?441|micro(?:phone)? i2s)\b/,
  oled_1_3_sh1106: /\b(?:oled|sh1106|petit ecran)\b/,
  haut_parleur_3w_4ohm: /\b(?:haut parleur|hp 3 ?w)\b/,
};

function etatDe(x: { etat?: string }): EtatCote {
  const e = x.etat ?? '';
  return e.startsWith('a_mesurer') ? 'a_mesurer' : e.startsWith('incertain') ? 'incertain' : 'sur';
}

function construire(): Composant[] {
  const out: Composant[] = [];
  for (const [id, c] of Object.entries(D.composants) as [string, { nom: string; etat?: string; sources?: readonly string[]; source?: string }][]) {
    const comp: Composant = {
      id,
      nom: c.nom,
      etat: id === 'raspberry_pi_5' || id === 'touch_display_2_7' || id === 'camera_module_3_wide' ? 'sur' : etatDe(c),
      sources: [...(c.sources ?? (c.source ? [c.source] : []))],
      mots: MOTS[id] ?? /$^/,
    };
    if (id === 'raspberry_pi_5') comp.carte = () => pi5();
    else if (['esp32_s3_devkitc_1_borniers', 'max98357a', 'oled_1_3_sh1106'].includes(id)) {
      comp.carte = carteMesuree;
      comp.aMesurer = QUESTIONS_CARTE;
    } else if (comp.etat === 'a_mesurer') {
      comp.aMesurer = QUESTIONS_CARTE.slice(0, 3);
    }
    out.push(comp);
  }
  return out;
}

export const COMPOSANTS: readonly Composant[] = construire();

export function composant(id: string): Composant | undefined {
  return COMPOSANTS.find((c) => c.id === id);
}

/** Le composant nommé dans une phrase pliée (le plus précis d'abord), ou `null`. */
export function composantNomme(t: string): Composant | null {
  for (const c of COMPOSANTS) if (c.mots.test(t)) return c;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Mesures de l'utilisateur

const fmt = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

/** Prochaine mesure à demander pour ce composant, ou `null` s'il est prêt. */
export function prochaineMesure(c: Composant, mesures: MesuresComposants): QuestionMesure | null {
  if (c.etat !== 'a_mesurer' || !c.aMesurer) return null;
  const m = mesures[c.id] ?? {};
  return c.aMesurer.find((q) => typeof m[q.champ] !== 'number') ?? null;
}

/** La question, en français simple, avec où poser le pied à coulisse. */
export function questionMesure(c: Composant, q: QuestionMesure, mesures: MesuresComposants): string {
  const total = c.aMesurer?.length ?? 1;
  const faites = Object.keys(mesures[c.id] ?? {}).filter((k) => c.aMesurer?.some((x) => x.champ === k)).length;
  const debut = faites === 0 ? `Je n’ai pas de cotes fiables pour ${c.nom} : il faut le mesurer au pied à coulisse (${total} mesures, une à la fois). ` : '';
  return `${debut}Mesure ${faites + 1} sur ${total} : ${q.nom}, en millimètres. Pour ça, ${q.ou}.`;
}

/** Lit une mesure dite (« 62 », « 62,5 mm », « 6 cm »). `null` : pas un nombre lisible. */
export function lireMesure(texte: string): number | null {
  const m = /(-?\d+(?:[.,]\d+)?)\s*(mm|millimetres?|millimètres?|cm|centimetres?|centimètres?)?/i.exec(texte);
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  return m[2] && /^c/i.test(m[2]) ? v * 10 : v;
}

/** Ajoute une mesure ; refuse une valeur hors des bornes (une phrase), sans rien changer. */
export function ajouterMesure(mesures: MesuresComposants, id: string, champ: string, valeur: number): { mesures: MesuresComposants; erreur?: string } {
  const c = composant(id);
  const q = c?.aMesurer?.find((x) => x.champ === champ);
  if (!c || !q) return { mesures, erreur: 'Je ne connais pas cette mesure.' };
  if (!Number.isFinite(valeur) || valeur < q.min || valeur > q.max) return { mesures, erreur: `${fmt(valeur)} mm pour ${q.nom} : ça me paraît faux (de ${fmt(q.min)} à ${fmt(q.max)} mm).` };
  return { mesures: { ...mesures, [id]: { ...(mesures[id] ?? {}), [champ]: valeur } } };
}

/** Lecture tolérante du fichier des mesures : ce qui n'est pas un nombre est ignoré. */
export function lireFichierMesures(texte: string): MesuresComposants {
  try {
    const data = JSON.parse(texte) as { composants?: unknown };
    const out: MesuresComposants = {};
    if (!data || typeof data !== 'object' || !data.composants || typeof data.composants !== 'object') return out;
    for (const [id, m] of Object.entries(data.composants as Record<string, unknown>)) {
      if (!composant(id) || !m || typeof m !== 'object') continue;
      const champs: MesuresComposant = {};
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) champs[k] = v;
      out[id] = champs;
    }
    return out;
  } catch {
    return {};
  }
}

export function ecrireFichierMesures(mesures: MesuresComposants): string {
  return `${JSON.stringify({ version: 1, note: 'Mesures prises au pied à coulisse par l’utilisateur (atelier 3D de Jarvis).', composants: mesures }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Cotes trouvées ailleurs (cap « chef de projet », § 3 et 5) : une recherche sur Internet, une fiche,
// une autre équipe. Jamais sans source. Deux sources qui concordent → « sûre » ; une seule, ou des
// sources en désaccord → « incertaine » : la mesure au pied à coulisse reste demandée.

/** Une lecture d'une cote dans une source (page, PDF de plan, fiche). */
export interface CoteLue {
  valeur: number;
  /** D'où vient le nombre : adresse ou nom du document. Obligatoire. */
  source: string;
}
/** Les cotes trouvées, par composant et par champ (ceux des mesures à prendre). */
export type CotesTrouvees = Record<string, Record<string, CoteLue[]>>;

/** Écart sous lequel deux lectures concordent (mm). */
export const CONCORDANCE_MM = 0.25;

export interface EtatCoteTrouvee {
  etat: 'sur' | 'incertain';
  /** La valeur retenue : celle des sources qui concordent, ou la seule lue. Absente si désaccord. */
  valeur?: number;
  sources: string[];
  /** Les valeurs lues, quand elles ne concordent pas. */
  desaccord?: number[];
}

/** Ajoute une lecture (une par source : relire une source remplace sa lecture). Bornes de la mesure. */
export function ajouterCoteTrouvee(cotes: CotesTrouvees, id: string, champ: string, lue: CoteLue): { cotes: CotesTrouvees; erreur?: string } {
  const c = composant(id);
  const q = c?.aMesurer?.find((x) => x.champ === champ);
  if (!c || !q) return { cotes, erreur: 'Je ne connais pas cette cote.' };
  if (!lue.source.trim()) return { cotes, erreur: 'Une cote trouvée doit dire d’où elle vient.' };
  if (!Number.isFinite(lue.valeur) || lue.valeur < q.min || lue.valeur > q.max) {
    return { cotes, erreur: `${fmt(lue.valeur)} mm pour ${q.nom} : ça me paraît faux (de ${fmt(q.min)} à ${fmt(q.max)} mm).` };
  }
  const avant = (cotes[id]?.[champ] ?? []).filter((x) => x.source !== lue.source);
  return { cotes: { ...cotes, [id]: { ...(cotes[id] ?? {}), [champ]: [...avant, { valeur: lue.valeur, source: lue.source.trim() }] } } };
}

/** L'état d'une cote trouvée : sûre si deux sources différentes concordent. */
export function etatCoteTrouvee(lues: readonly CoteLue[]): EtatCoteTrouvee {
  const sources = [...new Set(lues.map((l) => l.source))];
  for (const l of lues) {
    const daccord = lues.filter((x) => Math.abs(x.valeur - l.valeur) <= CONCORDANCE_MM);
    const differentes = new Set(daccord.map((x) => x.source));
    if (differentes.size >= 2) {
      const valeur = Math.round((daccord.reduce((s, x) => s + x.valeur, 0) / daccord.length) * 100) / 100;
      return { etat: 'sur', valeur, sources: [...differentes] };
    }
  }
  const valeurs = [...new Set(lues.map((l) => l.valeur))];
  return valeurs.length === 1 ? { etat: 'incertain', valeur: valeurs[0]!, sources } : { etat: 'incertain', sources, desaccord: valeurs };
}

/**
 * Les mesures à utiliser pour dessiner : celles de l'utilisateur d'abord, puis les cotes trouvées
 * **sûres**. Une cote incertaine n'entre pas : elle reste à mesurer.
 */
export function fusionnerCotes(mesures: MesuresComposants, cotes: CotesTrouvees): MesuresComposants {
  const out: MesuresComposants = { ...mesures };
  for (const [id, champs] of Object.entries(cotes)) {
    for (const [champ, lues] of Object.entries(champs)) {
      if (typeof mesures[id]?.[champ] === 'number') continue;
      const e = etatCoteTrouvee(lues);
      if (e.etat === 'sur' && e.valeur !== undefined) out[id] = { ...(out[id] ?? {}), [champ]: e.valeur };
    }
  }
  return out;
}

/** D'où viennent les cotes d'un composant, et ce qui n'y est pas sûr (pour le résultat d'une étape). */
export function provenanceCotes(id: string, mesures: MesuresComposants, cotes: CotesTrouvees): { sources: string[]; incertitudes: string[] } {
  const c = composant(id);
  if (!c?.aMesurer) return { sources: [], incertitudes: [] };
  const sources: string[] = [];
  const incertitudes: string[] = [];
  for (const q of c.aMesurer) {
    if (typeof mesures[id]?.[q.champ] === 'number') {
      sources.push(`${c.nom}, ${q.nom} : mesuré au pied à coulisse par l'utilisateur`);
      continue;
    }
    const lues = cotes[id]?.[q.champ];
    if (!lues?.length) continue;
    const e = etatCoteTrouvee(lues);
    if (e.etat === 'sur') sources.push(`${c.nom}, ${q.nom} : ${fmt(e.valeur!)} mm (${e.sources.join(' ; ')})`);
    else if (e.desaccord) incertitudes.push(`${c.nom}, ${q.nom} : les sources ne concordent pas (${e.desaccord.map(fmt).join(' / ')} mm) — à mesurer.`);
    else incertitudes.push(`${c.nom}, ${q.nom} : ${fmt(e.valeur!)} mm sur une seule source (${e.sources[0]}) — à mesurer.`);
  }
  return { sources, incertitudes };
}

/** Lecture tolérante du fichier des cotes trouvées : une lecture sans source ou hors bornes est ignorée. */
export function lireFichierCotes(texte: string): CotesTrouvees {
  let cotes: CotesTrouvees = {};
  try {
    const data = JSON.parse(texte) as { cotes?: unknown };
    if (!data || typeof data !== 'object' || !data.cotes || typeof data.cotes !== 'object') return cotes;
    for (const [id, champs] of Object.entries(data.cotes as Record<string, unknown>)) {
      if (!champs || typeof champs !== 'object') continue;
      for (const [champ, lues] of Object.entries(champs as Record<string, unknown>)) {
        if (!Array.isArray(lues)) continue;
        for (const l of lues as { valeur?: unknown; source?: unknown }[]) {
          if (typeof l?.valeur !== 'number' || typeof l.source !== 'string') continue;
          const r = ajouterCoteTrouvee(cotes, id, champ, { valeur: l.valeur, source: l.source });
          if (!r.erreur) cotes = r.cotes;
        }
      }
    }
  } catch {
    return {};
  }
  return cotes;
}

export function ecrireFichierCotes(cotes: CotesTrouvees): string {
  return `${JSON.stringify({ version: 1, note: 'Cotes de composants trouvées par Jarvis (recherche, fiches), chacune avec sa source.', cotes }, null, 2)}\n`;
}

/** La géométrie d'une carte, si elle est connue (sûre, ou mesurée). */
export function geometrieCarte(c: Composant, mesures: MesuresComposants): CarteGeometrie | null {
  if (!c.carte) return null;
  if (prochaineMesure(c, mesures)) return null;
  return c.carte(mesures[c.id] ?? {});
}

/** Enveloppe prudente d'une carte (repère de la carte, mm) : carte, prises qui dépassent, hauteur libre. */
export function enveloppeCarte(g: CarteGeometrie): { x: [number, number]; y: [number, number]; z: [number, number] } {
  const x: [number, number] = [0, g.longueur];
  const y: [number, number] = [0, g.largeur];
  for (const p of g.prises) {
    if (p.bord === 'x+') x[1] = Math.max(x[1], g.longueur + p.depasse);
    if (p.bord === 'x-') x[0] = Math.min(x[0], -p.depasse);
    if (p.bord === 'y+') y[1] = Math.max(y[1], g.largeur + p.depasse);
    if (p.bord === 'y-') y[0] = Math.min(y[0], -p.depasse);
  }
  if (g.dessous?.bord === 'x-') x[0] = Math.min(x[0], -g.dessous.depasse);
  // (+ 0 : pas de « −0 » quand rien ne dépasse.)
  return { x: [x[0] + 0, x[1]], y: [y[0] + 0, y[1]], z: [-g.epaisseur, g.hauteurLibre] };
}

// ---------------------------------------------------------------------------------------------
// Poser une carte dans une boîte

export type Paroi = 'avant' | 'arriere' | 'gauche' | 'droite';

/**
 * Orientation d'une carte posée à plat : x de la carte vers `ux`, y de la carte vers `uy` (repère de
 * la boîte, vu de dessus). Une rotation seulement : une carte ne se retourne pas.
 */
const ORIENTATIONS: Record<Paroi, { ux: [number, number]; uy: [number, number] }> = {
  arriere: { ux: [0, 1], uy: [-1, 0] },
  avant: { ux: [0, -1], uy: [1, 0] },
  droite: { ux: [1, 0], uy: [0, 1] },
  gauche: { ux: [-1, 0], uy: [0, -1] },
};

function paroiDe(d: [number, number]): Paroi {
  if (d[1] > 0.5) return 'arriere';
  if (d[1] < -0.5) return 'avant';
  return d[0] > 0 ? 'droite' : 'gauche';
}

export interface BoiteHote {
  L: number;
  W: number;
  H: number;
  e: number;
  f: number;
  /** Haut de ce qui peut monter dans la boîte (rebord, bord, ou bas de la lèvre du couvercle). */
  zHaut: number;
}

export interface CartePosee {
  /** Monde (boîte) d'un point de la carte (x, y). */
  monde: (x: number, y: number) => [number, number];
  zDessous: number;
  zDessus: number;
  /** Matière : plots. */
  plus: Forme[];
  /** Trous : avant-trous, ouvertures des prises, creux d'amincissement. */
  moins: Forme[];
  erreurs: string[];
  /** Pour les essais : chaque plot et son trou, chaque prise et son ouverture (rectangles dans la paroi). */
  verif: {
    plots: { trou: [number, number]; plot: [number, number] }[];
    prises: { nom: string; paroi: Paroi; prise: Rect; ouverture: Rect; paroiRestante: number; rayon: number }[];
  };
  /** Ce que la phrase doit dire de ce qui reste incertain. */
  incertitudes: string[];
}

/** Rectangle dans le plan d'une paroi : `a` le long de la paroi (coordonnée de la boîte), `z` en hauteur. */
export interface Rect {
  a: [number, number];
  z: [number, number];
}

/** Hauteur des plots d'une carte (référence : 5 mm pour le Raspberry Pi 5). */
export const PLOT_CARTE = 5;
const PLOT_DIAMETRE: Record<VisCarte, number> = { M2: 5, 'M2.5': 6 };

/**
 * Pose une carte à plat sur des plots, dans le coin de la boîte où sa première paroi (`ports`) et
 * sa paroi voisine se rejoignent : le bord aux prises qui dépassent contre `ports`, l'autre bord à
 * prises contre la paroi voisine. Les prises sont percées, avec leur jeu ; une prise qui ne dépasse
 * pas de la carte a sa paroi amincie de l'extérieur à 1 mm, pour que la fiche entre à fond.
 */
export function poserCarte(nom: string, g: CarteGeometrie, b: BoiteHote, ports: Paroi): CartePosee {
  const { ux, uy } = ORIENTATIONS[ports];
  const env = enveloppeCarte(g);
  const erreurs: string[] = [];
  // Distance au mur du bord x+ (prises qui dépassent) et du bord y- (prises à fleur).
  const depasse = Math.max(0, ...g.prises.filter((p) => p.bord === 'x+').map((p) => p.depasse));
  const ecartX = depasse > 0 ? Math.min(depasse, 1.5) : JEU_CARTE_PAROI;
  const ecartY = JEU_CARTE_PAROI;
  // Le coin intérieur visé : paroi `ports` (direction ux) et paroi voisine (direction −uy).
  const coinA = (d: [number, number]): number => {
    // position du mur intérieur dans la direction d, sur l'axe de d
    if (d[0] > 0.5) return b.L - b.e;
    if (d[0] < -0.5) return b.e;
    if (d[1] > 0.5) return b.W - b.e;
    return b.e;
  };
  // Origine : le point (0, 0) de la carte. Le bord x+ est à `ecartX` du mur ux ; le bord y- à `ecartY` du mur −uy.
  const mx = coinA(ux);
  const my = coinA([-uy[0], -uy[1]]);
  const O: [number, number] = [0, 0];
  for (const axe of [0, 1] as const) {
    if (ux[axe] !== 0) O[axe] = mx - ux[axe] * (g.longueur + ecartX);
    if (uy[axe] !== 0) O[axe] = my + uy[axe] * ecartY;
  }
  const monde = (x: number, y: number): [number, number] => [O[0] + x * ux[0] + y * uy[0], O[1] + x * ux[1] + y * uy[1]];
  const zDessous = b.f + PLOT_CARTE;
  const zDessus = zDessous + g.epaisseur;

  // La carte et ce qu'elle porte tiennent-ils dans la boîte ?
  // La carte (avec ce qui dépasse dessous, comme la carte SD) doit tenir entre les parois ; les
  // prises, elles, entrent exprès dans la paroi qui leur fait face (leur ouverture y est percée).
  const x0 = env.x[0] < 0 && g.dessous ? -g.dessous.depasse : 0;
  const coins = [monde(x0, 0), monde(g.longueur, g.largeur)];
  const xs = coins.map((c) => c[0]);
  const ys = coins.map((c) => c[1]);
  const dehors = Math.min(...xs) < b.e - 1e-6 || Math.max(...xs) > b.L - b.e + 1e-6 || Math.min(...ys) < b.e - 1e-6 || Math.max(...ys) > b.W - b.e + 1e-6;
  const tropLoin = g.prises.some((p) => p.depasse > (p.bord === 'x+' ? ecartX : ecartY) + b.e);
  if (dehors) {
    const lx = g.longueur - x0 + ecartX + JEU_CARTE_PAROI;
    const ly = g.largeur + ecartY + JEU_CARTE_PAROI;
    const besoinL = Math.abs(ux[0]) * lx + Math.abs(uy[0]) * ly;
    const besoinW = Math.abs(ux[1]) * lx + Math.abs(uy[1]) * ly;
    erreurs.push(`${maj(nom)} ne tient pas dans le fond : il faut ${fmt(besoinL + 2 * b.e)} × ${fmt(besoinW + 2 * b.e)} mm au moins (boîte de ${fmt(b.L)} × ${fmt(b.W)} mm).`);
  }
  if (tropLoin) erreurs.push(`${maj(nom)} : une prise dépasserait de la boîte, la paroi est trop fine.`);
  if (zDessus + g.hauteurLibre > b.zHaut + 1e-6) {
    erreurs.push(`${maj(nom)} : la boîte est trop basse. Il faut ${fmt(zDessus + g.hauteurLibre - b.f)} mm au-dessus du fond (plots de ${fmt(PLOT_CARTE)} mm, carte, puis ${fmt(g.hauteurLibre)} mm libres), il y en a ${fmt(b.zHaut - b.f)}.`);
  }

  const plus: Forme[] = [];
  const moins: Forme[] = [];
  const verif: CartePosee['verif'] = { plots: [], prises: [] };
  for (const t of g.trous) {
    const [x, y] = monde(t.x, t.y);
    plus.push(cyl(x, y, b.f - 0.01, zDessous, PLOT_DIAMETRE[t.vis] / 2));
    moins.push(cyl(x, y, b.f + 0.6, zDessous + 0.01, AVANT_TROU[t.vis] / 2));
    verif.plots.push({ trou: monde(t.x, t.y), plot: [x, y] });
  }

  // Les prises : chaque bord de la carte fait face à une paroi.
  const directions: Record<BordCarte, [number, number]> = { 'x+': ux, 'x-': [-ux[0], -ux[1]], 'y+': uy, 'y-': [-uy[0], -uy[1]] };
  const parBord = new Map<BordCarte, PriseCarte[]>();
  for (const p of g.prises) parBord.set(p.bord, [...(parBord.get(p.bord) ?? []), p]);
  for (const [bord, prises] of parBord) {
    const dir = directions[bord];
    const paroi = paroiDe(dir);
    const axeA = dir[0] !== 0 ? 1 : 0; // le long de la paroi
    const surX = dir[0] !== 0;
    const exterieur = dir[0] > 0.5 ? b.L : dir[0] < -0.5 ? 0 : dir[1] > 0.5 ? b.W : 0;
    const signe = dir[0] + dir[1] > 0 ? 1 : -1;
    const amincie = prises.every((p) => p.depasse === 0) && b.e > PAROI_RESTANTE + 0.05;
    const creux = amincie ? b.e - PAROI_RESTANTE : 0;
    const rects: Rect[] = [];
    for (const p of prises) {
      const centre = bord === 'x+' || bord === 'x-' ? monde(bord === 'x+' ? g.longueur : 0, p.centre) : monde(p.centre, bord === 'y+' ? g.largeur : 0);
      const a = centre[axeA];
      const prise: Rect = { a: [a - p.largeur / 2, a + p.largeur / 2], z: [zDessus, zDessus + p.hauteur] };
      const ouverture: Rect = { a: [prise.a[0] - p.jeu, prise.a[1] + p.jeu], z: [prise.z[0] - p.jeu, prise.z[1] + p.jeu] };
      rects.push(ouverture);
      if (ouverture.z[1] > b.H - 1 || ouverture.z[0] < b.f) erreurs.push(`${maj(nom)} : la prise ${p.nom} sort de la paroi ${paroi === 'arriere' ? 'arrière' : paroi === 'avant' ? 'avant' : paroi === 'gauche' ? 'gauche' : 'droite'}.`);
      const n0 = signe > 0 ? exterieur - b.e - 1 : exterieur - 1;
      const n1 = signe > 0 ? exterieur + 1 : exterieur + b.e + 1;
      moins.push(paroiRect(surX, n0, n1, ouverture, p.jeu));
      verif.prises.push({ nom: p.nom, paroi, prise, ouverture, paroiRestante: b.e - creux, rayon: p.jeu });
    }
    if (creux > 0) {
      const a0 = Math.min(...rects.map((r) => r.a[0])) - 3;
      const a1 = Math.max(...rects.map((r) => r.a[1])) + 3;
      const z0 = Math.min(...rects.map((r) => r.z[0])) - 3;
      const z1 = Math.max(...rects.map((r) => r.z[1])) + 3;
      const n0 = signe > 0 ? exterieur - creux : exterieur - 1;
      const n1 = signe > 0 ? exterieur + 1 : exterieur + creux;
      moins.push(paroiRect(surX, n0, n1, { a: [a0, a1], z: [Math.max(b.f + 0.5, z0), Math.min(b.H - 1, z1)] }, 2));
    }
  }
  return { monde, zDessous, zDessus, plus, moins, erreurs, verif, incertitudes: g.incertitudes };
}

/** Un pavé à travers une paroi : la paroi normale à x (`surX`) ou à y, de n0 à n1 dans son épaisseur. */
function paroiRect(surX: boolean, n0: number, n1: number, r: Rect, rayon: number): Forme {
  // Arêtes arrondies dans le plan de la paroi : on dessine le pavé couché, puis on le tourne.
  const l = r.a[1] - r.a[0];
  const h = r.z[1] - r.z[0];
  const rr = Math.max(0, Math.min(rayon, l / 2 - 0.01, h / 2 - 0.01));
  if (rr <= 0) return surX ? pave(n0, n1, r.a[0], r.a[1], r.z[0], r.z[1]) : pave(r.a[0], r.a[1], n0, n1, r.z[0], r.z[1]);
  // Pavé arrondi d'axe z dans un repère (a, z, n), puis posé : (a, z, n) → paroi.
  const local = pave(r.a[0], r.a[1], r.z[0], r.z[1], n0, n1, rr).scad;
  // surX : (a, z, n) → (n, a, z) ; sinon (a, z, n) → (a, n, z).
  const m = surX ? '[[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]' : '[[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]';
  return { scad: `multmatrix(${m}) { ${local} }` };
}

/**
 * Jeu le plus petit entre une prise (rectangle à angles vifs, par prudence) et son ouverture à
 * coins arrondis de rayon `rayon` (mm).
 */
export function jeuPrise(prise: Rect, ouverture: Rect, rayon: number): number {
  const cotes = Math.min(prise.a[0] - ouverture.a[0], ouverture.a[1] - prise.a[1], prise.z[0] - ouverture.z[0], ouverture.z[1] - prise.z[1]);
  if (rayon <= 0) return cotes;
  // Dans un coin, le centre de l'arrondi est à `rayon` des deux bords de l'ouverture.
  let coins = Number.POSITIVE_INFINITY;
  for (const [ca, pa, sa] of [
    [ouverture.a[0] + rayon, prise.a[0], -1],
    [ouverture.a[1] - rayon, prise.a[1], 1],
  ] as const) {
    for (const [cz, pz, sz] of [
      [ouverture.z[0] + rayon, prise.z[0], -1],
      [ouverture.z[1] - rayon, prise.z[1], 1],
    ] as const) {
      // Le coin de la prise est-il dans la zone de l'arrondi ?
      if ((pa - ca) * sa > 0 && (pz - cz) * sz > 0) coins = Math.min(coins, rayon - Math.hypot(pa - ca, pz - cz));
    }
  }
  return Math.min(cotes, coins);
}

function maj(t: string): string {
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)}` : t;
}
