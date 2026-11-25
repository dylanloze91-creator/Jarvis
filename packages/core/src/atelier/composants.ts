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
  /** Ce qui pend sous la carte (broches, soudures) : l'espace à laisser libre dessous (mm). */
  hauteurDessous?: number;
  /** Ce qui dépasse des bords au-dessus de la carte, hors prises (antenne d'un module…), par bord (mm). */
  depassements?: Partial<Record<BordCarte, number>>;
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
  /** La géométrie de carte, quand le composant se pose au fond de la boîte (plots ou glissières). */
  carte?: (mesures: MesuresComposant) => CarteGeometrie | null;
  /** La géométrie d'un écran, quand le composant se pose sous le couvercle, derrière une fenêtre. */
  ecran?: (mesures: MesuresComposant) => EcranGeometrie | null;
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
  /**
   * Facultative : jamais demandée, le boîtier s'en passe (trous de fixation : glissières ; prises
   * lues sur un plan). `plan` : seulement lue sur un plan du fabricant, jamais proposée au modèle.
   */
  facultatif?: 'fixation' | 'plan';
  /**
   * Valeur large que l'utilisateur peut choisir sans la pièce (« prends large ») : une marge
   * annoncée comme telle, jamais une cote. −1 : « inconnue, au plus large » (la fenêtre d'un écran
   * ouverte sur toute la carte).
   */
  large?: number;
  /** Ce que veut dire la valeur large, dit à l'utilisateur (« je laisse 15 mm »). */
  largeTexte?: string;
  /** Plus petite mesure acceptée de l'utilisateur ou d'une page, quand `min` laisse passer la valeur large (−1). */
  minMesure?: number;
}

