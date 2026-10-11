import {
  appendModelRun,
  formatRunMemoryLogLine,
  modelRunCategory,
  pickModelFromRunMemory,
  type ModelRunCategory,
  type ModelRunRecord,
} from './modelRunMemory.js';
import { LOOP_ACTORS, MISSION_CHAINS, missionUsesTask, type MissionKind, type RoleModels } from './router.js';
import { ROLE_LABELS, type SpecialistRole } from './roles.js';

export type RoleModelRouteReason = 'user-role' | 'code-model' | 'run-memory' | 'installed-pick';

export { appendModelRun, modelRunCategory, type ModelRunRecord };

export interface RoleModelRoute {
  role: SpecialistRole;
  model: string;
  reason: RoleModelRouteReason;
  /** Ligne de journal pour un repli (pas pour un choix explicite installé). */
  logLine: string;
}

function isEmbeddingModel(name: string): boolean {
  return /embed/i.test(name);
}

/** Premier modèle de complétion installé (hors embeddings). */
export function pickInstalledCompletionModel(installed: ReadonlySet<string>): string | null {
  for (const name of installed) {
    if (!isEmbeddingModel(name)) return name;
  }
  return null;
}

/** Rôles d'une mission qui appellent un modèle Ollama. */
export function missionRolesNeedingModel(kind: MissionKind): SpecialistRole[] {
  const roles = new Set<SpecialistRole>();
  for (const step of MISSION_CHAINS[kind]) {
    const actor = step.actor;
    if (actor !== 'USER' && actor !== 'JARVIS') roles.add(actor);
  }
  if (missionUsesTask(kind)) {
    for (const role of Object.values(LOOP_ACTORS)) roles.add(role);
  }
  return [...roles];
}

/**
 * Associe un rôle à un modèle **déjà installé** dans Ollama.
 * Repli journalisé : modèle de code, puis premier modèle de complétion installé.
 */
export interface RouteRoleContext {
  missionKind?: MissionKind;
  runs?: readonly ModelRunRecord[];
}

export function routeRoleToInstalledModel(
  role: SpecialistRole,
  developer: { codeModel: string; roleModels?: RoleModels },
  installed: ReadonlySet<string>,
  context: RouteRoleContext = {},
): RoleModelRoute | null {
  const label = ROLE_LABELS[role];
  const roleChoice = developer.roleModels?.[role]?.trim() ?? '';
  const codeModel = developer.codeModel.trim();
  const runs = context.runs ?? [];
  const memoryCategory: ModelRunCategory | null = context.missionKind
    ? modelRunCategory(role, context.missionKind)
    : role === 'CODER'
      ? modelRunCategory('CODER', 'code-task')
      : null;

  if (roleChoice && installed.has(roleChoice)) {
    return {
      role,
      model: roleChoice,
      reason: 'user-role',
      logLine: '',
    };
  }

  if (!roleChoice && memoryCategory) {
    const memoryPick = pickModelFromRunMemory(installed, memoryCategory, runs);
    if (memoryPick && installed.has(memoryPick.model)) {
      return {
        role,
        model: memoryPick.model,
        reason: 'run-memory',
        logLine: formatRunMemoryLogLine(label, memoryCategory, memoryPick),
      };
    }
  }

  if (!roleChoice && codeModel && installed.has(codeModel)) {
    return {
      role,
      model: codeModel,
      reason: 'code-model',
      logLine: `${label} : repli sur le modèle de code « ${codeModel} » (aucun modèle dédié choisi).`,
    };
  }

  if (roleChoice && codeModel && installed.has(codeModel)) {
    return {
      role,
      model: codeModel,
      reason: 'code-model',
      logLine: `${label} : repli sur le modèle de code « ${codeModel} » (choix « ${roleChoice} » absent d’Ollama).`,
    };
  }

  const pick = pickInstalledCompletionModel(installed);
  if (pick) {
    const because = roleChoice
      ? `choix « ${roleChoice} » et modèle de code absents d’Ollama`
      : codeModel
        ? `modèle de code « ${codeModel} » absent d’Ollama`
        : 'aucun modèle de code choisi';
    return {
      role,
      model: pick,
      reason: 'installed-pick',
      logLine: `${label} : repli sur « ${pick} » (${because}).`,
    };
  }

  return null;
}

export function buildMissionModelPlan(
  kind: MissionKind,
  developer: { codeModel: string; roleModels?: RoleModels },
  installed: ReadonlySet<string>,
  runs: readonly ModelRunRecord[] = [],
): Map<SpecialistRole, RoleModelRoute> | { error: string } {
  const plan = new Map<SpecialistRole, RoleModelRoute>();
  for (const role of missionRolesNeedingModel(kind)) {
    const route = routeRoleToInstalledModel(role, developer, installed, {
      missionKind: kind,
      runs,
    });
    if (!route) {
      return {
        error: `Aucun modèle Ollama utilisable pour ${ROLE_LABELS[role]}. Installe au moins un modèle de complétion.`,
      };
    }
    plan.set(role, route);
  }
  return plan;
}
