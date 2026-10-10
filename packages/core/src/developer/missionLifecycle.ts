import type { MissionState, MissionStepStatus } from './engine/mission.js';

/** Phases du cycle décrit dans la spec majeure (affichage et journalisation). */
export type MissionLifecyclePhase =
  | 'comprehension'
  | 'inspection'
  | 'clarification'
  | 'plan'
  | 'modification'
  | 'tests'
  | 'diagnostic'
  | 'correction'
  | 'review'
  | 'validation'
  | 'done'
  | 'failed'
  | 'cancelled';

export const MISSION_LIFECYCLE_LABELS: Record<MissionLifecyclePhase, string> = {
  comprehension: 'Compréhension',
  inspection: 'Inspection du projet',
  clarification: 'Clarification',
  plan: 'Plan',
  modification: 'Modification (copie isolée)',
  tests: 'Tests',
  diagnostic: 'Diagnostic',
  correction: 'Correction',
  review: 'Revue',
  validation: 'Validation',
  done: 'Terminé',
  failed: 'Échoué',
  cancelled: 'Annulé',
};

export interface MissionTaskPhaseHint {
  status: string;
  attempts: number;
  maxAttempts: number;
  awaitingApproval: boolean;
  reportVerdict: 'success' | 'failed' | 'stopped' | null;
}

function stepRunning(mission: MissionState, actorIds: string[]): boolean {
  return mission.steps.some(
    (s) => actorIds.includes(s.actor) && (s.status === 'running' || s.status === 'waiting'),
  );
}

function stepDone(mission: MissionState, actorIds: string[]): boolean {
  return mission.steps.some((s) => actorIds.includes(s.actor) && s.status === 'done');
}

/** Déduit la phase courante à partir de la mission et, si présente, de la tâche de code. */
export function resolveMissionLifecyclePhase(
  mission: MissionState,
  task?: MissionTaskPhaseHint | null,
): MissionLifecyclePhase {
  if (mission.status === 'cancelled') return 'cancelled';
  if (mission.verdict === 'failed' || mission.status === 'failed') return 'failed';
  if (mission.verdict === 'success' || mission.status === 'finished') return 'done';

  if (mission.status === 'waiting-answers') return 'clarification';

  if (task) {
    if (task.awaitingApproval || task.status === 'awaiting-approval') return 'plan';
    if (task.status === 'planning') return 'plan';
    if (task.status === 'running' && task.attempts === 0) return 'modification';
    if (task.status === 'running' && task.attempts > 0) return 'correction';
    if (task.status === 'paused') return 'diagnostic';
    if (task.reportVerdict === 'stopped') return 'failed';
    if (task.reportVerdict === 'failed') return task.attempts > 0 ? 'correction' : 'tests';
    if (task.reportVerdict === 'success') return 'validation';
    if (task.status === 'finished') return 'validation';
  }

  if (!mission.goal && stepRunning(mission, ['goal'])) return 'comprehension';
  if (!mission.goal) return 'comprehension';

  if (stepRunning(mission, ['architect', 'reasoner', 'research'])) return 'inspection';
  if (!stepDone(mission, ['architect']) && mission.kind !== 'question') return 'comprehension';

  if (mission.status === 'task') {
    if (stepRunning(mission, ['reviewer'])) return 'review';
    if (stepRunning(mission, ['coder', 'debugger'])) return 'modification';
    return 'modification';
  }

  if (stepRunning(mission, ['reviewer'])) return 'review';
  if (stepRunning(mission, ['coder'])) return 'modification';

  return 'comprehension';
}

export function lifecycleProgress(
  mission: MissionState,
  phase: MissionLifecyclePhase,
): { done: number; total: number } {
  const specialistDone = mission.steps.filter((s) => s.status === 'done').length;
  const specialistTotal = mission.steps.length;
  if (phase === 'done' || phase === 'failed' || phase === 'cancelled') {
    return { done: specialistTotal, total: specialistTotal };
  }
  return { done: specialistDone, total: specialistTotal };
}

export function stepStatusLabel(status: MissionStepStatus): string {
  switch (status) {
    case 'pending':
      return 'À faire';
    case 'running':
      return 'En cours';
    case 'done':
      return 'OK';
    case 'failed':
      return 'Échec';
    case 'skipped':
      return 'Ignoré';
    case 'waiting':
      return 'En attente';
    default:
      return status;
  }
}