/** Ce qui est sûr pour poser un écran sous le couvercle : sa carte, sa zone visible, ses trous. */
export interface EcranGeometrie {
  longueur: number;
  largeur: number;
  epaisseur: number;
  /** Verre (et ce qui dépasse) au-dessus de la carte : il touche le dessous du couvercle. */
  hauteurDessus: number;
  /** Broches et fils sous la carte : ils pendent dans la boîte. */
  hauteurDessous: number;
  /** Zone visible, dans le repère de la carte (x le long de la longueur, y de 0 au bord des broches). */
  fenetre: { x: [number, number]; y: [number, number] };
  trous: TrouCarte[];
  incertitudes: string[];
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

/** Les trous de fixation : facultatifs (sans eux, la carte tient dans des glissières). */
const QUESTIONS_FIXATION: QuestionMesure[] = [
  { champ: 'trou_diametre', nom: 'le diamètre des trous de fixation', ou: 'mets les petits becs du haut (ceux pour l’intérieur) dans un trou et écarte-les', min: 1, max: 6, facultatif: 'fixation' },
  { champ: 'entraxe_x', nom: 'l’écart entre les trous dans la longueur, de centre à centre', ou: 'mesure du bord gauche d’un trou au bord gauche du trou voisin dans la longueur : c’est l’écart de centre à centre', min: 2, max: 250, facultatif: 'fixation' },
  { champ: 'entraxe_y', nom: 'l’écart entre les trous dans la largeur, de centre à centre', ou: 'même chose dans la largeur : du bord d’un trou au même bord du trou voisin', min: 2, max: 250, facultatif: 'fixation' },
  { champ: 'trou_bord_x', nom: 'la distance du centre d’un trou au petit bord le plus proche', ou: 'mets la jauge de profondeur (la tige au bout) contre le petit bord, et lis jusqu’au bord du trou ; ajoute la moitié du diamètre du trou', min: 0.5, max: 50, facultatif: 'fixation' },
  { champ: 'trou_bord_y', nom: 'la distance du centre d’un trou au grand bord le plus proche', ou: 'même chose depuis le grand bord le plus proche du trou', min: 0.5, max: 50, facultatif: 'fixation' },
];

/** Bords d'une carte, codés pour les cotes lues sur un plan (1 : x+, 2 : x−, 3 : y+, 4 : y−). */
export const CODES_BORD: readonly BordCarte[] = ['x+', 'x-', 'y+', 'y-'];

/**
 * Ce qu'un plan du fabricant dit en plus (jamais demandé, jamais proposé au modèle) : l'absence de
 * trous de fixation, le bord des prises et leur place, ce qui dépasse des bords (antenne…).
 */
const CHAMPS_PLAN: QuestionMesure[] = [
  { champ: 'sans_trous', nom: 'aucun trou de fixation sur le plan', ou: '', min: 0, max: 1, facultatif: 'plan' },
  { champ: 'prise_bord', nom: 'le bord des prises', ou: '', min: 1, max: 4, facultatif: 'plan' },
  ...[1, 2, 3].flatMap((n) => [
    { champ: `prise${n}_centre`, nom: `le centre de la prise ${n} le long du bord`, ou: '', min: 0, max: 250, facultatif: 'plan' as const },
    { champ: `prise${n}_largeur`, nom: `la largeur de la prise ${n}`, ou: '', min: 1, max: 40, facultatif: 'plan' as const },
    { champ: `prise${n}_depasse`, nom: `ce qui dépasse du bord à la prise ${n}`, ou: '', min: 0, max: 20, facultatif: 'plan' as const },
  ]),
  ...(['xp', 'xm', 'yp', 'ym'] as const).map((b) => ({ champ: `depasse_${b}`, nom: `ce qui dépasse du bord ${b} (hors prises)`, ou: '', min: 0, max: 40, facultatif: 'plan' as const })),
];

/** Carte « à mesurer » : sa géométrie vient seulement des mesures de l'utilisateur, ou des cotes trouvées. */
const QUESTIONS_CARTE: QuestionMesure[] = [
  { champ: 'longueur', nom: 'la longueur de la carte', ou: 'pose les becs du pied à coulisse sur les deux petits bords de la carte, sans compter ce qui dépasse', min: 5, max: 250 },
  { champ: 'largeur', nom: 'la largeur de la carte', ou: 'pose les becs sur les deux grands bords de la carte', min: 5, max: 250 },
  { champ: 'epaisseur', nom: 'l’épaisseur de la carte', ou: 'serre le bord de la carte entre les becs, là où il n’y a aucun composant', min: 0.5, max: 5, large: 2 },
  { champ: 'hauteur_dessus', nom: 'la hauteur du composant le plus haut au-dessus de la carte', ou: 'pose la carte à plat, et mesure avec la jauge de profondeur du dessus de la carte au sommet du composant le plus haut (fils branchés compris)', min: 0.5, max: 80, large: 15 },
  { champ: 'hauteur_dessous', nom: 'ce qui dépasse sous la carte (broches, soudures)', ou: 'retourne la carte et mesure du dessous de la carte au bout des broches ; 0 s’il n’y a rien', min: 0, max: 30, large: 12 },
  ...QUESTIONS_FIXATION,
  ...CHAMPS_PLAN,
];

/** Écran à poser sous le couvercle : sa carte, sa zone visible, puis (facultatif) ses trous. */
const QUESTIONS_ECRAN: QuestionMesure[] = [
  { champ: 'longueur', nom: 'la longueur de la carte de l’écran', ou: 'pose les becs sur les deux bords de la carte parallèles à la rangée de broches', min: 5, max: 250 },
  { champ: 'largeur', nom: 'la largeur de la carte de l’écran', ou: 'pose les becs sur le bord des broches et sur le bord opposé', min: 5, max: 250 },
  { champ: 'epaisseur', nom: 'l’épaisseur de la carte de l’écran', ou: 'serre le bord de la carte entre les becs, là où il n’y a ni verre ni composant', min: 0.5, max: 5, large: 2 },
  { champ: 'hauteur_dessus', nom: 'l’épaisseur du verre au-dessus de la carte', ou: 'pose la carte verre en haut, et mesure du dessus de la carte au dessus du verre', min: 0.3, max: 15, large: 3 },
  { champ: 'hauteur_dessous', nom: 'ce qui dépasse sous la carte de l’écran (broches, fils branchés)', ou: 'retourne la carte et mesure du dessous de la carte au bout des broches, fils branchés compris', min: 0, max: 40, large: 15 },
  ...(
    [
      ['fenetre_largeur', 'la largeur de la zone allumée de l’écran (le long des broches)', 'allume l’écran avec un dessin plein, et mesure la zone qui s’éclaire, dans le sens de la rangée de broches', 3, 250],
      ['fenetre_hauteur', 'la hauteur de la zone allumée de l’écran', 'même chose dans l’autre sens', 2, 250],
      ['fenetre_bord_x', 'la distance du bord gauche de la carte à la zone allumée', 'broches en haut, mesure du bord gauche de la carte au bord gauche de la zone qui s’éclaire', 0, 100],
      ['fenetre_bord_y', 'la distance du bord des broches à la zone allumée', 'mesure du bord de la carte où sont les broches au bord le plus proche de la zone qui s’éclaire', 0, 100],
    ] as const
  ).map(([champ, nom, ou, min, max]) => ({
    champ,
    nom,
    ou,
    // −1 : « inconnue » (valeur large choisie sans la pièce) ; une mesure reste entre min et max.
    min: -1,
    max,
    minMesure: min,
    large: -1,
    largeTexte: 'j’ouvre la fenêtre au plus large (toute la carte de l’écran, moins 1,5 mm de bord), sans savoir où est la zone allumée',
  })),
  ...QUESTIONS_FIXATION,
];

const FIXATION = QUESTIONS_FIXATION.map((q) => q.champ);

/** Les 4 trous d'une carte, si les 5 cotes de fixation sont là (autrement : aucun, jamais à moitié). */
function trousMesures(m: MesuresComposant): TrouCarte[] {
  if (FIXATION.some((c) => typeof m[c] !== 'number') || m.sans_trous === 1) return [];
  const trous: TrouCarte[] = [];
  for (const x of [m.trou_bord_x!, m.trou_bord_x! + m.entraxe_x!]) for (const y of [m.trou_bord_y!, m.trou_bord_y! + m.entraxe_y!]) trous.push({ x, y, diametre: m.trou_diametre!, vis: m.trou_diametre! >= 2.6 ? 'M2.5' : 'M2' });
  return trous;
}

function essentiels(questions: readonly QuestionMesure[]): QuestionMesure[] {
  return questions.filter((q) => !q.facultatif);
}

function carteMesuree(m: MesuresComposant): CarteGeometrie | null {
  if (essentiels(QUESTIONS_CARTE).some((q) => typeof m[q.champ] !== 'number')) return null;
  const trous = trousMesures(m);
  const incertitudes: string[] = [];
  if (!trous.length) {
    incertitudes.push(
      m.sans_trous === 1
        ? 'Le plan du fabricant ne montre aucun trou de fixation : la carte tient dans des glissières, à ses cotes (appuis aux quatre coins, crochets souples sur les grands côtés).'
        : 'Je n’ai pas les trous de fixation : la carte tient dans des glissières, à ses cotes (appuis aux quatre coins, crochets souples sur les grands côtés). Si elle a des trous, donne-moi leurs cotes et je mets des plots.',
    );
  }
  // Les prises lues sur un plan : un seul bord, jusqu'à trois prises.
  const prises: PriseCarte[] = [];
  const bord = typeof m.prise_bord === 'number' ? CODES_BORD[m.prise_bord - 1] : undefined;
  if (bord) {
    for (const n of [1, 2, 3]) {
      const centre = m[`prise${n}_centre`];
      const largeur = m[`prise${n}_largeur`];
      if (typeof centre !== 'number' || typeof largeur !== 'number') continue;
      // La hauteur d'une prise n'est pas sur un plan vu de dessus : on ouvre jusqu'au plus haut composant.
      prises.push({ nom: `prise ${n}`, bord, centre, largeur, hauteur: m.hauteur_dessus!, depasse: m[`prise${n}_depasse`] ?? 0, jeu: JEU_PRISE });
    }
    if (prises.length) incertitudes.push(`Prises : leur place et leur largeur viennent du plan du fabricant ; leur hauteur n’y est pas, l’ouverture monte jusqu’au plus haut composant (${fmt(m.hauteur_dessus!)} mm).`);
  }
  const depassements: Partial<Record<BordCarte, number>> = {};
  for (const [code, b] of [['xp', 'x+'], ['xm', 'x-'], ['yp', 'y+'], ['ym', 'y-']] as const) {
    const d = m[`depasse_${code}`];
    if (typeof d === 'number' && d > 0) depassements[b] = d;
  }
  if (Object.keys(depassements).length) incertitudes.push('Ce qui dépasse des bords sur le plan (antenne d’un module…) est gardé dans la boîte.');
  return {
    longueur: m.longueur!,
    largeur: m.largeur!,
    epaisseur: m.epaisseur!,
    trous,
    prises,
    hauteurLibre: m.hauteur_dessus! + 3,
    hauteurDessous: m.hauteur_dessous!,
    ...(Object.keys(depassements).length ? { depassements } : {}),
    incertitudes: prises.length ? incertitudes : [...incertitudes, 'Prises : je ne connais pas leur place. Si tu me dis de quel côté elles sortent, j’ouvre tout ce bord de la carte ; sinon dis-moi chaque ouverture (« une ouverture de 9 par 4 à l’arrière »).'],
  };
}

function ecranMesure(m: MesuresComposant): EcranGeometrie | null {
  if (essentiels(QUESTIONS_ECRAN).some((q) => typeof m[q.champ] !== 'number')) return null;
  const x0 = m.fenetre_bord_x!;
  const y1 = m.largeur! - m.fenetre_bord_y!;
  const trous = trousMesures(m);
  // Une place de fenêtre inconnue (−1, « prends large ») : toute la carte, moins un bord qui retient l'écran.
  const BORD = 1.5;
  const xInconnu = m.fenetre_bord_x! < 0 || m.fenetre_largeur! < 0;
  const yInconnu = m.fenetre_bord_y! < 0 || m.fenetre_hauteur! < 0;
  const incertitudes: string[] = trous.length ? [] : ['Je n’ai pas les trous de fixation de l’écran : il est calé dans un cadre plutôt que vissé.'];
  if (xInconnu || yInconnu) incertitudes.push('Je ne connais pas la place de la zone allumée : la fenêtre est ouverte au plus large (on verra un peu de la carte autour).');
  return {
    longueur: m.longueur!,
    largeur: m.largeur!,
    epaisseur: m.epaisseur!,
    hauteurDessus: m.hauteur_dessus!,
    hauteurDessous: m.hauteur_dessous!,
    fenetre: {
      x: xInconnu ? [BORD, m.longueur! - BORD] : [x0, x0 + m.fenetre_largeur!],
      y: yInconnu ? [BORD, m.largeur! - BORD] : [y1 - m.fenetre_hauteur!, y1],
    },
    trous,
    incertitudes,
  };
}

const MOTS: Record<string, RegExp> = {
  // « raspberry pi 4 », « pi zero », « pico » ne sont pas le Pi 5 : autres prises, autre taille.
  raspberry_pi_5: /\b(?:raspberry(?: pi)?(?: 5)?|rpi ?5|pi ?5)\b(?!(?: pi)? ?(?:[0-4]\b|zero|pico|400))/,
  // « écran tactile 5 pouces » n'est pas l'écran officiel de 7 pouces.
  touch_display_2_7: /\b(?:ecran tactile(?! (?:de )?(?:[0-689]|\d\d)(?:\.\d+)? ?pouces?)|touch display|ecran (?:de )?7 pouces|ecran officiel)\b/,
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
    else if (['esp32_s3_devkitc_1_borniers', 'max98357a'].includes(id)) {
      comp.carte = carteMesuree;
      comp.aMesurer = QUESTIONS_CARTE;
    } else if (id === 'oled_1_3_sh1106') {
      comp.ecran = ecranMesure;
      comp.aMesurer = QUESTIONS_ECRAN;
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

/**
 * Tous les composants nommés dans une phrase pliée, dans l'ordre où ils sont dits, chacun avec la
 * place de son nom (« un boîtier pour un ESP32-S3 avec un écran OLED » : la carte, puis l'écran).
 */
export function composantsNommes(t: string): { composant: Composant; debut: number; fin: number }[] {
  const out: { composant: Composant; debut: number; fin: number }[] = [];
  for (const c of COMPOSANTS) {
    const m = new RegExp(c.mots.source, 'g').exec(t);
    if (m && !out.some((o) => m.index < o.fin && m.index + m[0].length > o.debut)) out.push({ composant: c, debut: m.index, fin: m.index + m[0].length });
  }
  return out.sort((a, b) => a.debut - b.debut);
}

/** Mots génériques qui précèdent un nom de composant (« écran OLED », « module MAX98357A »). */
const AVANT_NOM = new Set(['ecran', 'module', 'carte', 'afficheur', 'petit', 'mini', 'ampli', 'amplificateur', 'micro']);
/** Mots qui finissent la référence d'un composant dans une phrase. */
const APRES_NOM = new Set(['avec', 'et', 'pour', 'prise', 'prises', 'port', 'ports', 'connecteur', 'connecteurs', 'dans', 'a', 'au', 'aux', 'qui', 'sur', 'en', 'du', 'des', 'la', 'le', 'les', 'l', 'un', 'une', 'ou', 'pas', 'plus', 'mais', 'puis', 'entre', 'sous', 'derriere', 'devant', 'cote', 'boite', 'boitier', 'plots', 'plot', 'fond', 'couvercle', 'vers', 'tenu', 'tenue', 'fixe', 'fixee', 'pose', 'posee']);

export interface ProduitNomme {
  composant: Composant;
  /** Place de la référence dans la phrase pliée (mot générique, nom, puis ce qui le précise). */
  debut: number;
  fin: number;
  /** La référence dite, pliée (« esp32 s3 devkitc 1 », « ecran oled 1.3 pouce i2c »). */
  produit: string;
  /** Vrai si la phrase dit plus que le nom de la bibliothèque (« ESP32-S3 DevKitC-1 », pas « mon ESP32 »). */
  precis: boolean;
}

/**
 * Les composants nommés dans une phrase pliée, avec leur référence (« un ESP32-S3 DevKitC-1 avec un
 * écran OLED 1,3 pouce I2C » : « esp32 s3 devkitc 1 », puis « ecran oled 1.3 pouce i2c »). La
 * référence va du nom jusqu'au prochain mot de liaison (« avec », « et », une virgule…).
 */
export function produitsNommes(t: string): ProduitNomme[] {
  return composantsNommes(t).map(({ composant: c, debut, fin }) => {
    let d = debut;
    const avant = t.slice(0, debut).trimEnd().split(' ');
    const dernier = avant[avant.length - 1];
    if (dernier && AVANT_NOM.has(dernier)) d = debut - (t.slice(0, debut).length - t.slice(0, debut).trimEnd().length) - dernier.length;
    const mots = t.slice(fin).split(' ');
    let f = fin;
    let pris = 0;
    for (let i = 0; i < mots.length && pris < 8; i += 1) {
      const m = mots[i]!;
      if (m === '') {
        f += 1;
        continue;
      }
      // « de 1,3 pouce » : « de » suivi d'un nombre fait partie de la référence.
      if (m === ',' || APRES_NOM.has(m) || (m === 'de' && !/\d/.test(mots[i + 1] ?? ''))) break;
      f += m.length + (i < mots.length - 1 ? 1 : 0);
      pris += 1;
    }
    const produit = t.slice(d, f).replace(/\s+/g, ' ').trim();
    const reste = t.slice(fin, f).replace(/\b(?:de|d)\b/g, ' ').trim();
    return { composant: c, debut: d, fin: f, produit, precis: /[a-z0-9]{2,}|\d/.test(reste) };
  });
}

/**
 * La référence telle qu'écrite dans la phrase d'origine (« ESP32-S3 DevKitC-1 »), retrouvée à partir
 * de sa forme pliée ; à défaut, la forme pliée.
 */
export function referenceDite(texte: string, produitPlie: string): string {
  const plie = (ch: string) => ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Même longueur que l'original, caractère par caractère : les positions se correspondent.
  const aligne = [...texte].map((ch) => {
    const p = plie(ch);
    return p.length === 1 ? p : ch.length === 1 ? ' ' : p.slice(0, ch.length);
  }).join('');
  const mots = produitPlie.split(' ').filter((m) => m && m !== ',');
  if (!mots.length) return produitPlie;
  const motif = mots.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\./g, '[.,]')).join('[^a-z0-9]+');
  const m = new RegExp(motif).exec(aligne);
  return m ? [...texte].slice(m.index, m.index + m[0].length).join('').trim() : produitPlie;
}

// ---------------------------------------------------------------------------------------------
// Mesures de l'utilisateur

const fmt =(x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

/** Prochaine mesure à demander pour ce composant, ou `null` s'il est prêt (les facultatives ne se demandent pas). */
export function prochaineMesure(c: Composant, mesures: MesuresComposants): QuestionMesure | null {
  if (c.etat !== 'a_mesurer' || !c.aMesurer) return null;
  const m = mesures[c.id] ?? {};
  return c.aMesurer.find((q) => !q.facultatif && typeof m[q.champ] !== 'number') ?? null;
}

/** La question, en français simple, avec où poser le pied à coulisse. */
export function questionMesure(c: Composant, q: QuestionMesure, mesures: MesuresComposants): string {
  const aDemander = (c.aMesurer ?? []).filter((x) => !x.facultatif);
  const total = aDemander.length || 1;
  const faites = Object.keys(mesures[c.id] ?? {}).filter((k) => aDemander.some((x) => x.champ === k)).length;
  const debut = faites === 0 ? `Je n’ai pas de cotes fiables pour ${c.nom} : il faut le mesurer au pied à coulisse (${total} mesures, une à la fois). ` : '';
  const large =
    q.large !== undefined
      ? ` Si tu n’as pas la pièce, dis « prends large » : ${q.largeTexte ?? `je laisse ${fmt(q.large)} mm, sans savoir si c’est juste`} (« prends large partout » : pour toutes les cotes qui manquent).`
      : '';
  return `${debut}Mesure ${faites + 1} sur ${total} : ${q.nom}, en millimètres. Pour ça, ${q.ou}.${large}`;
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
  const min = q.minMesure ?? q.min;
  if (!Number.isFinite(valeur) || valeur < min || valeur > q.max) return { mesures, erreur: `${fmt(valeur)} mm pour ${q.nom} : ça me paraît faux (de ${fmt(min)} à ${fmt(q.max)} mm).` };
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

/**
 * Les mesures de l'utilisateur qui contredisent une cote **sûre** trouvée pour la référence qu'il vient
 * de nommer (plus de 1 mm d'écart) : elles ont pu être prises sur une autre carte (une mesure n'a pas
 * de référence). Elles sont mises de côté, jamais effacées, et c'est dit.
 */
export function mesuresContredites(id: string, mesures: MesuresComposants, cotes: CotesTrouvees, ecart = 1): { champ: string; mesure: number; trouvee: number }[] {
  const out: { champ: string; mesure: number; trouvee: number }[] = [];
  for (const [champ, mesure] of Object.entries(mesures[id] ?? {})) {
    const lues = cotes[id]?.[champ];
    if (!lues?.length) continue;
    const e = etatCoteTrouvee(lues);
    if (e.etat === 'sur' && e.valeur !== undefined && Math.abs(e.valeur - mesure) > ecart) out.push({ champ, mesure, trouvee: e.valeur });
  }
  return out;
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
  /**
   * Lue dans la géométrie d'un plan du fabricant (DXF), sans modèle : elle suffit seule. Une page qui
   * la contredit ne la change pas (le plan est la référence ; le désaccord est dit).
   */
  plan?: boolean;
  /**
   * Valeur choisie par l'utilisateur sans la pièce (« prends large ») : elle passe avant des pages qui
   * se contredisent, mais reste « à vérifier » (jamais sûre, jamais une mesure).
   */
  choisie?: boolean;
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
  /** Valeurs de pages qui contredisent le plan du fabricant (le plan l'emporte). */
  contredite?: number[];
}

/**
 * Une cote lue sur une page, trop peu vraisemblable pour être gardée, même « à vérifier » :
 * - plus de 40 mm de haut au-dessus d'une carte (aucun composant d'une carte de développement) ;
 * - moins de 8 mm entre deux trous de fixation, de centre à centre ;
 * - un écart entre les trous plus grand que la carte elle-même (toutes les lectures de sa taille).
 * `null` : rien à redire.
 */
export function coteInvraisemblable(c: Composant, lues: Readonly<Record<string, readonly CoteLue[]>>, champ: string, valeur: number): string | null {
  if (!c.carte && !c.ecran) return null;
  if (champ === 'hauteur_dessus' && c.carte && !c.ecran && valeur > 40) return `${fmt(valeur)} mm au-dessus de la carte : trop haut pour être vrai.`;
  if ((champ === 'entraxe_x' || champ === 'entraxe_y') && valeur < 8) return `${fmt(valeur)} mm entre deux trous de fixation : trop peu pour être vrai.`;
  const cote = champ === 'entraxe_x' ? 'longueur' : champ === 'entraxe_y' ? 'largeur' : null;
  const tailles = cote ? (lues[cote] ?? []).map((l) => l.valeur) : [];
  if (cote && tailles.length && valeur >= Math.max(...tailles)) return `${fmt(valeur)} mm entre les trous, pour une carte de ${fmt(Math.max(...tailles))} mm : impossible.`;
  return null;
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
  // Une cote lue sur une page (pas sur le plan du fabricant) doit aussi être vraisemblable : le
  // 25 novembre, une page a donné 53,7 mm de haut au-dessus d'une carte ESP32 et 4,6 mm entre deux
  // trous de fixation, gardés « à vérifier » et dits à l'utilisateur.
  if (!lue.plan && !lue.choisie) {
    const invraisemblable = coteInvraisemblable(c, cotes[id] ?? {}, champ, lue.valeur);
    if (invraisemblable) return { cotes, erreur: invraisemblable };
  }
  const avant = (cotes[id]?.[champ] ?? []).filter((x) => x.source !== lue.source);
  const nouvelle: CoteLue = { valeur: lue.valeur, source: lue.source.trim(), ...(lue.plan ? { plan: true } : {}), ...(lue.choisie ? { choisie: true } : {}) };
  return { cotes: { ...cotes, [id]: { ...(cotes[id] ?? {}), [champ]: [...avant, nouvelle] } } };
}

/** L'état d'une cote trouvée : sûre si deux sources différentes concordent, ou lue sur un plan du fabricant. */
export function etatCoteTrouvee(lues: readonly CoteLue[]): EtatCoteTrouvee {
  const plan = lues.find((l) => l.plan);
  if (plan) {
    const contre = lues.filter((l) => !l.plan && Math.abs(l.valeur - plan.valeur) > CONCORDANCE_MM);
    return {
      etat: 'sur',
      valeur: plan.valeur,
      sources: [...new Set(lues.filter((l) => !contre.includes(l)).map((l) => l.source))],
      ...(contre.length ? { contredite: contre.map((l) => l.valeur) } : {}),
    };
  }
  const choisie = lues.find((l) => l.choisie);
  if (choisie) return { etat: 'incertain', valeur: choisie.valeur, sources: [choisie.source] };
  const sources = [...new Set(lues.map((l) => l.source))];
  for (const l of lues) {
    const daccord = lues.filter((x) => Math.abs(x.valeur - l.valeur) <= CONCORDANCE_MM);
    // Deux pages d'un même site ne comptent que pour une.
    if (new Set(daccord.map((x) => siteDeSource(x.source))).size >= 2) {
      const valeur = Math.round((daccord.reduce((s, x) => s + x.valeur, 0) / daccord.length) * 100) / 100;
      return { etat: 'sur', valeur, sources: [...new Set(daccord.map((x) => x.source))] };
    }
  }
  const valeurs = [...new Set(lues.map((l) => l.valeur))];
  return valeurs.length === 1 ? { etat: 'incertain', valeur: valeurs[0]!, sources } : { etat: 'incertain', sources, desaccord: valeurs };
}

/** Le site d'une source (« https://www.espressif.com/… » → « espressif.com »). */
export function siteDeSource(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return source.trim().toLowerCase();
  }
}

/** Champs d'encombrement : quand les sources ne concordent pas, le plus grand est sans danger (boîte un peu plus grande). */
export const CHAMPS_ENCOMBREMENT: readonly string[] = ['longueur', 'largeur', 'hauteur_dessus'];

export interface OptionsFusion {
  /**
   * Cotes trouvées sur Internet pour une pièce qu'on n'a pas en main (demande de l'utilisateur,
   * 24 novembre) : une cote d'une seule source sert aussi (« à vérifier à réception »), et un
   * encombrement en désaccord prend la plus grande valeur. Un trou en désaccord reste manquant.
   */
  uneSource?: boolean;
}

/**
 * Un encombrement en désaccord : la plus grande valeur, seulement si les lectures restent proches
 * (20 % d'écart au plus). Au-delà, l'une d'elles est fausse (vu le 25 novembre : 12 et 70 mm pour la
 * hauteur d'une même carte) : rien n'est pris, la cote reste à trouver.
 */
export function plusGrandeSiProches(champ: string, desaccord: readonly number[] | undefined): number | undefined {
  if (!desaccord?.length || !CHAMPS_ENCOMBREMENT.includes(champ)) return undefined;
  const max = Math.max(...desaccord);
  return max <= Math.min(...desaccord) * 1.2 ? max : undefined;
}

/**
 * Les mesures à utiliser pour dessiner : celles de l'utilisateur d'abord, puis les cotes trouvées
 * **sûres**. Sans `uneSource`, une cote incertaine n'entre pas : elle reste à mesurer.
 */
export function fusionnerCotes(mesures: MesuresComposants, cotes: CotesTrouvees, options: OptionsFusion = {}): MesuresComposants {
  const out: MesuresComposants = { ...mesures };
  for (const [id, champs] of Object.entries(cotes)) {
    for (const [champ, lues] of Object.entries(champs)) {
      if (typeof mesures[id]?.[champ] === 'number') continue;
      const e = etatCoteTrouvee(lues);
      let valeur: number | undefined;
      if (e.etat === 'sur') valeur = e.valeur;
      else if (options.uneSource && e.valeur !== undefined) valeur = e.valeur;
      else if (options.uneSource) valeur = plusGrandeSiProches(champ, e.desaccord);
      if (valeur !== undefined) out[id] = { ...(out[id] ?? {}), [champ]: valeur };
    }
  }
  return out;
}

/** D'où viennent les cotes d'un composant, et ce qui n'y est pas sûr (pour le résultat d'une étape). */
export function provenanceCotes(id: string, mesures: MesuresComposants, cotes: CotesTrouvees, options: OptionsFusion = {}): { sources: string[]; incertitudes: string[] } {
  const c = composant(id);
  if (!c?.aMesurer) return { sources: [], incertitudes: [] };
  const sources: string[] = [];
  const incertitudes: string[] = [];
  const plans = new Set<string>();
  for (const q of c.aMesurer) {
    if (typeof mesures[id]?.[q.champ] === 'number') {
      sources.push(`${c.nom}, ${q.nom} : mesuré au pied à coulisse par l'utilisateur`);
      continue;
    }
    const lues = cotes[id]?.[q.champ];
    if (!lues?.length) continue;
    const e = etatCoteTrouvee(lues);
    // Ce qui n'est lu que sur un plan (bord des prises, absence de trous) : le plan est cité une fois.
    if (q.facultatif === 'plan') {
      for (const l of lues) if (l.plan) plans.add(l.source);
      continue;
    }
    if (e.valeur !== undefined && e.valeur < 0) {
      incertitudes.push(`${c.nom}, ${q.nom} : inconnue ; ${q.largeTexte ?? 'au plus large'} — à vérifier quand tu auras la pièce.`);
      continue;
    }
    if (e.contredite?.length) incertitudes.push(`${c.nom}, ${q.nom} : une page dit ${e.contredite.map(fmt).join(' / ')} mm, le plan du fabricant ${fmt(e.valeur!)} mm ; je suis le plan.`);
    if (e.etat === 'sur') sources.push(`${c.nom}, ${q.nom} : ${fmt(e.valeur!)} mm (${lues.some((l) => l.plan) ? 'plan du fabricant, ' : ''}${e.sources.join(' ; ')})`);
    else if (options.uneSource && e.desaccord && plusGrandeSiProches(q.champ, e.desaccord) !== undefined) {
      incertitudes.push(`${c.nom}, ${q.nom} : les sources ne concordent pas (${e.desaccord.map(fmt).join(' / ')} mm), j'ai pris la plus grande — à vérifier quand tu auras la pièce (${e.sources.join(' ; ')}).`);
    } else if (e.valeur !== undefined && options.uneSource) {
      incertitudes.push(`${c.nom}, ${q.nom} : ${fmt(e.valeur)} mm sur une seule source (${e.sources[0]}) — à vérifier quand tu auras la pièce.`);
    } else if (e.desaccord) incertitudes.push(`${c.nom}, ${q.nom} : les sources ne concordent pas (${e.desaccord.map(fmt).join(' / ')} mm) — à mesurer.`);
    else incertitudes.push(`${c.nom}, ${q.nom} : ${fmt(e.valeur!)} mm sur une seule source (${e.sources[0]}) — à mesurer.`);
  }
  for (const p of plans) sources.push(`${c.nom}, prises, dépassements et trous de fixation : plan du fabricant (${p})`);
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
        for (const l of lues as { valeur?: unknown; source?: unknown; plan?: unknown; choisie?: unknown }[]) {
          if (typeof l?.valeur !== 'number' || typeof l.source !== 'string') continue;
          const r = ajouterCoteTrouvee(cotes, id, champ, { valeur: l.valeur, source: l.source, ...(l.plan === true ? { plan: true } : {}), ...(l.choisie === true ? { choisie: true } : {}) });
          if (!r.erreur) cotes = r.cotes;
        }
      }
    }
  } catch {
    return {};
  }
  return cotes;
}

