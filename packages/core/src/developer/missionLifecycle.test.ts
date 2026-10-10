import { describe, expect, it } from 'vitest';
import { createMission } from './engine/mission.js';
import { MISSION_LIFECYCLE_LABELS, resolveMissionLifecyclePhase } from './missionLifecycle.js';

describe('resolveMissionLifecyclePhase', () => {
  it('attend les réponses utilisateur', () => {
    const mission = createMission({
      id: 'm1',
      projectId: 'jarvis',
      kind: 'modify',
      request: 'Corrige un test',
      skipQuestions: false,
      now: 1,
    });
    mission.status = 'waiting-answers';
    mission.goal = { goal: 'Corriger', questions: ['Quel test ?'], criteria: [], constraints: [] };
    expect(resolveMissionLifecyclePhase(mission, null)).toBe('clarification');
    expect(MISSION_LIFECYCLE_LABELS.clarification).toBeTruthy();
  });

  it('plan en attente de validation', () => {
    const mission = createMission({
      id: 'm2',
      projectId: 'jarvis',
      kind: 'modify',
      request: 'Ajoute un test',
      skipQuestions: true,
      now: 1,
    });
    mission.status = 'task';
    mission.goal = { goal: 'Test', questions: [], criteria: ['test vert'], constraints: [] };
    const phase = resolveMissionLifecyclePhase(mission, {
      status: 'awaiting-approval',
      attempts: 0,
      maxAttempts: 3,
      awaitingApproval: true,
      reportVerdict: null,
    });
    expect(phase).toBe('plan');
  });
});
