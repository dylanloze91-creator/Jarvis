/**
 * Nettoyage des phrases du carnet. Aucun modèle : minuscules, sans accent, sans apostrophe.
 */

const STOP = new Set([
  'avec',
  'dans',
  'pour',
  'cette',
  'comme',
  'mais',
  'plus',
  'tout',
  'tous',
  'toute',
  'jarvis',
  'les',
  'des',
  'une',
  'que',
  'qui',
  'quoi',
  'sur',
  'par',
  'est',
  'pas',
  'mon',
  'ton',
  'son',
  'aux',
  'moi',
  'toi',
  'lui',
  'elle',
  'nous',
  'vous',
  'leur',
  'cela',
]);

export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mots utiles (≥ 3 lettres), apostrophes et accents déjà retirés. */
export function contentWords(text: string): string[] {
  return (fold(text).match(/[a-z]{3,}/g) ?? []).filter((word) => !STOP.has(word));
}

/**
 * Part des mots du plus long des deux textes qui se retrouvent dans l'autre.
 * 1 = les mêmes mots. 0 = rien en commun, ou un côté vide.
 */
export function wordOverlap(left: string, right: string): number {
  const a = new Set(contentWords(left));
  const b = new Set(contentWords(right));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

/** « non, mais… » : une nouvelle demande, pas une correction du tour d'avant. */
export function isNewRequestDespiteNon(text: string): boolean {
  return /^non mais\b/.test(fold(text));
}

/** « encore une blague », « une autre » : l'utilisateur redemande exprès. */
export function isVoluntaryRepeat(text: string): boolean {
  const n = fold(text);
  return (
    /\bencore une\b/.test(n) ||
    /\bencore un\b/.test(n) ||
    /\bune autre\b/.test(n) ||
    /\bun autre\b/.test(n)
  );
}

/** « je t'ai dit… » : correction citée par le cahier, pas couverte par `classifyUtterance`. */
export function isToldYouCorrection(text: string): boolean {
  const n = fold(text);
  return /\bje t ai dit\b/.test(n) || /\bje te l ai dit\b/.test(n);
}

const WAKE_WORDS = new Set(['jarvis']);
/** Petits mots qu'on peut enlever autour d'une phrase seule, pas au milieu d'une demande. */
const EDGE_FILLERS = new Set([
  'la',
  'encore',
  'vraiment',
  'franchement',
  'bon',
  'eh',
  'bah',
  'ben',
  'ok',
  'hein',
]);

/** Formes exactes, après retrait du mot de réveil, de la ponctuation et des petits mots. */
const ALONE_FORMS = new Set([
  'ca n a pas marche',
  'ca marche pas',
  'ca a pas marche',
  'c etait nul',
  'c etait nulle',
  'tu t es trompe',
  'tu t es trompee',
  'tu t es plante',
  'tu t es plantee',
]);

/**
 * Formes qui signalent un raté même dans une phrase plus longue.
 * « c'était nul » n'y est pas : « le film d'hier soir, c'était nul » parle du film.
 */
const EMBEDDED_FORMS = [
  'ca n a pas marche',
  'ca marche pas',
  'ca a pas marche',
  'tu t es trompe',
  'tu t es plante',
];

function containsForm(folded: string, form: string): boolean {
  return ` ${folded} `.includes(` ${form} `);
}

/** Retire le mot de réveil et les petits mots en tête et en fin, jusqu'à stabilité. */
function bareFailure(text: string): string {
  const words = fold(text).split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed && words.length > 0) {
    changed = false;
    const first = words[0];
    if (first && (WAKE_WORDS.has(first) || EDGE_FILLERS.has(first))) {
      words.shift();
      changed = true;
    }
    const last = words.at(-1);
    if (last && (WAKE_WORDS.has(last) || EDGE_FILLERS.has(last))) {
      words.pop();
      changed = true;
    }
  }
  return words.join(' ');
}

/**
 * Règle express : la phrase, seule, est un signal.
 * « Jarvis, vraiment, ça n'a pas marché, hein » oui.
 * « Tu t'es trompé, il est 17 h » non : le tour va au modèle.
 */
export function isFailureReport(text: string): boolean {
  return ALONE_FORMS.has(bareFailure(text));
}

/**
 * La phrase est plus longue, mais elle dit quand même que ça n'a pas marché
 * ou que Jarvis s'est trompé. Le modèle répond. Le carnet note un signal
 * seulement s'il y a déjà une réponse de Jarvis.
 */
export function isEmbeddedFailureSignal(text: string): boolean {
  if (isFailureReport(text)) return false;
  const folded = fold(text);
  return EMBEDDED_FORMS.some((form) => containsForm(folded, form));
}

/** « stop » / « tais-toi » adressé à Spotify ou à la musique, pas à Jarvis. */
export function isSpotifyAddressedStop(text: string): boolean {
  const n = fold(text);
  if (!/\b(stop|arrete|arreter|pause|coupe|couper)\b/.test(n)) return false;
  return /\b(spotify|musique|lecture|morceau|chanson)\b/.test(n);
}

/** « stop » ou « tais-toi » pour faire taire Jarvis. */
export function isJarvisSilence(text: string): 'stop' | 'tais-toi' | null {
  const n = fold(text);
  if (n === 'stop') return 'stop';
  if (n === 'tais toi' || n === 'tais toi jarvis') return 'tais-toi';
  if (/^tais toi\b/.test(n) && !isSpotifyAddressedStop(text)) return 'tais-toi';
  if (/^stop\b/.test(n) && !isSpotifyAddressedStop(text) && contentWords(text).length <= 1)
    return 'stop';
  return null;
}

/** Un téléchargement demandé : la lenteur n'est pas un raté. */
export function isRequestedDownload(text: string): boolean {
  const n = fold(text);
  if (/\b(telecharge\w*|download|pull)\b/.test(n)) return true;
  return /\binstalle\w*\s+(le\s+)?(modele|ollama|whisper|piper)\b/.test(n);
}