/** Les recherches déjà faites, par composant : le produit cherché, le jour, ce qui manquait encore. */
export type RecherchesCotes = Record<string, { produit: string; jour: string; manquants: string[]; plans?: boolean }>;

export function lireRecherchesCotes(texte: string): RecherchesCotes {
  const out: RecherchesCotes = {};
  try {
    const data = JSON.parse(texte) as { recherches?: unknown };
    if (!data || typeof data !== 'object' || !data.recherches || typeof data.recherches !== 'object') return out;
    for (const [id, r] of Object.entries(data.recherches as Record<string, { produit?: unknown; jour?: unknown; manquants?: unknown }>)) {
      if (!composant(id) || typeof r?.produit !== 'string' || typeof r.jour !== 'string') continue;
      out[id] = {
        produit: r.produit,
        jour: r.jour,
        manquants: Array.isArray(r.manquants) ? r.manquants.filter((x): x is string => typeof x === 'string') : [],
        ...((r as { plans?: unknown }).plans === true ? { plans: true } : {}),
      };
    }
  } catch {
    return {};
  }
  return out;
}

export function ecrireFichierCotes(cotes: CotesTrouvees, recherches: RecherchesCotes = {}): string {
  return `${JSON.stringify({ version: 1, note: 'Cotes de composants trouvées par Jarvis (recherche, fiches), chacune avec sa source.', cotes, recherches }, null, 2)}\n`;
}

