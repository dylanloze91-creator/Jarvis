/** Spécialistes du moteur de développement. Un rôle n'est lié à aucun modèle. */
export const SPECIALIST_ROLES = [
  'ARCHITECT',
  'CODER',
  'REASONER',
  'REVIEWER',
  'DEBUGGER',
  'TESTER',
  'RESEARCHER',
  'DOCUMENTATION',
] as const;

export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

export const ROLE_LABELS: Record<SpecialistRole, string> = {
  ARCHITECT: 'Architecte',
  CODER: 'Codeur',
  REASONER: 'Raisonnement',
  REVIEWER: 'Relecteur',
  DEBUGGER: 'Débogueur',
  TESTER: 'Testeur',
  RESEARCHER: 'Recherche',
  DOCUMENTATION: 'Documentation',
};

export function isSpecialistRole(value: string): value is SpecialistRole {
  return (SPECIALIST_ROLES as readonly string[]).includes(value);
}
