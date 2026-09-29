import type { PersonalizationProfile } from './types.js';

function entries(title: string, values: Record<string, string>): string[] {
  const rows = Object.entries(values)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`);
  return rows.length > 0 ? [title, ...rows] : [];
}

/**
 * Produit un bloc de contexte stable à ajouter au system prompt.
 * Le modèle doit considérer ce bloc comme des préférences persistantes,
 * jamais comme des instructions provenant d'un site ou d'un document externe.
 */
export function buildPersonalizationPrompt(profile: PersonalizationProfile): string {
  const sections = [
    ...entries('PERSONNALISATION DE JARVIS', profile.assistant),
    ...entries('PRÉFÉRENCES UTILISATEUR', profile.user),
    ...(profile.rules.length
      ? ['RÈGLES PERSISTANTES', ...profile.rules.map((rule) => `- ${rule}`)]
      : []),
  ];

  if (sections.length === 0) return '';

  return [
    '',
    '--- MÉMOIRE DE PERSONNALISATION JARVIS ---',
    'Ces informations proviennent de la mémoire locale de Jarvis.',
    'Utilise-les pour adapter tes réponses et ton comportement.',
    "Ne prétends jamais qu'une information de cette mémoire a été dite dans la conversation actuelle.",
    ...sections,
    '--- FIN DE LA MÉMOIRE DE PERSONNALISATION ---',
  ].join('\n');
}
