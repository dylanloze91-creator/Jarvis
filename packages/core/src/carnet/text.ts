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

/**
 * « ça n'a pas marché », « c'était nul », « tu t'es trompé ».
 * La phrase peut commencer par « Jarvis ». Au-delà de 180 caractères, ce n'est plus un signal.
 */
export function isFailureReport(text: string): boolean {
  const n = fold(text);
  if (!n || n.length > 180) return false;
  if (/\bca n a pas marche\b/.test(n)) return true;
  if (/\bc etait null?e?\b/.test(n) || /\bcetait null?e?\b/.test(n)) return true;
  if (/\btu t es trompe/.test(n) || /\btu tes trompe/.test(n)) return true;
  return false;
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
