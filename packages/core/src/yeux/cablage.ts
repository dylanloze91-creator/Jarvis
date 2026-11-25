/**
 * Les yeux, étape 2, point 3 : vérifier un câblage par rapport à une référence connue
 * (`docs/specs/yeux-etape-2.md`). L'enceinte d'abord : sa référence est le fichier
 * `firmware/jarvis-speaker/include/config.h`, lu tel quel (les broches suivent le fichier).
 *
 * Le modèle de vision dit quels fils il voit (d'où à où) ; Jarvis compare, sans modèle, à la
 * référence, et dit ce qui diffère, ce qu'il n'a pas vu et ce qu'il faut mesurer. Il ne dit jamais
 * qu'un câblage est bon : une photo peut tromper, la vérification au multimètre reste à l'utilisateur.
 * Le modèle de vision ne reçoit jamais les numéros de broches attendus (il « verrait » ce qu'on attend).
 */

function sansAccents(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/** Un module de la référence, avec les mots qui le désignent sur une photo ou dans une question. */
export interface ModuleReference {
  id: string;
  nom: string;
  mots: string[];
}

/** Une liaison attendue : broche du module → broche (ou alimentation) de la carte principale. */
export interface LiaisonReference {
  module: string;
  broche: string;
  /** Broche de la carte principale : numéro de GPIO (« 4 »), « 3V3 », « 5V » ou « GND ». */
  carte: string;
  /** D'où vient la liaison (nom de la constante, ou commentaire du fichier). */
  origine: string;
  /** Une erreur ici peut abîmer quelque chose (alimentation). */
  critique?: boolean;
}

export interface ReferenceCablage {
  id: string;
  nom: string;
  /** La carte principale (celle des GPIO). */
  carte: string;
  fichier: string;
  modules: ModuleReference[];
  liaisons: LiaisonReference[];
  /** Constantes attendues absentes du fichier (référence incomplète : dit, jamais deviné). */
  manquantes: string[];
}

export const FICHIER_REFERENCE_ENCEINTE = 'firmware/jarvis-speaker/include/config.h';

/** Lit les `#define NOM valeur` d'un fichier C (commentaires retirés). */
export function lireDefines(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const ligne of source.split(/\r?\n/)) {
    const m = /^\s*#define\s+([A-Z0-9_]+)\s+(.+?)\s*$/.exec(ligne.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, ''));
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const MODULES_ENCEINTE: ModuleReference[] = [
  { id: 'micro', nom: 'micro INMP441', mots: ['inmp441', 'micro', 'microphone', 'mic'] },
  { id: 'ampli', nom: 'ampli MAX98357A', mots: ['max98357', 'max98357a', 'ampli', 'amplificateur', 'amp'] },
  { id: 'ecran', nom: 'écran OLED', mots: ['oled', 'ecran', 'ssd1306', 'sh1106', 'display'] },
];

/** Broches des modules lues dans config.h : constante → (module, broche du module). */
const CONSTANTES_ENCEINTE: Array<{ constante: string; module: string; broche: string }> = [
  { constante: 'MIC_PIN_SCK', module: 'micro', broche: 'SCK' },
  { constante: 'MIC_PIN_WS', module: 'micro', broche: 'WS' },
  { constante: 'MIC_PIN_SD', module: 'micro', broche: 'SD' },
  { constante: 'AMP_PIN_BCLK', module: 'ampli', broche: 'BCLK' },
  { constante: 'AMP_PIN_LRC', module: 'ampli', broche: 'LRC' },
  { constante: 'AMP_PIN_DIN', module: 'ampli', broche: 'DIN' },
  { constante: 'DISPLAY_PIN_SDA', module: 'ecran', broche: 'SDA' },
  { constante: 'DISPLAY_PIN_SCL', module: 'ecran', broche: 'SCL' },
];

/**
 * Liaisons écrites en clair dans les commentaires de config.h, gardées seulement si la phrase y est
 * encore (le fichier change : on ne garde pas une règle qu'il ne dit plus).
 */
const COMMENTAIRES_ENCEINTE: Array<{ phrase: RegExp; liaisons: Omit<LiaisonReference, 'origine'>[]; origine: string }> = [
  {
    phrase: /L\/R du micro reli[ée] [àa] GND/i,
    origine: 'commentaire de config.h : « L/R du micro relié à GND »',
    liaisons: [{ module: 'micro', broche: 'L/R', carte: 'GND' }],
  },
  {
    phrase: /GND\s*→\s*GND,\s*VCC\s*→\s*3V3/i,
    origine: 'commentaire de config.h : « GND → GND, VCC → 3V3 (jamais 5V) »',
    liaisons: [
      { module: 'ecran', broche: 'GND', carte: 'GND' },
      { module: 'ecran', broche: 'VCC', carte: '3V3', critique: true },
    ],
  },
];

/** Construit la référence de l'enceinte à partir du texte de config.h. */
export function referenceEnceinte(configH: string): ReferenceCablage {
  const defines = lireDefines(configH);
  const liaisons: LiaisonReference[] = [];
  const manquantes: string[] = [];
  for (const c of CONSTANTES_ENCEINTE) {
    const v = defines.get(c.constante);
    if (!v || !/^\d{1,2}$/.test(v)) {
      manquantes.push(c.constante);
      continue;
    }
    liaisons.push({ module: c.module, broche: c.broche, carte: v, origine: `${c.constante} = ${v}` });
  }
  for (const c of COMMENTAIRES_ENCEINTE) {
    if (!c.phrase.test(configH)) continue;
    for (const l of c.liaisons) liaisons.push({ ...l, origine: c.origine });
  }
  // L'écran n'est pas obligatoire (DISPLAY_ENABLED 0) : ses liaisons ne comptent alors pas.
  const avecEcran = defines.get('DISPLAY_ENABLED') !== '0';
  return {
    id: 'enceinte',
    nom: "l'enceinte Jarvis",
    carte: 'ESP32-S3',
    fichier: FICHIER_REFERENCE_ENCEINTE,
    modules: MODULES_ENCEINTE.filter((m) => avecEcran || m.id !== 'ecran'),
    liaisons: liaisons.filter((l) => avecEcran || l.module !== 'ecran'),
    manquantes,
  };
}

/** Références connues (le rover viendra ensuite). Rend l'identifiant, ou null. */
export function referenceDemandee(question: string): string | null {
  const t = sansAccents(question);
  if (/\b(?:enceinte|inmp441|max98357a?|micro de l|ampli de l|ecran de l)/.test(t)) return 'enceinte';
  return null;
}

/** La question demande-t-elle de vérifier un câblage ? */
export function questionCablage(question: string): boolean {
  const t = sansAccents(question);
  return /\b(?:cabl|branch|fil |fils|relie|brochage|connexion|connect)/.test(t);
}

// ------------------------------------------------------------------------------------------------
// Ce que voient les yeux
// ------------------------------------------------------------------------------------------------

export interface FilVu {
  couleur: string;
  /** Module d'un bout (texte libre des yeux) et sa broche lue. */
  module: string;
  broche: string;
  /** Broche de la carte principale à l'autre bout, telle que lue (« GPIO4 », « IO 4 », « 3.3V »…). */
  carte: string;
  /** Les yeux disent-ils l'avoir bien lu ? */
  sur: boolean;
}

export interface LectureCablage {
  description: string;
  fils: FilVu[];
  doutes: string[];
  brute: boolean;
}

/**
 * Consigne du modèle de vision pour un câblage. Elle nomme les modules à chercher, jamais les
 * broches attendues.
 */
export function consigneCablage(reference: ReferenceCablage): string {
  return [
    `Tu es les yeux de Jarvis. On te montre une photo d'un montage électronique : une carte ${reference.carte} reliée à des modules (${reference.modules.map((m) => m.nom).join(', ')}).`,
    "Ta tâche : recopier les fils que tu vois, un par un. Pour chaque fil : sa couleur, le module et le nom de la broche du module où il arrive (lu sur la sérigraphie), et le nom de la broche de la carte principale à l'autre bout (lu sur la sérigraphie : un numéro de GPIO, « 3V3 », « 5V », « GND »…).",
    'Réponds en français, en JSON seulement :',
    '{"description": "le montage en 2 phrases", "fils": [{"couleur": "la couleur du fil", "module": "le nom du module", "broche": "la broche lue sur le module", "carte": "la broche lue sur la carte principale", "sur": true}], "doutes": ["ce que tu ne vois pas bien"]}',
    "Règles : un fil dont tu ne vois pas un des deux bouts n'est pas dans la liste, il va dans doutes. « sur » est faux si tu as un doute sur une des deux broches. N'invente jamais une broche que tu ne lis pas ; « ? » si illisible.",
    'Si la photo est floue, sombre, ou si les fils se cachent, dis-le dans doutes.',
  ].join('\n');
}

export function demandeCablage(question: string): string {
  return `Question de l'utilisateur : ${question.trim()}`;
}

function texteDe(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

function premierObjet(texte: string): Record<string, unknown> | null {
  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  try {
    const v: unknown = JSON.parse(texte.slice(debut, fin + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function lireReponseCablage(brut: string): LectureCablage {
  const o = premierObjet(brut);
  if (!o) return { description: brut.replace(/```(?:json)?/g, '').trim().slice(0, 1500), fils: [], doutes: [], brute: true };
  const fils: FilVu[] = [];
  const liste = Array.isArray(o.fils) ? o.fils : Array.isArray(o.wires) ? o.wires : [];
  for (const f of liste.slice(0, 40)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const fil: FilVu = {
      couleur: texteDe(r.couleur ?? r.color),
      module: texteDe(r.module),
      broche: texteDe(r.broche ?? r.pin),
      carte: texteDe(r.carte ?? r.board ?? r.vers),
      sur: r.sur === true || r.sûr === true || r.sure === true,
    };
    if (fil.broche || fil.carte) fils.push(fil);
  }
  const doutes = Array.isArray(o.doutes) ? o.doutes.map(texteDe).filter(Boolean).slice(0, 20) : texteDe(o.doutes) ? [texteDe(o.doutes)] : [];
  return { description: texteDe(o.description).slice(0, 1500), fils, doutes, brute: false };
}

/** Normalise une broche de la carte : « GPIO04 », « IO4 », « G4 », « D4 » → « 4 » ; « 3.3V » → « 3V3 ». */
export function brocheCarte(texte: string): string {
  const t = sansAccents(texte).replace(/\s+/g, '');
  if (!t || /\?/.test(t)) return '?';
  if (/^(?:gnd|masse|ground|g)$/.test(t) || /^gnd\d?$/.test(t)) return 'GND';
  if (/^(?:3v3|3[.,]3v?|3\.3v|vcc3v3|\+3v3|\+3\.3v)$/.test(t)) return '3V3';
  if (/^(?:5v|\+5v|5v0|vbus|vusb)$/.test(t)) return '5V';
  const m = /^(?:gpio|io|g|d|p)?0*(\d{1,2})$/.exec(t);
  if (m) return m[1]!;
  return texte.trim().toUpperCase();
}

/** Synonymes des broches des modules (sérigraphies courantes). */
const SYNONYMES_BROCHES: Record<string, string> = {
  BCK: 'BCLK',
  BLCK: 'BCLK',
  LRCLK: 'LRC',
  LRCK: 'LRC',
  WSEL: 'WS',
  SDIN: 'DIN',
  DATA: 'DIN',
  VDD: 'VCC',
  VIN: 'VCC',
  LR: 'L/R',
  'L-R': 'L/R',
  SEL: 'L/R',
};

export function brocheModule(texte: string, module: string): string {
  const t = texte.trim().toUpperCase().replace(/\s+/g, '');
  const s = SYNONYMES_BROCHES[t] ?? t;
  // Sur l'ampli, « SD » est l'arrêt (shutdown), pas des données : ne pas le confondre avec le SD du micro.
  if (module === 'micro' && s === 'DOUT') return 'SD';
  if (module === 'ecran' && (s === 'SCK' || s === 'CLK')) return 'SCL';
  return s;
}

/** Le module de la référence désigné par le texte des yeux, s'il y en a un seul. */
export function moduleVu(texte: string, reference: ReferenceCablage, broche?: string): string | null {
  const t = sansAccents(texte);
  const trouves = reference.modules.filter((m) => m.mots.some((mot) => t.includes(mot)));
  if (trouves.length === 1) return trouves[0]!.id;
  if (trouves.length > 1) return null;
  // Sans nom de module, une broche propre à un seul module le désigne (« LRC » = l'ampli).
  if (broche) {
    const modules = new Set(reference.liaisons.filter((l) => brocheModule(broche, l.module) === l.broche).map((l) => l.module));
    if (modules.size === 1) return [...modules][0]!;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Comparaison
// ------------------------------------------------------------------------------------------------

export type EtatLiaison = 'conforme' | 'different' | 'incertain' | 'non-vu';

export interface ComparaisonLiaison {
  liaison: LiaisonReference;
  etat: EtatLiaison;
  /** Broche(s) de la carte vue(s) pour cette broche du module. */
  vu: string[];
}

export interface FilInconnu {
  fil: FilVu;
  raison: string;
}

export interface ComparaisonCablage {
  reference: ReferenceCablage;
  liaisons: ComparaisonLiaison[];
  inconnus: FilInconnu[];
  /** Deux broches de modules différentes sur la même broche GPIO (vu par les yeux). */
  conflits: string[];
}

/** Compare ce que les yeux ont vu à la référence. Aucun modèle : des règles. */
export function comparerCablage(reference: ReferenceCablage, fils: readonly FilVu[]): ComparaisonCablage {
  const parLiaison = new Map<LiaisonReference, { carte: string; sur: boolean }[]>();
  const inconnus: FilInconnu[] = [];
  for (const fil of fils) {
    const module = moduleVu(fil.module, reference, fil.broche);
    if (!module) {
      inconnus.push({ fil, raison: fil.module ? `module « ${fil.module} » non reconnu` : 'module non dit' });
      continue;
    }
    const broche = brocheModule(fil.broche, module);
    const liaison = reference.liaisons.find((l) => l.module === module && l.broche === broche);
    if (!liaison) {
      inconnus.push({ fil, raison: `broche « ${fil.broche || '?'} » absente de la référence pour ce module` });
      continue;
    }
    const vus = parLiaison.get(liaison) ?? [];
    vus.push({ carte: brocheCarte(fil.carte), sur: fil.sur });
    parLiaison.set(liaison, vus);
  }
  const liaisons: ComparaisonLiaison[] = reference.liaisons.map((liaison) => {
    const vus = parLiaison.get(liaison) ?? [];
    const cartes = [...new Set(vus.map((v) => v.carte))];
    let etat: EtatLiaison;
    if (!vus.length) etat = 'non-vu';
    else if (cartes.some((c) => c !== liaison.carte && c !== '?')) etat = 'different';
    else if (cartes.includes('?') || vus.some((v) => !v.sur)) etat = 'incertain';
    else etat = 'conforme';
    return { liaison, etat, vu: cartes };
  });
  // Deux broches de modules sur le même GPIO vu : signe d'une erreur (ou d'une lecture fausse).
  const parGpio = new Map<string, string[]>();
  for (const c of liaisons) {
    for (const v of c.vu) {
      if (!/^\d+$/.test(v)) continue;
      const l = parGpio.get(v) ?? [];
      l.push(`${nomModule(reference, c.liaison.module)} ${c.liaison.broche}`);
      parGpio.set(v, l);
    }
  }
  const conflits = [...parGpio].filter(([, l]) => l.length > 1).map(([g, l]) => `GPIO ${g} : ${l.join(' et ')}`);
  return { reference, liaisons, inconnus, conflits };
}

function nomModule(reference: ReferenceCablage, id: string): string {
  return reference.modules.find((m) => m.id === id)?.nom ?? id;
}

function carteLisible(carte: string): string {
  return /^\d+$/.test(carte) ? `GPIO ${carte}` : carte;
}

/** Ce qu'il faut mesurer, au multimètre, carte hors tension d'abord. */
export function aMesurer(c: ComparaisonCablage): string[] {
  const out: string[] = [];
  const aVerifier = c.liaisons.filter((l) => l.etat !== 'conforme');
  for (const l of aVerifier) {
    out.push(
      `Continuité (hors tension) entre ${nomModule(c.reference, l.liaison.module)} ${l.liaison.broche} et ${carteLisible(l.liaison.carte)} de la ${c.reference.carte}.`,
    );
  }
  for (const l of c.reference.liaisons.filter((x) => x.critique)) {
    out.push(
      `Sous tension, avant de brancher le module si possible : ${l.carte} mesuré entre ${nomModule(c.reference, l.module)} ${l.broche} et GND (attendu : ${l.carte === '3V3' ? 'environ 3,3 V, jamais 5 V' : l.carte}).`,
    );
  }
  if (!out.length) out.push('Un contrôle de continuité de chaque fil (hors tension) reste la seule vraie preuve.');
  return out.slice(0, 12);
}

export const RAPPEL_CABLAGE =
  "Je ne valide jamais un câblage sur une photo : avant de mettre sous tension, vérifie toi-même au multimètre. Une photo peut tromper, et moi aussi.";

/**
 * La réponse, assemblée sans modèle : ce qui diffère d'abord, puis ce qui est incertain, ce qui n'est
 * pas vu, ce qui correspond, et ce qu'il faut mesurer. Jamais « ton câblage est bon ».
 */
export function reponseCablage(input: {
  comparaison: ComparaisonCablage;
  lecture: LectureCablage;
  modeleVision: string;
  oral: boolean;
}): string {
  const c = input.comparaison;
  const ref = c.reference;
  const nb = (e: EtatLiaison) => c.liaisons.filter((l) => l.etat === e);
  const differents = nb('different');
  const incertains = nb('incertain');
  const nonVus = nb('non-vu');
  const conformes = nb('conforme');
  const ligne = (l: ComparaisonLiaison) =>
    `${nomModule(ref, l.liaison.module)} ${l.liaison.broche} : attendu ${carteLisible(l.liaison.carte)}` +
    (l.vu.length ? `, je vois ${l.vu.map((v) => (v === '?' ? 'une broche illisible' : carteLisible(v))).join(' ou ')}` : '') +
    ` (${l.liaison.origine})`;

  if (input.oral) {
    const phrases: string[] = [];
    if (!input.lecture.fils.length) phrases.push("Je n'arrive pas à suivre les fils sur cette photo.");
    else if (differents.length)
      phrases.push(
        `Je vois ${differents.length} différence${differents.length > 1 ? 's' : ''} avec la référence de ${ref.nom}, par exemple ${nomModule(ref, differents[0]!.liaison.module)} ${differents[0]!.liaison.broche}.`,
      );
    else phrases.push(`Je ne vois pas de différence sur ${conformes.length} liaison${conformes.length > 1 ? 's' : ''} sur ${c.liaisons.length}, mais je n'ai pas tout vu.`);
    phrases.push('Le détail est sur le PC.');
    phrases.push(RAPPEL_CABLAGE);
    return phrases.join(' ');
  }

  const parties: string[] = [];
  parties.push(
    `Je compare ta photo au câblage de ${ref.nom} (\`${ref.fichier}\`, ${c.liaisons.length} liaisons). ${
      input.lecture.fils.length
        ? `Les yeux ont suivi ${input.lecture.fils.length} fil${input.lecture.fils.length > 1 ? 's' : ''}.`
        : "Les yeux n'ont suivi aucun fil sur cette photo : je ne peux rien comparer."
    }`,
  );
  if (input.lecture.description) parties.push(`Sur la photo : ${input.lecture.description}`);
  if (c.conflits.length) parties.push(`**Deux broches sur le même GPIO** (à vérifier en premier) :\n${c.conflits.map((x) => `- ${x}`).join('\n')}`);
  if (differents.length) parties.push(`**Différent de la référence :**\n${differents.map((l) => `- ${ligne(l)}`).join('\n')}`);
  if (incertains.length) parties.push(`**Pas sûr de ce que je lis :**\n${incertains.map((l) => `- ${ligne(l)}`).join('\n')}`);
  if (nonVus.length) parties.push(`**Pas vu sur la photo :**\n${nonVus.map((l) => `- ${ligne(l)}`).join('\n')}`);
  if (conformes.length)
    parties.push(
      `**Ce que je vois correspond à la référence** (lecture des yeux, pas une preuve) :\n${conformes.map((l) => `- ${ligne(l)}`).join('\n')}`,
    );
  if (c.inconnus.length)
    parties.push(
      `**Fils que je ne sais pas rattacher :**\n${c.inconnus
        .slice(0, 8)
        .map((i) => `- ${[i.fil.couleur, i.fil.module, i.fil.broche].filter(Boolean).join(' ')} → ${i.fil.carte || '?'} (${i.raison})`)
        .join('\n')}`,
    );
  if (ref.manquantes.length) parties.push(`La référence n'a pas trouvé dans \`${ref.fichier}\` : ${ref.manquantes.join(', ')}.`);
  parties.push(`**À mesurer :**\n${aMesurer(c).map((x) => `- ${x}`).join('\n')}`);
  const doutes = [...input.lecture.doutes];
  if (input.lecture.brute) doutes.push("les yeux n'ont pas rendu la liste des fils demandée");
  if (doutes.length) parties.push(`Doutes des yeux : ${doutes.join(' ; ')}.`);
  parties.push(RAPPEL_CABLAGE);
  parties.push(`_Vu par ${input.modeleVision} ; une photo peut tromper._`);
  return parties.join('\n\n');
}
