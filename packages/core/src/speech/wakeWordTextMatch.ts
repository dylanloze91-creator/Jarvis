/**
 * Comparaison texte du mot de réveil, utilisée par la confirmation Whisper
 * du déclencheur « Jarvis » nu : Whisper transcrit une courte fenêtre audio,
 * et ce module décide si le texte obtenu contient le mot de réveil. Aucune dépendance au
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

/**
 * Phrases que Whisper invente sur du bruit, un mixage saturé ou un clip
 * trop court. Ce ne sont pas les mots de l'utilisateur : ni confirmation
 * de « Jarvis », ni commande à envoyer.
 */
const WHISPER_HALLUCINATION =
  /^(?:you|thank you|thanks for watching\b.*|please subscribe\b.*|sous titres\b.*|sous titrage\b.*|merci d avoir regarde\b.*|je vous invite a vous\b.*|m)$|amara org/;

/**
 * Queue silencieuse : Whisper renvoie « ... » ou « … » quand le clip se
 * termine par du silence. Ce n'est pas une parole.
 */
function isEllipsisOnly(text: string): boolean {
  return /^(?:[\s.…]|\u2026)+$/u.test(text);
}

export function isWhisperHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isEllipsisOnly(trimmed)) return true;
  const normalized = normalizeForWakeWordMatch(trimmed);
  if (!normalized) return true;
  return WHISPER_HALLUCINATION.test(normalized);
}

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
/**
 * Graphies de « Jarvis » observées sur la prise GoXLR
 * (« Jarvis, quelle heure est-il ? », sans « hey »). Whisper français
 * réécrit le prénom : « J'invise », « J'ai un vis », « J'en vis », avec ou
 * sans point d'interrogation. La casse et l'apostrophe disparaissent à la
 * normalisation. Ce sont des suites de mots entiers, pas un préfixe :
 * « j'envisage » ne doit pas compter.
 */
const JARVIS_WORD_SEQUENCES: readonly (readonly string[])[] = [
  ['j', 'invise'],
  ['jinvise'],
  ['j', 'ai', 'un', 'vis'],
  ['jai', 'un', 'vis'],
  ['j', 'en', 'vis'],
  ['jen', 'vis'],
  ['jenvis'],
  ['jaiunvis'],
];

function containsWordSequence(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > words.length) return false;
  for (let start = 0; start <= words.length - phrase.length; start += 1) {
    if (phrase.every((part, index) => words[start + index] === part)) return true;
  }
  return false;
}