/** La géométrie d'une carte, si elle est connue (sûre, ou mesurée). */
export function geometrieCarte(c: Composant, mesures: MesuresComposants): CarteGeometrie | null {
  if (!c.carte) return null;
  if (prochaineMesure(c, mesures)) return null;
  return c.carte(mesures[c.id] ?? {});
}

/** Hauteur des plots d'une carte (référence : 5 mm pour le Raspberry Pi 5). */
export const PLOT_CARTE = 5;
const PLOT_DIAMETRE: Record<VisCarte, number> = { M2: 5, 'M2.5': 6 };

/**
 * Glissières d'une carte sans trous de fixation (choix de dessin) : appuis carrés aux quatre coins,
 * butée au bout opposé aux prises, et un crochet souple au milieu de chaque grand côté, qui mord sur
 * le bord de la carte. La lame du crochet doit plier sans casser (règle de la lame souple en PETG).
 */
export const GLISSIERE = {
  appui: 2,
  /** Lame du crochet : épaisseur, largeur, jeu avec la carte. */
  lame: 1.2,
  largeur: 6,
  jeu: 0.3,
  /** Ce que le crochet mord sur la carte. */
  morsure: 0.5,
  /** Place laissée entre la carte et la paroi pour que la lame plie. */
  place: 2.5,
  /** Butée au bout de la carte. */
  butee: 1.2,
} as const;

