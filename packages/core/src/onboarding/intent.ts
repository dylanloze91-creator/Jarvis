import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';

/** Détecte « Jarvis, refais le questionnaire » sans modèle. */
export function looksLikeQuestionnaireIntent(text: string): boolean {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (t.length < 8) return false;
  return (
    /\b(refais|relance|recommence)\b/.test(t) &&
    /\b(questionnaire|connaissance|accueil)\b/.test(t)
  );
}

export { ORCHESTRA_TEAMS };
