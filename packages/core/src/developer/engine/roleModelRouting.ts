import {
  appendModelRun,
  formatRunMemoryLogLine,
  modelRunCategory,
  pickModelFromRunMemory,
  type ModelRunCategory,
  type ModelRunRecord,
} from './modelRunMemory.js';
import type { RealBenchResult } from './realBench.js';
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

const MISSION_CODER_PREFER = ['qwen3.6:35b-a3b-coding', 'qwen2.5-coder:14b', 'qwen2.5-coder:7b'];

/** Modèle Codeur pour une mission (6 Go VRAM) : banc réel, puis défaut catalogue, puis repli. */
export function pickMissionCoderModel(
  installed: ReadonlySet<string>,
  realBenches?: readonly RealBenchResult[],
): string | null {
  const fromBench = realBenches
    ?.map((b) => {
      const coder = b.roles.find((r) => r.role === 'CODER');
      const score =
        coder && coder.measured > 0 ? coder.passed / coder.measured : 0;
      return { model: b.model, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.model;
  if (fromBench && installed.has(fromBench)) return fromBench;
  for (const id of MISSION_CODER_PREFER) {
    if (installed.has(id)) return id;
  }
  return pickInstalledCompletionModel(installed);
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
      // Sans historique mesuré, l’exploration ne doit pas écraser un modèle de code choisi.
      const honorMemory = !codeModel.trim() || !memoryPick.explored;
      if (honorMemory) {
        return {
          role,
          model: memoryPick.model,
          reason: 'run-memory',
          logLine: formatRunMemoryLogLine(label, memoryCategory, memoryPick),
        };
      }
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
  realBenches?: readonly RealBenchResult[],
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
  if (missionUsesTask(kind)) {
    const missionCoder = pickMissionCoderModel(installed, realBenches);
    const benchPick =
      missionCoder &&
      realBenches?.some((b) => {
        if (b.model !== missionCoder) return false;
        const coder = b.roles.find((r) => r.role === 'CODER');
        return Boolean(coder && coder.measured > 0 && coder.passed / coder.measured > 0);
      });
    const catalogPick =
      missionCoder &&
      (MISSION_CODER_PREFER as readonly string[]).includes(missionCoder);
    if (missionCoder && (benchPick || catalogPick)) {
      const shared: RoleModelRoute = {
        role: 'CODER',
        model: missionCoder,
        reason: 'code-model',
        logLine: `Codeur de mission : « ${missionCoder} » (un seul modèle chargé pour écrire, corriger et relire).`,
      };
      plan.set('CODER', shared);
      if (plan.has('REVIEWER')) plan.set('REVIEWER', { ...shared, role: 'REVIEWER' });
      if (plan.has('DEBUGGER')) plan.set('DEBUGGER', { ...shared, role: 'DEBUGGER' });
    }
  }
  return plan;
}