const BUILT_IN_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  // "javice" : observé sur un enregistrement réel (voir test-fixtures/), à distance 3 de
  // "jarvis" — trop loin pour la tolérance floue par défaut, ajouté explicitement ici.
  jarvis: [
    'jarvis',
    'jarviss',
    'jarvice',
    'jarvi',
    'djarvis',
    'jarvys',
    'jarvisse',
    'charvis',
    'javice',
    // Hallucinations Whisper fréquentes en français (« j'avise », « j'avis »).
    'javise',
    'javis',
    'jarvise',
    'djervis',
    'djarvice',
    'charvisse',
    'yarvis',
    'jarvie',
  ],
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

  const words = normalizedTranscript.split(' ');
  if (canonical === 'jarvis' && JARVIS_WORD_SEQUENCES.some((phrase) => containsWordSequence(words, phrase))) {
    return true;
  }

  const exactCandidates = Array.from(
    new Set([...defaultWakeWordVariants(config.word), ...userVariants]),
  );
  if (exactCandidates.some((candidate) => normalizedTranscript.includes(candidate))) return true;
  // « j'avise », « jar vis » : une fois les espaces retirés, ça recouvre
  // les variantes collées que Whisper coupe souvent en deux mots français.
  const tightTranscript = normalizedTranscript.replace(/\s+/g, '');
  if (
    exactCandidates.some((candidate) => tightTranscript.includes(candidate.replace(/\s+/g, '')))
  ) {
    return true;
  }
  if (!canonical) return false;

  const fuzzyCandidates = Array.from(new Set([canonical, ...userVariants])).filter(
    (candidate) => candidate.length > 0,
  );
  const maxDistance = config.maxDistance ?? defaultMaxDistance;
  const transcriptWords = normalizedTranscript.split(' ');
  return transcriptWords.some((word) =>
    fuzzyCandidates.some(
      (candidate) => levenshteinDistance(word, candidate) <= maxDistance(candidate.length),
    ),
  );
}

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Découpe sur les espaces uniquement (contrairement à `normalizeForWakeWordMatch`) : conserve les positions dans la chaîne d'origine. */
function tokenizeByWhitespace(text: string): Token[] {
  const tokens: Token[] = [];
  const regex = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Comme `normalizeForWakeWordMatch`, mais retire aussi les espaces internes (« j'avise » → « javise »). */
function tightNormalize(text: string): string {
  return normalizeForWakeWordMatch(text).replace(/\s+/g, '');
}

/**
 * Tolérance délibérément plus large que `defaultMaxDistance` : cette
 * fonction ne sert qu'à retrouver *où* couper un texte dont la présence du
 * mot de réveil en tête a déjà été confirmée par ailleurs (par le moteur de
 * mot de réveil, sur un passage de transcription séparé) — pas à décider
 * *si* il est présent. Le risque d'une tolérance élargie est donc plus
 * faible ici que dans `matchesWakeWord`. Constaté en pratique : une
 * deuxième transcription (modèle de dictée, contexte de phrase complète)
 * peut rendre « Jarvis » assez différemment du passage de détection
 * (« J'avise », distance 2 de « jarvis » — au-delà du seuil par défaut).
 */
function leadingStripMaxDistance(wordLength: number): number {
  if (wordLength <= 5) return 1;
  if (wordLength <= 8) return 2;
  return 3;
}

const MAX_LEADING_TOKENS = 3;

/**
 * Découpe d'origine (apostrophe collée) ou déjà espacée. La plus longue
 * suite en tête gagne : « j'ai un vis » ne s'arrête pas à « j ».
 */
const JARVIS_LEADING_TOKENS: readonly (readonly string[])[] = [
  ['jinvise'],
  ['j', 'invise'],
  ['jai', 'un', 'vis'],
  ['j', 'ai', 'un', 'vis'],
  ['jaiunvis'],
  ['jen', 'vis'],
  ['j', 'en', 'vis'],
  ['jenvis'],
];

function leadingJarvisTokenCount(tokens: Token[], canonical: string): number {
  if (canonical !== 'jarvis') return 0;
  const tights = tokens.map((token) => tightNormalize(token.text));
  let best = 0;
  for (const phrase of JARVIS_LEADING_TOKENS) {
    if (phrase.length > tights.length || phrase.length <= best) continue;
    if (phrase.every((part, index) => tights[index] === part)) best = phrase.length;
  }
  return best;
}

/**
 * Retire le mot de réveil en tête d'un texte transcrit, avec sa ponctuation
 * immédiatement collée (« Jarvis, » → rien), pour ne transmettre que la
 * commande qui suit à l'agent. Utilisé quand la transcription porte sur
 * l'énoncé complet (mot de réveil compris) plutôt que sur l'audio découpé à
 * l'instant de détection — voir `useVoice.ts` pour pourquoi : transcrire la phrase entière donne plus de contexte à
 * Whisper (meilleure reconnaissance du mot de réveil lui-même) qu'une coupe
 * à l'échantillon près, qui risquait de couper l'attaque du mot suivant.
 *
 * Cherche parmi les 1 à 3 premiers mots (espaces d'origine, pas la
 * normalisation) une correspondance exacte ou floue avec le mot de réveil,
 * et renvoie ce qui suit, débarrassé de la ponctuation de tête restante. Si
 * rien ne correspond en tête, renvoie le texte tel quel (mieux vaut
 * transmettre un texte non nettoyé que tronquer à tort).
 */
/**
 * Commande à envoyer quand la dictée commence par un mot de réveil déjà
 * confirmé : on retire ce mot. Si Whisper l'a écrit autrement (« J'arrive! »
 * pour un « Jarvis ? » traînant) et qu'il ne reste qu'un seul mot, ce mot
 * est le mot de réveil lui-même : une vraie commande en donne au moins deux.
 */
/** Retire une queue « ... » / « … » laissée par le silence après la phrase. */
function withoutSilenceTail(text: string): string {
  return text
    .replace(/(?:\s*(?:\.{2,}|…)+)+\s*$/u, '')
    .replace(/\s+\?$/u, '')
    .trim();
}

export function commandAfterWakeWord(transcript: string, config: WakeWordTextMatchConfig): string {
  const trimmed = transcript.trim();
  if (isWhisperHallucination(trimmed)) return '';
  const command = withoutSilenceTail(stripLeadingWakeWord(trimmed, config));
  if (!command || isWhisperHallucination(command)) return '';
  if (command === trimmed && tokenizeByWhitespace(trimmed).length <= 1) return '';
  return command;
}

export function stripLeadingWakeWord(transcript: string, config: WakeWordTextMatchConfig): string {
  // « Jarvis, Jarvis, ouvre Chrome » : on retire chaque répétition en tête.
  let current = transcript.trim();
  for (let round = 0; round < 5; round += 1) {
    const next = stripOneLeadingWakeWord(current, config);
    if (next === current) break;
    current = next;
  }
  return current;
}

function stripOneLeadingWakeWord(transcript: string, config: WakeWordTextMatchConfig): string {
  const tokens = tokenizeByWhitespace(transcript);
  if (tokens.length === 0) return transcript.trim();

  const canonical = normalizeForWakeWordMatch(config.word);
  const phraseTokens = leadingJarvisTokenCount(tokens, canonical);
  if (phraseTokens > 0) {
    const cutAt = tokens[phraseTokens - 1]!.end;
    return transcript
      .slice(cutAt)
      .replace(/^[\s,;:.!?…"'«»-]+/u, '')
      .trim();
  }

  const exactCandidates = Array.from(
    new Set([
      ...defaultWakeWordVariants(config.word),
      ...(config.variants ?? []).map(normalizeForWakeWordMatch),
    ]),
  ).filter((candidate) => candidate.length > 0);
  const maxDistance = config.maxDistance ?? leadingStripMaxDistance;

  const windowLimit = Math.min(tokens.length, MAX_LEADING_TOKENS);
  for (let windowSize = 1; windowSize <= windowLimit; windowSize += 1) {
    const windowTokens = tokens.slice(0, windowSize);
    const tight = windowTokens.map((token) => tightNormalize(token.text)).join('');
    if (!tight) continue;

    const matchesExact = exactCandidates.some((candidate) => tight.includes(candidate));
    const matchesFuzzy =
      canonical.length > 0 &&
      levenshteinDistance(tight, canonical) <= maxDistance(canonical.length);
    if (matchesExact || matchesFuzzy) {
      const cutAt = windowTokens[windowTokens.length - 1]!.end;
      return transcript
        .slice(cutAt)
        .replace(/^[\s,;:.!?…"'«»-]+/u, '')
        .trim();
    }
  }
  return transcript.trim();
}
