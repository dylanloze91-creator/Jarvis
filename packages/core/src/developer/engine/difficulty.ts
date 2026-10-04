import { fallbackFactory } from './fallbacks.js';
import type { RealBenchResult } from './realBench.js';
import type { MissionKind } from './router.js';
import { PROJECT_TEMPLATES, type ProjectTemplateId } from './templates.js';

/**
 * Difficulté d'une mission, estimée avant de la lancer (5.0.1), et capacité du
 * modèle CODER choisi : score CODER du banc réel, sinon sa taille. Des règles
 * fixes, sans modèle : une mission trop grande pour le modèle n'est pas
 * lancée, Jarvis le dit et propose une version ciblée.
 */
export type DifficultyLevel = 1 | 2 | 3;

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  1: 'changement ciblé (une règle, une valeur, une commande)',
  2: 'fonction nouvelle (un ou quelques fichiers à écrire)',
  3: 'programme entier (tout un jeu ou une application à écrire)',
};

/** Ce que le modèle tient au plus ; 0 : aucune tâche de code. */
export const CAPABILITY_LABELS: Record<0 | DifficultyLevel, string> = {
  0: 'aucune tâche de code',
  1: 'des changements ciblés',
  2: 'des fonctions nouvelles',
  3: 'des programmes entiers',
};

/** Missions qui écrivent du code : les seules soumises au contrôle de difficulté. */
export const GATED_MISSION_KINDS: readonly MissionKind[] = [
  'modify',
  'fix',
  'new-project',
  'skill',
];

export interface DifficultyEstimate {
  level: DifficultyLevel;
  /** Gabarit prévu pour un nouveau projet (règles fixes, avant l'ARCHITECTE). */
  template: ProjectTemplateId | null;
  /** Demandes distinctes, hors de ce que le gabarit fait déjà. */
  items: string[];
  reasons: string[];
}

export interface ModelCapability {
  model: string;
  level: 0 | DifficultyLevel;
  source: 'banc' | 'taille' | 'inconnue';
  /** Tâches CODER réussies et mesurées au banc réel. */
  coder: { passed: number; measured: number } | null;
  /** Milliards de paramètres, lus dans Ollama ou dans le nom du modèle. */
  paramsB: number | null;
  detail: string;
}

export interface MissionGate {
  ok: boolean;
  kind: MissionKind;
  request: string;
  difficulty: DifficultyEstimate;
  capability: ModelCapability;
  message: string;
  /** Demande plus petite que le modèle peut tenir, à lancer en un clic. */
  suggestion: string | null;
}

/** Mots entiers, accents compris (`\b` de JavaScript ignore « é »). */
function words(pattern: string, flags = 'i'): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, `${flags}u`);
}

