/** Vérifie que le plan reste aligné sur la demande utilisateur (périmètre). */

const STOP = new Set([
  'pour',
  'avec',
  'dans',
  'une',
  'des',
  'les',
  'jarvis',
  'code',
  'fichier',
  'ajoute',
  'ajouter',
  'corrige',
  'corriger',
  'modifier',
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3 && !STOP.has(t));
}

/**
 * Avertissements si le plan risque de dériver (critères vides, peu de lien avec la demande).
 * Ne bloque pas : l'utilisateur valide toujours le plan.
 */
export function planScopeWarnings(
  userRequest: string,
  plan: { summary: string; criteria: readonly string[] },
): string[] {
  const warnings: string[] = [];
  const trimmed = userRequest.trim();
  if (!trimmed) return warnings;

  if (!plan.criteria.length) {
    warnings.push(
      'Le plan n’a pas de critères d’acceptation explicites : ajoute-en avant de valider.',
    );
  }

  const requestTokens = [...new Set(tokens(trimmed))].slice(0, 12);
  if (!requestTokens.length) return warnings;

  const hay = `${plan.summary}\n${plan.criteria.join('\n')}`.toLowerCase();
  const hits = requestTokens.filter((t) => hay.includes(t));
  if (hits.length === 0 && requestTokens.length >= 2) {
    warnings.push(
      'Le résumé du plan ne reprend presque aucun mot de ta demande : vérifie qu’il répond au bon objectif.',
    );
  }

  return warnings;
}
