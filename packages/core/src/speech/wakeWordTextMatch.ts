/**
 * Comparaison texte du mot de réveil, utilisée par le moteur de mot de
 * réveil « par transcription » (`WhisperWakeWordEngine`, côté
 * `apps/desktop`) : Whisper transcrit une courte fenêtre audio, et ce module
 * décide si le texte obtenu contient le mot de réveil. Aucune dépendance au
 * DOM ni à un modèle réel — uniquement des chaînes de caractères — pour
 * rester testable sans microphone ni téléchargement de modèle.
 *
 * Deux passes, volontairement asymétriques :
 * 1. sous-chaîne exacte contre le mot canonique, ses variantes intégrées
 *    (erreurs de transcription connues, ex. « djarvis », « jarvice ») et les
 *    variantes fournies par l'utilisateur — déterministe, sans risque de
 *    faux positif inattendu puisque chaque entrée est un cas observé ou
 *    explicitement choisi ;
 * 2. distance de Levenshtein, mot à mot, mais seulement contre le mot
 *    canonique et les variantes utilisateur — jamais contre la liste
 *    intégrée. Appliquer le flou aussi à cette liste a été essayé puis
 *    abandonné : vérifié contre le dictionnaire français `hunspell-fr`
 *    (~81 000 mots), cela produisait 144 collisions (« paris », « avis »,
 *    « la vis », « davis »…). Restreindre le flou au seul mot canonique,
 *    avec un seuil resserré selon sa longueur, ramène ce nombre à une seule
 *    collision documentée (« parvis », à distance 1 de « jarvis ») — un
 *    compromis assumé, pas maquillé : voir le README pour ce choix.
 */

const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC_REGEX = /[^a-z0-9\s]/g;
const WHITESPACE_REGEX = /\s+/g;

/** Minuscules, sans accents, sans ponctuation, espaces normalisés. */
export function normalizeForWakeWordMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_REGEX, ' ')
    .replace(WHITESPACE_REGEX, ' ')
    .trim();
}

/** Distance d'édition classique (insertion/suppression/substitution), pour des mots courts. */
export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  return matrix[a.length]![b.length]!;
}

/**
 * Variantes orthographiques intégrées pour les mots de réveil connus, issues
 * d'erreurs de transcription Whisper observées en pratique sur « Jarvis ».
 * Utilisées uniquement en sous-chaîne exacte (jamais en flou, voir
 * l'en-tête du fichier) — cette table n'est qu'un point de départ :
 * `matchesWakeWord` accepte en plus une liste `variants` fournie par
 * l'appelant (réglages utilisateur), pour rester extensible sans toucher au
 * code.
 */
const BUILT_IN_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  jarvis: ['jarvis', 'jarviss', 'jarvice', 'jarvi', 'djarvis', 'jarvys', 'jarvisse', 'charvis'],
};

/** Variantes connues d'un mot de réveil, normalisées, mot lui-même inclus. */
export function defaultWakeWordVariants(word: string): string[] {
  const normalized = normalizeForWakeWordMatch(word);
  const builtIn = BUILT_IN_VARIANTS[normalized] ?? [];
  return Array.from(new Set([normalized, ...builtIn.map(normalizeForWakeWordMatch)])).filter(
    (variant) => variant.length > 0,
  );
}

/**
 * Distance maximale tolérée en flou (mot à mot), en fonction de la longueur
 * du mot comparé. Volontairement strict — voir l'en-tête du fichier pour la
 * mesure qui justifie ces seuils : un mot très court tolère 0 erreur (sinon
 * presque tout correspondrait), un mot de longueur moyenne 1 seule.
 */
function defaultMaxDistance(wordLength: number): number {
  if (wordLength <= 5) return 0;
  if (wordLength <= 8) return 1;
  return 2;
}

export interface WakeWordTextMatchConfig {
  /** Mot de réveil canonique (ex. "jarvis"). */
  word: string;
  /**
   * Variantes supplémentaires, en plus des variantes intégrées de `word`.
   * Comparées à la fois en sous-chaîne exacte et en flou (contrairement aux
   * variantes intégrées, qui ne le sont qu'en sous-chaîne exacte) :
   * l'utilisateur qui les ajoute explicitement en accepte le risque.
   */
  variants?: string[];
  /** Distance de Levenshtein maximale tolérée, en fonction de la longueur du mot comparé. */
  maxDistance?: (wordLength: number) => number;
}

/**
 * Vrai si `transcript` contient le mot de réveil décrit par `config`, avec
 * tolérance orthographique. Voir l'en-tête du fichier pour le détail des
 * deux passes et pourquoi elles ne portent pas sur les mêmes listes.
 */
export function matchesWakeWord(transcript: string, config: WakeWordTextMatchConfig): boolean {
  const normalizedTranscript = normalizeForWakeWordMatch(transcript);
  if (!normalizedTranscript) return false;

  const canonical = normalizeForWakeWordMatch(config.word);
  const userVariants = (config.variants ?? []).map(normalizeForWakeWordMatch).filter(Boolean);

  const exactCandidates = Array.from(new Set([...defaultWakeWordVariants(config.word), ...userVariants]));
  if (exactCandidates.some((candidate) => normalizedTranscript.includes(candidate))) return true;
  if (!canonical) return false;

  const fuzzyCandidates = Array.from(new Set([canonical, ...userVariants])).filter(
    (candidate) => candidate.length > 0,
  );
  const maxDistance = config.maxDistance ?? defaultMaxDistance;
  const transcriptWords = normalizedTranscript.split(' ');
  return transcriptWords.some((word) =>
    fuzzyCandidates.some((candidate) => levenshteinDistance(word, candidate) <= maxDistance(candidate.length)),
  );
}