const GAME = words(
  String.raw`jeu|jeux|game|pong|snake|tetris|casse[- ]briques?|breakout|morpion|tic[- ]tac[- ]toe|flappy|space invaders|labyrinthe|platformer|plateforme|asteroids?|échecs|dames|démineur|sudoku|pac-?man|course`,
);
/** Jeu fourni prêt par le gabarit `web-game`. */
const TEMPLATE_GAME = words('pong');
const OTHER_GAME = words(
  String.raw`snake|tetris|casse[- ]briques?|breakout|morpion|tic[- ]tac[- ]toe|flappy|space invaders|labyrinthe|platformer|plateforme|asteroids?|échecs|dames|démineur|sudoku|pac-?man|course`,
);
const WHOLE = words(
  String.raw`complet|complète|complets|complètes|entier|entière|tout un|toute une|de zéro|de a à z|from scratch|clone`,
);
const REWRITE = words(
  String.raw`réécris|reecris|refais|refonds|refonte|migre|convertis|toute l['’]application|tout le projet|toute l['’]architecture`,
);
const FEATURE = new RegExp(
  `${words('ajoute|crée|creer|créer|écris|ecris').source}.*${words('mode|écran|ecran|page|menu|fonctionnalité|fonction|système|systeme|module|onglet|formulaire|tableau de bord').source}`,
  'iu',
);
const HEAVY: Array<[RegExp, string]> = [
  [
    words(String.raw`multijoueurs? en ligne|en ligne|réseau|serveur|websocket`),
    'réseau ou jeu en ligne',
  ],
  [words(String.raw`base de données|sql|sqlite`), 'base de données'],
  [
    words(String.raw`authentification|comptes? utilisateurs?|mot de passe|inscription`),
    'comptes et connexion',
  ],
  [
    words(
      String.raw`intelligence artificielle|adversaire (automatique|ordinateur)|contre l['’]ordinateur|ia`,
    ),
    'adversaire automatique',
  ],
  [words(String.raw`niveaux|plusieurs niveaux|levels?`), 'plusieurs niveaux'],
  [
    words(String.raw`sauvegarde|sauvegarder|meilleurs scores|classement`),
    'sauvegarde ou classement',
  ],
  [words(String.raw`musique|bruitages?|sons?|audio`), 'sons'],
  [words(String.raw`menus?|écran d['’]accueil|écran titre|écran de titre`), 'menus'],
  [words(String.raw`en 3d|jeu 3d|moteur 3d|three\.js|webgl`), '3D'],
  [words(String.raw`graphiques?|statistiques`), 'graphiques'],
  [words(String.raw`éditeur|editeur`), 'éditeur'],
];
/** Ce que chaque gabarit fait déjà : ces mots ne comptent pas comme des demandes. */
const COVERED: Partial<Record<ProjectTemplateId, RegExp>> = {
  'web-game': words(
    String.raw`pong|jeu|jouable|navigateur|raquettes?|balles?|score|scores|points?|clavier|touches|w\/s|z\/s|flèches|fleches|deux joueurs|2 joueurs|canvas|gauche|droite|haut|bas`,
    'gi',
  ),
};
const FILLER = words(
  String.raw`crée|créer|creer|cree|fais|fabrique|génère|genere|écris|ecris|moi|un|une|le|la|les|des|de|du|pour|dans|avec|et|à|a|au|aux|en|qui|que|petit|petite|simple|nouveau|nouvelle|projet|application|appli|programme|outil|deux|trois|quatre`,
  'gi',
);

function clean(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Demandes distinctes : virgules, points-virgules, lignes, « et », « puis », « avec ». */
function splitItems(request: string, template: ProjectTemplateId | null): string[] {
  const covered = template ? COVERED[template] : undefined;
  return clean(request.replace(/\([^)]*\)/g, ' '))
    .split(/[,;:\n•]|\s(?:et|puis|ainsi que|avec|plus)\s/i)
    .map((part) => clean(part))
    .filter((part) => {
      let rest = part.replace(FILLER, ' ');
      if (covered) rest = rest.replace(covered, ' ');
      return rest.replace(/[^\p{L}\p{N}]+/gu, '').length >= 3;
    });
}

/** Champs ajoutés par Jarvis à une mission née d'une proposition : ils ne sont pas des demandes. */
const PROPOSAL_FIELDS = /\s(?:Preuves|Gain attendu|Risque|Tests de preuve)\s*:/;

