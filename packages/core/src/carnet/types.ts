/**
 * Carnet des ratés — format version 1.
 * Le détail des champs est dans `FORMAT.md`, à côté de ce fichier.
 * Aucun modèle ne décide qu'un tour est raté : seulement les règles de `detect.ts`.
 */

export const CARNET_FORMAT_VERSION = 1 as const;

export const RATE_KINDS = [
  'correction',
  'repetition',
  'interruption',
  'outil_echec',
  'lenteur',
  'chemin',
  'signale',
] as const;
export type RateKind = (typeof RATE_KINDS)[number];

/** Catégories choisies par l'utilisateur pendant la revue. */
export const RATE_CATEGORIES = ['regle', 'bogue', 'modele', 'materiel', 'pas-grave'] as const;
export type RateCategory = (typeof RATE_CATEGORIES)[number];

export const RATE_CATEGORY_LABELS: Record<RateCategory, string> = {
  regle: 'Une règle à ajouter',
  bogue: 'Un bogue',
  modele: 'Le modèle se trompe',
  materiel: 'Matériel ou réseau',
  'pas-grave': 'Pas grave',
};

export type CarnetEdition = 'live' | 'test';

export type CarnetPlace =
  { kind: 'fenetre' } | { kind: 'enceinte'; name: string } | { kind: 'telephone' };

export type CarnetHow =
  'calcul' | 'express' | 'cerveau' | 'trieur' | 'chemin-avant' | 'mission-directe' | 'direct';

/** Une ligne d'outil, telle que le carnet la voit. Pas de secret : le fichier passe ensuite par `redactSecrets`. */
export interface ToolLine {
  name: string;
  status: 'ok' | 'error' | 'denied';
  /** Une ligne : phrase française ou code d'issue (`timeout`, `verification_failed`). */
  line: string;
  outcome?: string;
}

export interface PreviousTurn {
  at: number;
  userText: string;
  replyText: string;
  team: string | null;
  model: string | null;
  how: CarnetHow | null;
  tools: ToolLine[];
  durations: Record<string, number>;
}

/**
 * Ce qu'un tour a laissé voir. Le carnet ne lit que ça :
 * il ne voit ni le prompt, ni la requête envoyée au modèle.
 */
export interface ObservedTurn {
  at: number;
  conversationId: string;
  edition: CarnetEdition;
  place: CarnetPlace;
  userText: string;
  replyText: string;
  team: string | null;
  model: string | null;
  how: CarnetHow | null;
  /** Le cerveau a écrit une réponse illisible et le tour a repris le chemin d'avant. */
  brainUnreadable: boolean;
  tools: ToolLine[];
  durations: Record<string, number>;
  /** Fenêtre ou téléphone : millisecondes jusqu'au premier mot. `null` si aucun mot. */
  firstWordMs: number | null;
  /** Enceinte : millisecondes entre la fin de la phrase et le premier son. */
  speakerFirstSoundMs: number | null;
  /**
   * L'utilisateur a coupé la réponse.
   * `afterMs` : depuis le début de la réponse.
   */
  cut: {
    afterMs: number;
    button?: boolean;
    /** Parole pendant que Jarvis parlait. */
    speech?: boolean;
    text?: string;
  } | null;
  previous: PreviousTurn | null;
  /** Clic 👎 sous cette réponse. */
  thumbDown?: boolean;
}

export interface RateDetection {
  type: RateKind;
  /** Identifiant stable de la règle, pas une phrase libre. */
  rule: string;
  userText: string;
  replyText: string;
  team: string | null;
  model: string | null;
  how: CarnetHow | null;
  tools: ToolLine[];
  durations: Record<string, number>;
}

/** Une ligne de `userData/carnet/rates.jsonl`. Jamais dans le dépôt. */
export interface RateEntry {
  version: typeof CARNET_FORMAT_VERSION;
  id: string;
  /** Date ISO 8601. */
  date: string;
  edition: CarnetEdition;
  source: CarnetPlace;
  type: RateKind;
  rule: string;
  userText: string;
  /** Début de la réponse de Jarvis, 300 caractères au plus. */
  replyStart: string;
  team: string | null;
  model: string | null;
  how: CarnetHow | null;
  tools: Array<{ name: string; result: string }>;
  durations: Record<string, number>;
  conversationId: string;
  /** Vrai dès que l'utilisateur a classé l'entrée ou écrit ce qu'il attendait. */
  reviewed: boolean;
  expected?: string;
  category?: RateCategory;
}

/** Compteur des fausses alertes, par règle. L'entrée elle-même est retirée. */
export interface FalseAlarmLedger {
  version: typeof CARNET_FORMAT_VERSION;
  counts: Record<string, number>;
}

/**
 * Réglages du carnet. Fichier à part (`userData/carnet/reglages.json`),
 * jamais une clé de `parseSettings`.
 */
export interface CarnetSettingsFile {
  version: typeof CARNET_FORMAT_VERSION;
  enabled: boolean;
  fenetrePremierMotMs: number;
  enceintePremierSonMs: number;
}

export const DEFAULT_REPETITION_WINDOW_MS = 3 * 60 * 1000;
export const DEFAULT_REPETITION_OVERLAP = 0.7;
export const DEFAULT_INTERRUPTION_WINDOW_MS = 5_000;
export const DEFAULT_WINDOW_FIRST_WORD_MS = 10_000;
export const DEFAULT_SPEAKER_FIRST_SOUND_MS = 6_000;
export const REPLY_START_MAX = 300;
export const RATES_CAP = 5_000;

export const NOTED_REPLY = "C'est noté.";