/** Longueur de lame la plus courte qui plie de `morsure` sans dépasser l'allongement permis (e = 3 t f / 2 L²). */
export function lameMini(): number {
  const e = DONNEES_COMPOSANTS.regles_de_dessin.lame_souple_PETG.allongement_maxi_pct / 100;
  return Math.sqrt((3 * GLISSIERE.lame * GLISSIERE.morsure) / (2 * e));
}

/** La géométrie d'un écran, si elle est connue (mesurée, ou trouvée). */
export function geometrieEcran(c: Composant, mesures: MesuresComposants): EcranGeometrie | null {
  if (!c.ecran) return null;
  if (prochaineMesure(c, mesures)) return null;
  return c.ecran(mesures[c.id] ?? {});
}

/** Enveloppe prudente d'une carte (repère de la carte, mm) : carte, prises et ce qui dépasse, hauteur libre. */
export function enveloppeCarte(g: CarteGeometrie): { x: [number, number]; y: [number, number]; z: [number, number] } {
  const x: [number, number] = [0, g.longueur];
  const y: [number, number] = [0, g.largeur];
  const etend = (bord: BordCarte, d: number) => {
    if (bord === 'x+') x[1] = Math.max(x[1], g.longueur + d);
    if (bord === 'x-') x[0] = Math.min(x[0], -d);
    if (bord === 'y+') y[1] = Math.max(y[1], g.largeur + d);
    if (bord === 'y-') y[0] = Math.min(y[0], -d);
  };
  for (const p of g.prises) etend(p.bord, p.depasse);
  for (const [bord, d] of Object.entries(g.depassements ?? {}) as [BordCarte, number][]) etend(bord, d);
  if (g.dessous) etend(g.dessous.bord, g.dessous.depasse);
  // (+ 0 : pas de « −0 » quand rien ne dépasse.)
  return { x: [x[0] + 0, x[1]], y: [y[0] + 0, y[1]], z: [-g.epaisseur - (g.hauteurDessous ?? 0), g.hauteurLibre] };
}