export function estimateDifficulty(kind: MissionKind, request: string): DifficultyEstimate {
  const text = clean(request).split(PROPOSAL_FIELDS)[0]!;
  const creates = kind === 'new-project' || kind === 'skill';
  const template: ProjectTemplateId | null =
    kind === 'new-project'
      ? fallbackFactory(text).template
      : kind === 'skill'
        ? 'node-skill'
        : null;
  const reasons: string[] = [];
  let level: DifficultyLevel = 1;
  let covered = false;
  if (kind === 'new-project' && template === 'web-game') {
    const other = OTHER_GAME.exec(text)?.[0];
    if (other && !TEMPLATE_GAME.test(text)) {
      level = 3;
      reasons.push(
        `le gabarit jeu est un Pong jouable : « ${other} » est un autre jeu entier à écrire`,
      );
    } else if (!TEMPLATE_GAME.test(text) && !GAME.test(text)) {
      level = 2;
    } else {
      covered = true;
      reasons.push('le gabarit jeu est déjà un Pong jouable');
    }
  } else if (creates) {
    level = 2;
    reasons.push(
      `le gabarit « ${PROJECT_TEMPLATES[template!].label} » fonctionne déjà, mais la logique demandée est à écrire`,
    );
  } else if (REWRITE.test(text)) {
    level = 3;
    reasons.push('réécriture ou refonte d’une grande partie du projet');
  } else if (FEATURE.test(text)) {
    level = 2;
    reasons.push('une fonction nouvelle à écrire');
  }
  if (!covered && WHOLE.test(text) && level < 3) {
    level = 3;
    reasons.push('demandé « complet » : tout est à écrire');
  }
  const heavy = HEAVY.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  if (heavy.length) {
    level = Math.min(3, level + (heavy.length >= 2 ? 2 : 1)) as DifficultyLevel;
    reasons.push(`fonctions lourdes : ${heavy.join(', ')}`);
  }
  const items = splitItems(text, template);
  if (items.length >= 5) {
    level = 3;
    reasons.push(`${items.length} demandes distinctes`);
  } else if (items.length >= 3 && level < 3) {
    level = (level + 1) as DifficultyLevel;
    reasons.push(`${items.length} demandes distinctes`);
  }
  if (text.length > 500 && level < 3) {
    level = (level + 1) as DifficultyLevel;
    reasons.push('demande très longue');
  }
  if (!reasons.length) reasons.push('une seule demande, courte');
  return { level, template, items, reasons };
}

/** Milliards de paramètres : `parameterSize` d'Ollama (« 3.1B », « 494M »), sinon le nom (« qwen2.5:3b »). */
export function modelParamsB(model: string, parameterSize?: string | null): number | null {
  const size = /^\s*(\d+(?:\.\d+)?)\s*([BM])\s*$/i.exec(parameterSize ?? '');
  if (size) return Number(size[1]) / (size[2]!.toUpperCase() === 'M' ? 1_000 : 1);
  const name = /[:\-_](\d+(?:\.\d+)?)b\b/i.exec(model);
  return name ? Number(name[1]) : null;
}

/**
 * Capacité du modèle CODER : son score CODER au banc réel (3 tâches : plan,
 * correction, génération), plafonné par sa taille (moins de 7 milliards de
 * paramètres : jamais un programme entier). Sans banc, la taille seule est une
 * estimation grossière : elle ne refuse que l'évident (un programme entier
 * sous 14 milliards de paramètres, tout ce qui dépasse un changement ciblé
 * sous 2 milliards).
 */
export function modelCapability(
  model: string,
  bench: RealBenchResult | undefined,
  parameterSize?: string | null,
): ModelCapability {
  const paramsB = modelParamsB(model, parameterSize);
  const sizeText = paramsB !== null ? `${paramsB} milliards de paramètres` : 'taille inconnue';
  const coder = bench?.roles.find((r) => r.role === 'CODER');
  if (coder && coder.measured > 0) {
    const ratio = coder.passed / coder.measured;
    const measured: 0 | DifficultyLevel = ratio >= 0.99 ? 3 : ratio >= 0.6 ? 2 : ratio > 0 ? 1 : 0;
    const capped = paramsB !== null && paramsB < 7 && measured > 2;
    const level = capped ? 2 : measured;
    return {
      model,
      level,
      source: 'banc',
      coder: { passed: coder.passed, measured: coder.measured },
      paramsB,
      detail: `banc réel CODER ${coder.passed}/${coder.measured}${capped ? `, plafonné par la taille (${sizeText})` : ''}`,
    };
  }
  if (paramsB === null)
    return {
      model,
      level: 2,
      source: 'inconnue',
      coder: null,
      paramsB,
      detail:
        'ni banc réel ni taille connue : seul un programme entier est refusé ; lance le banc réel pour une mesure',
    };
  return {
    model,
    level: paramsB < 2 ? 1 : paramsB < 14 ? 2 : 3,
    source: 'taille',
    coder: null,
    paramsB,
    detail: `pas encore de banc réel : estimation grossière par la taille (${sizeText}) ; lance le banc réel pour une mesure`,
  };
}

