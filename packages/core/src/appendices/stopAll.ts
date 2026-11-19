/**
 * « Jarvis, arrête tout » : reconnue par des règles sûres, avant tout modèle (cahier, section 3.4).
 * La phrase entière doit être l'ordre : « arrête tout ce bruit » ou « arrête tout de suite la
 * musique » ne sont pas des arrêts généraux.
 */

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`-]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADS = ['jarvis', 'hey jarvis', 'ok jarvis', 'dis jarvis', 'vite', 'stop', 'attention'];
const TAILS = [
  'jarvis',
  's il te plait',
  's il vous plait',
  'stp',
  'tout de suite',
  'maintenant',
  'immediatement',
  'vite',
  'merci',
];
const ORDERS = new Set([
  'arrete tout',
  'arretez tout',
  'arrete moi tout',
  'arrete moi tout ca',
  'arrete tout ca',
  'stop tout',
  'stoppe tout',
  'stoppez tout',
  'tout arreter',
  'tout stopper',
  'arret total',
  'arret general',
  'coupe tout',
  'coupez tout',
]);

/** Vrai seulement si la phrase n'est rien d'autre qu'un ordre d'arrêt général. */
export function isStopAllPhrase(text: string): boolean {
  let core = fold(text);
  if (!core) return false;
  for (let pass = 0; pass < 4; pass += 1) {
    const before = core;
    for (const head of HEADS) {
      // « stop » en tête n'est une amorce que s'il reste un ordre derrière (« stop, arrête tout »).
      if (core.startsWith(`${head} `) && !(head === 'stop' && ORDERS.has(core))) core = core.slice(head.length + 1).trim();
    }
    for (const tail of TAILS) {
      if (core.endsWith(` ${tail}`)) core = core.slice(0, -tail.length - 1).trim();
    }
    if (core === before) break;
  }
  return ORDERS.has(core);
}

export interface StopAllResult {
  /** Nom lisible : « Bras (établi) », « Robot », « Imprimante ». */
  name: string;
  ok: boolean;
  /** Ce que la cible a répondu, ou pourquoi elle n'a pas répondu. */
  detail?: string;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

/** Phrase dite après un arrêt général. Un appendice muet est nommé, avec le rappel du bouton physique. */
export function stopAllSentence(results: readonly StopAllResult[]): string {
  const stopped = results.filter((result) => result.ok).map((result) => result.name);
  const silent = results.filter((result) => !result.ok).map((result) => result.name);
  const parts: string[] = [];
  if (stopped.length) parts.push(`Arrêt envoyé : ${list(stopped)}.`);
  if (silent.length) {
    parts.push(
      `Pas de réponse de ${list(silent)} : je ne peux pas dire que c’est arrêté. Utilise le bouton d’arrêt d’urgence.`,
    );
  }
  return parts.join(' ');
}