// ---------------------------------------------------------------------------------------------
// Poser une carte dans une boîte

export type Paroi = 'avant' | 'arriere' | 'gauche' | 'droite';

/** Direction (vue de dessus, vers l'extérieur) de chaque paroi. */
const DIRECTION: Record<Paroi, [number, number]> = { arriere: [0, 1], avant: [0, -1], droite: [1, 0], gauche: [-1, 0] };

function paroiDe(d: [number, number]): Paroi {
  if (d[1] > 0.5) return 'arriere';
  if (d[1] < -0.5) return 'avant';
  return d[0] > 0 ? 'droite' : 'gauche';
}

/** Tourne un vecteur de 90° dans le sens des aiguilles d'une montre (vu de dessus). */
const droiteDe = (d: [number, number]): [number, number] => [d[1] + 0, -d[0] + 0];
const gaucheDe = (d: [number, number]): [number, number] => [-d[1] + 0, d[0] + 0];

/**
 * Orientation d'une carte posée à plat (une rotation seulement : une carte ne se retourne pas) : le
 * bord `bord` de la carte face à la paroi `paroi`. x de la carte vers `ux`, y vers `uy`.
 */
function orientation(bord: BordCarte, paroi: Paroi): { ux: [number, number]; uy: [number, number] } {
  const P = DIRECTION[paroi];
  const neg = (d: [number, number]): [number, number] => [-d[0] + 0, -d[1] + 0];
  switch (bord) {
    case 'x+':
      return { ux: P, uy: gaucheDe(P) };
    case 'x-':
      return { ux: neg(P), uy: droiteDe(P) };
    case 'y+':
      return { ux: droiteDe(P), uy: P };
    case 'y-':
      return { ux: gaucheDe(P), uy: neg(P) };
  }
}

const OPPOSE: Record<BordCarte, BordCarte> = { 'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+' };

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
  /** Ce que la carte occupe vue de dessus (repère de la boîte), avec ce qui dépasse et sa tenue. */
  emprise: { x: [number, number]; y: [number, number] };
  /** Matière : plots, ou appuis, butées et crochets. */
  plus: Forme[];
  /** Trous : avant-trous, ouvertures des prises, creux d'amincissement. */
  moins: Forme[];
  erreurs: string[];
  /** Pour les essais : chaque plot et son trou, chaque prise et son ouverture (rectangles dans la paroi). */
  verif: {
    plots: { trou: [number, number]; plot: [number, number] }[];
    prises: { nom: string; paroi: Paroi; prise: Rect; ouverture: Rect; paroiRestante: number; rayon: number }[];
    /** Glissières : allongement de la lame des crochets (%), à comparer à la règle. */
    crochets?: { allongement: number; morsure: number };
    /** Glissières : haut de la butée (sous le dessus de la carte quand un module dépasse de ce bout). */
    butee?: number;
  };
  /** Comment la carte tient : plots vissés, ou glissières. */
  tenue: 'plots' | 'glissieres';
  /** Ce que la phrase doit dire de ce qui reste incertain. */
  incertitudes: string[];
}

/** Rectangle dans le plan d'une paroi : `a` le long de la paroi (coordonnée de la boîte), `z` en hauteur. */
export interface Rect {
  a: [number, number];
  z: [number, number];
}

export interface OptionsPose {
  /**
   * Décalage le long de la paroi des prises, depuis le coin (mm) : la place des cartes déjà posées
   * (plusieurs cartes côte à côte le long de la même paroi).
   */
  decalage?: number;
  /** Les prises ont été demandées sur cette paroi : sans prise connue, tout le bord de la carte est ouvert. */
  prisesDemandees?: boolean;
}

/**
 * Pose une carte à plat dans le coin de la boîte où sa paroi de prises (`ports`) et la paroi voisine
 * (à droite quand on regarde la paroi des prises de l'intérieur) se rejoignent : le bord aux prises
 * contre `ports`. Avec ses trous : sur des plots vissés. Sans trous : dans des glissières (appuis
 * aux coins, butée, crochets souples). Les prises sont percées, avec leur jeu ; une prise qui ne
 * dépasse pas de la carte a sa paroi amincie de l'extérieur à 1 mm, pour que la fiche entre à fond.
 */