/** Verdict du banc réel pour le rôle CODER, en une phrase. */
export function coderVerdict(capability: ModelCapability): string {
  if (capability.level === 0) return 'pas apte au rôle CODER (aucune tâche de code réussie)';
  return `apte au rôle CODER pour ${CAPABILITY_LABELS[capability.level]}`;
}

const TARGETED_EXAMPLES: Partial<Record<ProjectTemplateId, string>> = {
  'web-game':
    'Crée un Pong jouable dans le navigateur et change une seule règle : la balle accélère un peu à chaque renvoi de raquette.',
  'node-cli':
    'Crée un outil en ligne de commande (le gabarit répond déjà à --name et --help) et ajoute une seule option : --majuscules.',
  'vite-react':
    'Crée une application web (le gabarit a déjà un compteur) et ajoute un seul bouton : remettre le compteur à zéro.',
  'ts-lib':
    'Crée une bibliothèque TypeScript (le gabarit a déjà slugify) et ajoute une seule fonction : capitalize.',
};

function suggest(
  kind: MissionKind,
  request: string,
  difficulty: DifficultyEstimate,
  capability: ModelCapability,
): string | null {
  if (capability.level === 0) return null;
  const first = clean(request).split(/[,;:\n]|\s(?:et|puis|ainsi que|avec)\s/i)[0] ?? '';
  if (first && first.length < clean(request).length) {
    const smaller = estimateDifficulty(kind, first);
    if (smaller.level <= capability.level && smaller.template === difficulty.template)
      return `${clean(first).replace(/[.!]+$/, '')}.`;
  }
  if (kind === 'new-project' && difficulty.template) {
    const example = TARGETED_EXAMPLES[difficulty.template];
    if (example) return example;
  }
  return null;
}

/** Contrôle avant une mission qui écrit du code : la difficulté estimée face à la capacité du modèle. */
export function assessMission(
  kind: MissionKind,
  request: string,
  capability: ModelCapability,
): MissionGate {
  const difficulty = estimateDifficulty(kind, request);
  const ok = capability.level >= difficulty.level;
  const why = difficulty.reasons.join(' ; ');
  const base = { ok, kind, request: clean(request), difficulty, capability };
  if (ok)
    return {
      ...base,
      message: `Difficulté estimée : ${DIFFICULTY_LABELS[difficulty.level]} (${why}). ${capability.model} tient ${CAPABILITY_LABELS[capability.level]} (${capability.detail}).`,
      suggestion: null,
    };
  const suggestion = suggest(kind, request, difficulty, capability);
  const message =
    capability.level === 0
      ? `Mission non lancée : ${capability.model} n’a réussi aucune tâche de code au banc réel (${capability.detail}). Choisis un autre modèle pour le rôle Codeur (onglet Modèle de code).`
      : `Mission non lancée : trop grande pour ${capability.model}. Difficulté estimée : ${DIFFICULTY_LABELS[difficulty.level]} (${why}). Ce modèle tient au plus ${CAPABILITY_LABELS[capability.level]} (${capability.detail}). Un essai finirait en échec après de longues minutes.${suggestion ? ' Version ciblée proposée ci-dessous.' : ' Découpe la demande : une règle ou une fonction à la fois.'}`;
  return { ...base, message, suggestion };
}
