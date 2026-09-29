import type { VideoDomain } from './domain.js';

/**
 * Grille unique pour chaque partie et pour la fusion finale.
 * Le modèle local doit garder le concret et écarter le remplissage.
 */
export const IMPORTANCE_RUBRIC = [
  'Tu prépares un condensé en français, clair et facile à lire, de ce qui a été dit.',
  'Garde les faits concrets, les chiffres, les noms, les décisions et les risques.',
  'Écarte les introductions, la publicité, les répétitions et le bavardage.',
  "Pour la finance, garde l'actif, l'affirmation, les chiffres, l'horizon de temps, et distingue ce qui est une opinion de ce qui est un fait.",
  "N'invente aucun chiffre qui n'est pas dans le texte. Si un nombre n'a pas été dit, ne l'écris pas.",
  'Ne transforme jamais une opinion ou une prévision en fait.',
  "Si deux passages se contredisent, signale l'incertitude au lieu d'en choisir un.",
  "Conserve l'unité et le contexte de chaque chiffre.",
  "Ne donne aucun conseil d'investissement.",
  'Réponds en français, sans préambule.',
].join(' ');

export function chunkPrompt(chunk: string, index: number, total: number): string {
  return [
    `Partie ${index + 1} sur ${total}.`,
    'Relève uniquement les points importants de cette partie.',
    'Grille : faits concrets, chiffres, noms, décisions, risques.',
    "Écarte l'introduction, la publicité, les répétitions et le bavardage.",
    "S'il s'agit de finance : actif, affirmation, chiffres, horizon de temps, opinion ou fait.",
    'Commence par une ligne « Importance : N » où N est un entier de 0 à 100 (0 = remplissage, 100 = information déterminante).',
    'Les chiffres gardent leur unité. Marque une opinion ou une prévision à part du fait.',
    "N'invente aucun chiffre.",
    '',
    chunk,
  ].join('\n');
}

export function mergePrompt(notes: string[], domain: VideoDomain = 'general'): string {
  const lines = [
    'Voici des notes extraites partie par partie de ce qui a été dit.',
    'Rédige UN condensé final, court : un paragraphe bref, puis les points importants, du plus important au moins important.',
    'Fusionne les répétitions. Ne rajoute aucun fait ni aucun chiffre absent des notes.',
    "Garde les faits concrets, les chiffres avec leur unité, les noms, les décisions et les risques.",
    "Pour la finance, garde l'actif, l'affirmation, les chiffres, l'horizon, et marque l'opinion à part du fait.",
    'Sépare les opinions, les thèses et les prévisions des faits. Signale une contradiction comme une incertitude.',
    "S'il y a des horodatages, cite les moments importants.",
    "N'invente aucun chiffre.",
  ];
  if (domain === 'finance') {
    lines.push(
      'Ajoute les risques et les limites mentionnés.',
      "Termine par : « Ceci est un résumé de la vidéo, pas un conseil d'investissement. »",
    );
  }
  return [
    ...lines,
    '',
    notes.map((note, index) => `Partie ${index + 1} :\n${note.trim()}`).join('\n\n'),
  ].join('\n');
}
