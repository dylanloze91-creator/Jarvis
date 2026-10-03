import { SPECIALIST_ROLES, type SpecialistRole } from './roles.js';

/**
 * Routeur du moteur : des règles fixes, sans modèle. Le type de mission vient
 * d'un choix de l'utilisateur ; `suggestMissionKind` ne fait que proposer.
 */
export const MISSION_KINDS = ['question', 'modify', 'fix', 'document'] as const;
export type MissionKind = (typeof MISSION_KINDS)[number];

export const MISSION_LABELS: Record<MissionKind, string> = {
  question: 'Question sur le code',
  modify: 'Modifier ou ajouter',
  fix: 'Corriger un bug',
  document: 'Documenter',
};

export type ChainActor = SpecialistRole | 'USER';

export interface ChainStep {
  id: string;
  actor: ChainActor;
  label: string;
}

/** Chaîne de chaque type de mission, avant la boucle de modification (plan → tests → revue → corrections). */
export const MISSION_CHAINS: Record<MissionKind, ChainStep[]> = {
  question: [
    { id: 'answer', actor: 'REASONER', label: 'Réponse (lecture seule, citations relues)' },
  ],
  modify: [
    { id: 'goal', actor: 'REASONER', label: 'Objectif, critères et questions' },
    { id: 'design', actor: 'ARCHITECT', label: 'Conception (lecture seule)' },
  ],
  fix: [
    { id: 'goal', actor: 'REASONER', label: 'Objectif, critères et questions' },
    { id: 'design', actor: 'DEBUGGER', label: 'Diagnostic (lecture seule)' },
  ],
  document: [
    { id: 'goal', actor: 'REASONER', label: 'Objectif, critères et questions' },
    { id: 'design', actor: 'DOCUMENTATION', label: 'Plan de la documentation (lecture seule)' },
  ],
};

/** Étapes de la boucle de modification partagée par modify, fix et document. */
export const LOOP_ACTORS = {
  plan: 'CODER',
  edit: 'CODER',
  test: 'TESTER',
  review: 'REVIEWER',
  diagnose: 'DEBUGGER',
  fix: 'CODER',
} as const satisfies Record<string, SpecialistRole>;

export type LoopPhase = keyof typeof LOOP_ACTORS;

export function missionUsesTask(kind: MissionKind): boolean {
  return kind !== 'question';
}

export function suggestMissionKind(text: string): MissionKind {
  const value = text.trim().toLowerCase();
  if (/\b(corrige|répare|repare|bug|erreur|plante|échoue|echoue|cassé|casse|ne marche)/.test(value))
    return 'fix';
  if (/\b(documente|documentation|readme|explique dans|rédige la doc)/.test(value))
    return 'document';
  if (
    /\?\s*$/.test(value) ||
    /^(où|ou est|comment|pourquoi|quel|quelle|quels|quelles|combien|qu['’]est)/.test(value)
  )
    return 'question';
  return 'modify';
}

export type RoleModels = Partial<Record<SpecialistRole, string>>;

/**
 * Modèle d'un rôle : celui que l'utilisateur a choisi pour ce rôle, sinon le
 * modèle de code. Jamais un modèle choisi par Jarvis : vide = pas de modèle.
 */
export function resolveRoleModel(
  role: SpecialistRole,
  developer: { codeModel: string; roleModels?: RoleModels },
): string | null {
  const chosen = developer.roleModels?.[role]?.trim();
  if (chosen) return chosen;
  return developer.codeModel.trim() || null;
}

/** Rôles d'une mission qui n'ont aucun modèle. */
export function rolesWithoutModel(
  kind: MissionKind,
  developer: { codeModel: string; roleModels?: RoleModels },
): SpecialistRole[] {
  const roles = new Set<SpecialistRole>();
  for (const step of MISSION_CHAINS[kind]) if (step.actor !== 'USER') roles.add(step.actor);
  if (missionUsesTask(kind)) for (const role of Object.values(LOOP_ACTORS)) roles.add(role);
  return SPECIALIST_ROLES.filter((role) => roles.has(role) && !resolveRoleModel(role, developer));
}
