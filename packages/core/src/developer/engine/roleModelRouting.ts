import { modelParamsB } from './difficulty.js';
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

/** Codeur MoE déjà prévu pour une carte de 6 Go. Jamais téléchargé par la mission. */
export const PREFERRED_SIX_GB_CODER = 'qwen3.6:35b-a3b-coding';

const SIX_GB = 6e9;

/**
 * Tient dans 6 Go de VRAM : dense jusqu’à 7B (Q4 + marge), ou MoE « a3b »
 * (experts en RAM, attention sur la carte). Taille inconnue : on ne l’écarte pas.
 * `qwen3.8` est dense et trop gros même sans suffixe « b ».
 */
export function modelFitsSixGb(name: string, parameterSize?: string | null): boolean {
  if (/qwen3\.8/i.test(name)) return false;
  if (/a3b/i.test(name)) return true;
  const params = modelParamsB(name, parameterSize);
  if (params === null) return true;
  return params * 0.6e9 + 0.8e9 <= SIX_GB;
}

function isCoderName(name: string): boolean {
  return /coder/i.test(name);
}

/** Codeur installé qui tient dans 6 Go. Jamais le modèle de discussion. Les plus petits d’abord. */
export function pickFittingCoderModel(
  installed: ReadonlySet<string>,
  options: {
    chatModel?: string;
    parameterSize?: (name: string) => string | null | undefined;
  } = {},
): string | null {
  const chat = options.chatModel?.trim() ?? '';
  const fitting = [...installed].filter((name) => {
    if (!name || /embed/i.test(name) || name === chat) return false;
    if (!isCoderName(name)) return false;
    return modelFitsSixGb(name, options.parameterSize?.(name));
  });
  if (!fitting.length) return null;
  const rank = (name: string): number => {
    if (name === PREFERRED_SIX_GB_CODER) return 0;
    if (/a3b/i.test(name)) return 1;
    return 10 + (modelParamsB(name, options.parameterSize?.(name)) ?? 8);
  };
  return fitting.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0]!;
}

export interface CreationCoderChoice {
  model: string;
  /** Nom à télécharger, ou null si `model` est déjà installé. */
  pull: string | null;
  reason: string;
}

/**
 * Codeur d’une création. Le 35B MoE installé gagne sur un modèle trop gros ou sur le chat.
 * Un nom de test dont la taille est inconnue est gardé. Aucun téléchargement.
 */
export function chooseCreationCoder(input: {
  selected: string;
  chatModel?: string;
  installed: ReadonlySet<string>;
  parameterSize?: (name: string) => string | null | undefined;
}): CreationCoderChoice {
  const selected = input.selected.trim();
  const chat = input.chatModel?.trim() ?? '';
  const sizeOf = input.parameterSize;
  const isChat = Boolean(chat) && selected === chat;
  const fits = Boolean(selected) && modelFitsSixGb(selected, sizeOf?.(selected)) && !isChat;
  if (fits) return { model: selected, pull: null, reason: '' };
  const moe = input.installed.has(PREFERRED_SIX_GB_CODER) ? PREFERRED_SIX_GB_CODER : null;
  if (moe && moe !== chat) {
    return {
      model: moe,
      pull: null,
      reason: isChat
        ? `Codeur : « ${moe} » à la place du modèle de discussion « ${selected} ».`
        : `Codeur : « ${moe} » tient dans 6 Go, « ${selected || 'aucun'} » non.`,
    };
  }
  const better = pickFittingCoderModel(input.installed, { chatModel: chat, parameterSize: sizeOf });
  if (better) {
    return {
      model: better,
      pull: null,
      reason: `Codeur : « ${better} » tient dans 6 Go, « ${selected || 'aucun'} » non.`,
    };
  }
  return {
    model: selected,
    pull: null,
    reason: 'Aucun codeur installé ne tient dans 6 Go. Aucun autre modèle n’est téléchargé.',
  };
}

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
    const selectedCoder = developer.codeModel.trim();
    const missionCoder =
      selectedCoder && installed.has(selectedCoder)
        ? selectedCoder
        : pickMissionCoderModel(installed, realBenches);
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
    const explicitPick = Boolean(selectedCoder && missionCoder === selectedCoder);
    if (missionCoder && (explicitPick || benchPick || catalogPick)) {
      const shared: RoleModelRoute = {
        role: 'CODER',
        model: missionCoder,
        reason: 'code-model',
        logLine: explicitPick
          ? `Codeur de mission : modèle choisi « ${missionCoder} » respecté (un seul modèle chargé à la fois).`
          : `Codeur de mission : « ${missionCoder} » (un seul modèle chargé pour écrire, corriger et relire).`,
      };
      plan.set('CODER', shared);
      // Un relecteur ou un débogueur choisi par l'utilisateur reste le sien.
      // Le modèle unique ne s'applique qu'aux rôles sans choix dédié installé.
      for (const role of ['REVIEWER', 'DEBUGGER'] as const) {
        const current = plan.get(role);
        if (current && current.reason !== 'user-role') plan.set(role, { ...shared, role });
      }
    }
  }
  return plan;
}