export function poserCarte(nom: string, g0: CarteGeometrie, b: BoiteHote, ports: Paroi, options: OptionsPose = {}): CartePosee {
  const erreurs: string[] = [];
  const incertitudes = [...g0.incertitudes];
  // Sans prise connue mais demandée de ce côté : tout le bord x+ de la carte est ouvert, à sa hauteur.
  // Seulement si l'ouverture reste un pont imprimable sans support (25 mm) : sinon, c'est dit.
  const pontMax = DONNEES_COMPOSANTS.regles_de_dessin.pont_maxi_sans_support;
  const sansPlace = options.prisesDemandees === true && g0.prises.length === 0;
  const ouvrirBord = sansPlace && g0.largeur + 2 * JEU_PRISE <= pontMax;
  const g: CarteGeometrie = ouvrirBord
    ? { ...g0, prises: [{ nom: 'prises (place inconnue)', bord: 'x+', centre: g0.largeur / 2, largeur: g0.largeur, hauteur: Math.max(1, g0.hauteurLibre - 3), depasse: 0, jeu: JEU_PRISE }] }
    : g0;
  if (ouvrirBord) incertitudes.push(`${maj(nom)} : je ne connais pas la place de ses prises ; j’ouvre tout ce bord de la carte. Pose-la prises vers cette paroi.`);
  else if (sansPlace) {
    incertitudes.push(
      `${maj(nom)} : je ne connais pas la place de ses prises, et ouvrir tout le bord (${fmt(g0.largeur)} mm) ne s’imprimerait pas sans support : je ne perce rien. Dis-moi chaque ouverture (« une ouverture de 9 par 4 à l’arrière, à 12 mm du bord gauche »).`,
    );
  }
  // Le bord des prises : celui qui en a le plus (x+ d'abord, comme le Raspberry Pi 5).
  const compte = (bord: BordCarte) => g.prises.filter((p) => p.bord === bord).length;
  const bordPrises: BordCarte = (['x+', 'y-', 'x-', 'y+'] as const).reduce((m, bord) => (compte(bord) > compte(m) ? bord : m), 'x+' as BordCarte);
  const { ux, uy } = orientation(bordPrises, ports);
  const glissieres = g.trous.length === 0;
  const env = enveloppeCarte(g);
  const P = DIRECTION[ports];
  const N = droiteDe(P);

  // Écarts aux parois : contre la paroi des prises, ce qui dépasse (1,5 mm au plus) ou le jeu ; sur
  // les côtés, le jeu, ou la place des crochets ; au bout, le jeu, ou la butée.
  const depassePrises = Math.max(0, ...g.prises.filter((p) => p.bord === bordPrises).map((p) => p.depasse));
  const ecartP = depassePrises > 0 ? Math.min(depassePrises, 1.5) : JEU_CARTE_PAROI;
  const ecartCote = glissieres ? GLISSIERE.place : JEU_CARTE_PAROI;
  const ecartBout = glissieres ? GLISSIERE.jeu + GLISSIERE.butee + JEU_CARTE_PAROI : JEU_CARTE_PAROI;
  const decalage = options.decalage ?? 0;

  // Les coins de la carte (sans ce qui entre dans la paroi des prises) et de son enveloppe, vus de dessus.
  const vers = (x: number, y: number): [number, number] => [x * ux[0] + y * uy[0], x * ux[1] + y * uy[1]];
  const dot = (p: [number, number], d: [number, number]) => p[0] * d[0] + p[1] * d[1];
  const coinsCarte = [vers(0, 0), vers(g.longueur, 0), vers(0, g.largeur), vers(g.longueur, g.largeur)];
  const coinsEnv = [vers(env.x[0], env.y[0]), vers(env.x[1], env.y[0]), vers(env.x[0], env.y[1]), vers(env.x[1], env.y[1])];
  const maxP = Math.max(...coinsCarte.map((c) => dot(c, P)));
  const maxN = Math.max(...coinsEnv.map((c) => dot(c, N)));
  // Le mur intérieur dans la direction d : sa position projetée sur d.
  const mur = (d: [number, number]) => (d[0] > 0.5 ? b.L - b.e : d[0] < -0.5 ? -b.e : d[1] > 0.5 ? b.W - b.e : -b.e);
  const kP = mur(P) - ecartP - maxP;
  const kN = mur(N) - ecartCote - decalage - maxN;
  const O: [number, number] = [P[0] * kP + N[0] * kN, P[1] * kP + N[1] * kN];
  const monde = (x: number, y: number): [number, number] => {
    const v = vers(x, y);
    return [O[0] + v[0], O[1] + v[1]];
  };
  const tenueHaut = glissieres ? Math.max((g.hauteurDessous ?? 0) + 1, lameMini() - g.epaisseur, GLISSIERE.appui) : Math.max(PLOT_CARTE, (g.hauteurDessous ?? 0) + 1);
  const zDessous = b.f + tenueHaut;
  const zDessus = zDessous + g.epaisseur;

  // Ce que la carte occupe, avec sa tenue : l'enveloppe (sans ce qui entre dans la paroi des prises),
  // plus la butée et les crochets.
  const envSansPrises = coinsEnv.map((c) => [O[0] + c[0], O[1] + c[1]] as [number, number]);
  const xs = envSansPrises.map((c) => c[0]);
  const ys = envSansPrises.map((c) => c[1]);
  const emprise = { x: [Math.min(...xs), Math.max(...xs)] as [number, number], y: [Math.min(...ys), Math.max(...ys)] as [number, number] };
  // Côté P, la carte s'arrête à son bord (les prises entrent dans la paroi) ; côté opposé et côtés, la tenue.
  const marge = (d: [number, number], m: number) => {
    if (d[0] > 0.5) emprise.x[1] += m;
    if (d[0] < -0.5) emprise.x[0] -= m;
    if (d[1] > 0.5) emprise.y[1] += m;
    if (d[1] < -0.5) emprise.y[0] -= m;
  };
  const pointeP = Math.max(...coinsEnv.map((c) => dot(c, P)));
  marge(P, maxP - pointeP); // on ne compte pas ce qui entre dans la paroi
  marge([-P[0], -P[1]], ecartBout - JEU_CARTE_PAROI);
  marge(N, ecartCote - JEU_CARTE_PAROI);
  marge([-N[0], -N[1]], ecartCote - JEU_CARTE_PAROI);

  // Tient-elle entre les parois ?
  const tientX = emprise.x[0] >= b.e - 1e-6 && emprise.x[1] <= b.L - b.e + 1e-6;
  const tientY = emprise.y[0] >= b.e - 1e-6 && emprise.y[1] <= b.W - b.e + 1e-6;
  const tropLoin = g.prises.some((p) => p.depasse > (p.bord === bordPrises ? ecartP : ecartCote) + b.e);
  if (!tientX || !tientY) {
    const besoinP = maxP - Math.min(...coinsEnv.map((c) => dot(c, P))) + ecartP + ecartBout;
    const besoinN = maxN - Math.min(...coinsEnv.map((c) => dot(c, N))) + 2 * ecartCote + decalage;
    const besoinL = Math.abs(P[0]) * besoinP + Math.abs(N[0]) * besoinN;
    const besoinW = Math.abs(P[1]) * besoinP + Math.abs(N[1]) * besoinN;
    erreurs.push(`${maj(nom)} ne tient pas dans le fond : il faut ${fmt(besoinL + 2 * b.e)} × ${fmt(besoinW + 2 * b.e)} mm au moins (boîte de ${fmt(b.L)} × ${fmt(b.W)} mm).`);
  }
  if (tropLoin) erreurs.push(`${maj(nom)} : une prise dépasserait de la boîte, la paroi est trop fine.`);
  const tenueTexte = glissieres ? `appuis de ${fmt(tenueHaut)} mm` : `plots de ${fmt(tenueHaut)} mm`;
  if (zDessus + g.hauteurLibre > b.zHaut + 1e-6) {
    erreurs.push(`${maj(nom)} : la boîte est trop basse. Il faut ${fmt(zDessus + g.hauteurLibre - b.f)} mm au-dessus du fond (${tenueTexte}, carte, puis ${fmt(g.hauteurLibre)} mm libres), il y en a ${fmt(b.zHaut - b.f)}.`);
  }

  const plus: Forme[] = [];
  const moins: Forme[] = [];
  const verif: CartePosee['verif'] = { plots: [], prises: [] };
  // La carte vers la boîte : une rotation et un déplacement, pour la matière dessinée dans le repère de la carte.
  const versBoite = (f: Forme): Forme => ({
    scad: `multmatrix([[${n3(ux[0])}, ${n3(uy[0])}, 0, ${n3(O[0])}], [${n3(ux[1])}, ${n3(uy[1])}, 0, ${n3(O[1])}], [0, 0, 1, 0], [0, 0, 0, 1]]) { ${f.scad} }`,
  });
  if (!glissieres) {
    for (const t of g.trous) {
      const [x, y] = monde(t.x, t.y);
      plus.push(cyl(x, y, b.f - 0.01, zDessous, PLOT_DIAMETRE[t.vis] / 2));
      moins.push(cyl(x, y, b.f + 0.6, zDessous + 0.01, AVANT_TROU[t.vis] / 2));
      verif.plots.push({ trou: monde(t.x, t.y), plot: [x, y] });
    }
  } else {
    const G = GLISSIERE;
    const Lc = g.longueur;
    const Wc = g.largeur;
    const a = Math.min(G.appui, Lc / 4, Wc / 4);
    // Appuis aux quatre coins, sous la carte.
    for (const [x0, y0] of [[0, 0], [Lc - a, 0], [0, Wc - a], [Lc - a, Wc - a]] as const) plus.push(versBoite(pave(x0, x0 + a, y0, y0 + a, b.f - 0.01, zDessous)));
    // Butée au bout opposé aux prises, jusqu'un peu au-dessus de la carte.
    const bout = OPPOSE[bordPrises];
    // Un module qui dépasse de ce bout (antenne) passe au-dessus de la butée : elle s'arrête sous le dessus de la carte.
    const haut = g.depassements?.[bout] ? zDessus - 0.2 : zDessus + 1;
    verif.butee = haut;
    const lb = Math.min(4, (bout === 'x-' || bout === 'x+' ? Wc : Lc) / 4);
    if (bout === 'x-' || bout === 'x+') {
      const x0 = bout === 'x-' ? -G.jeu - G.butee : Lc + G.jeu;
      for (const y0 of [0, Wc - lb]) plus.push(versBoite(pave(x0, x0 + G.butee, y0, y0 + lb, b.f - 0.01, haut)));
    } else {
      const y0 = bout === 'y-' ? -G.jeu - G.butee : Wc + G.jeu;
      for (const x0 of [0, Lc - lb]) plus.push(versBoite(pave(x0, x0 + lb, y0, y0 + G.butee, b.f - 0.01, haut)));
    }
    // Un crochet au milieu de chaque côté qui n'est ni le bord des prises ni le bout.
    const cotes = (['x+', 'x-', 'y+', 'y-'] as const).filter((c) => c !== bordPrises && c !== bout);
    const zc = zDessus + 0.15;
    for (const c of cotes) {
      // Le crochet dessiné pour le côté y− (extérieur vers y < 0), puis posé sur son côté.
      const long = c === 'y-' || c === 'y+' ? Lc : Wc;
      const m = long / 2;
      const lame = pave(m - G.largeur / 2, m + G.largeur / 2, -G.jeu - G.lame, -G.jeu, b.f - 0.01, zc + 0.4);
      const bec = `hull() { ${pave(m - G.largeur / 2, m + G.largeur / 2, -G.jeu - G.lame, G.morsure, zc, zc + 0.4).scad} ${pave(m - G.largeur / 2, m + G.largeur / 2, -G.jeu - G.lame, -G.jeu, zc, zc + 0.4 + G.morsure + G.jeu + 0.2).scad} }`;
      const crochet: Forme = { scad: `union() { ${lame.scad} ${bec} }` };
      // y− → c : y+ = miroir de y ; x− = tourner (x, y) → (y, x) puis miroir ; x+ = (x, y) → (Lc − y, x).
      const m3 =
        c === 'y-' ? '[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]'
        : c === 'y+' ? `[[1, 0, 0, 0], [0, -1, 0, ${n3(Wc)}], [0, 0, 1, 0], [0, 0, 0, 1]]`
        : c === 'x-' ? '[[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]'
        : `[[0, -1, 0, ${n3(Lc)}], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]`;
      plus.push(versBoite({ scad: `multmatrix(${m3}) { ${crochet.scad} }` }));
    }
    const longueurLame = zc - b.f;
    const allongement = ((3 * G.lame * G.morsure) / (2 * longueurLame ** 2)) * 100;
    verif.crochets = { allongement, morsure: G.morsure };
    if (allongement > DONNEES_COMPOSANTS.regles_de_dessin.lame_souple_PETG.allongement_maxi_pct + 1e-9) {
      erreurs.push(`${maj(nom)} : les crochets seraient trop raides et casseraient (${fmt(allongement)} % d’allongement, ${fmt(DONNEES_COMPOSANTS.regles_de_dessin.lame_souple_PETG.allongement_maxi_pct)} % au plus).`);
    }
    incertitudes.push(`${maj(nom)} : posée sur ${fmt(a)} mm à chaque coin, et tenue par deux crochets qui mordent ${fmt(G.morsure)} mm sur le bord des grands côtés — rien ne doit dépasser à ces endroits (vérifie à réception).`);
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
    // Une prise qui ne dépasse pas (ou à peine, 1 mm au plus) : la paroi est amincie pour que la fiche entre à fond.
    const amincie = prises.every((p) => p.depasse <= 1) && b.e > PAROI_RESTANTE + 0.05;
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
  return { monde, zDessous, zDessus, emprise, plus, moins, erreurs, verif, tenue: glissieres ? 'glissieres' : 'plots', incertitudes };
}

function n3(x: number): string {
  return String(Math.round(x * 1000) / 1000);
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
