import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../../providers/registry.js';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../../providers/types.js';
import { parseSettings } from '../../settings.js';
import { ToolManager } from '../../tools/manager.js';
import { createCodeAIProvider } from '../codeProvider.js';
import {
  createMission,
  isMissionState,
  patchStep,
  summarizeMission,
  upsertStep,
} from './mission.js';
import {
  GOAL_MARKER,
  blockingIssues,
  designContext,
  diagnosisText,
  goalSystem,
  reviewSystem,
} from './missionPrompts.js';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import {
  MISSION_CHAINS,
  resolveRoleModel,
  rolesWithoutModel,
  suggestMissionKind,
} from './router.js';
import { SpecialistError, runSpecialist } from './specialist.js';
import { architectSchema, goalSchema, reviewerSchema } from './specialistSchemas.js';

function scripted(replies: string[]) {
  const systems: string[] = [];
  const provider: LLMProvider = {
    id: 'ollama',
    label: 'faux',
    model: 'candidat:test',
    requiresApiKey: false,
    async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
      systems.push(request.system ?? '');
      yield { type: 'text', delta: replies.shift() ?? 'rien' };
      yield { type: 'done', finishReason: 'stop' };
    },
  };
  const registry = new ProviderRegistry().register(
    { id: 'ollama', label: 'faux', requiresApiKey: false, defaultModel: 'x', suggestedModels: [] },
    () => provider,
  );
  return { code: createCodeAIProvider(registry, { model: 'candidat:test' }), systems };
}

describe('spécialistes (0.5.2)', () => {
  it('sortie JSON validée ; une relance si hors format ; échec net ensuite', async () => {
    const ok = scripted(['{"goal": "Ajouter X", "questions": [], "criteria": ["test vert"]}']);
    const run = await runSpecialist(ok.code, {
      role: 'REASONER',
      system: goalSystem(JARVIS_PROJECT_PROFILE),
      prompt: 'Demande',
      schema: goalSchema,
    });
    expect(run.output).toEqual({
      goal: 'Ajouter X',
      questions: [],
      criteria: ['test vert'],
      constraints: [],
    });
    expect(run.retried).toBe(false);
    expect(ok.systems[0]).toContain(GOAL_MARKER);

    const retry = scripted(['pas du JSON', '{"goal": "Ajouter X"}']);
    const again = await runSpecialist(retry.code, {
      role: 'REASONER',
      system: 's',
      prompt: 'p',
      schema: goalSchema,
    });
    expect(again.retried).toBe(true);
    expect(again.output.goal).toBe('Ajouter X');

    const bad = scripted(['{"architecture": ""}', '{"modules": []}']);
    await expect(
      runSpecialist(bad.code, {
        role: 'ARCHITECT',
        system: 's',
        prompt: 'p',
        schema: architectSchema,
      }),
    ).rejects.toBeInstanceOf(SpecialistError);
  });

  it('avec outils : passe par la boucle d’outils, outils invisibles à la relance', async () => {
    const { code } = scripted(['réponse libre', '{"goal": "Y"}']);
    const tools = new ToolManager();
    const run = await runSpecialist(code, {
      role: 'REASONER',
      system: 's',
      prompt: 'p',
      schema: goalSchema,
      tools,
    });
    expect(run.output.goal).toBe('Y');
    expect(run.retried).toBe(true);
  });

  it('revue : « findings » accepté comme « issues » ; points bloquants extraits', () => {
    const review = reviewerSchema.parse({
      verdict: 'refusé',
      findings: [
        { severity: 'bloquant', file: 'a.ts', line: 3, message: 'confirmation retirée' },
        { severity: 'info', message: 'nom' },
      ],
    });
    expect(blockingIssues(review)).toEqual(['a.ts:3 — confirmation retirée']);
    expect(reviewSystem(JARVIS_PROJECT_PROFILE)).toContain('bloquant');
  });
});

describe('routeur sans modèle (0.5.2)', () => {
  it('propose un type de mission par mots-clés', () => {
    expect(suggestMissionKind('Où sont enregistrés les outils ?')).toBe('question');
    expect(suggestMissionKind('Corrige le bug du plan introuvable')).toBe('fix');
    expect(suggestMissionKind('Documente le banc réel dans un README')).toBe('document');
    expect(suggestMissionKind('Ajoute un réglage pour le thème')).toBe('modify');
  });

  it('chaque chaîne commence par le bon spécialiste', () => {
    expect(MISSION_CHAINS.question.map((s) => s.actor)).toEqual(['REASONER']);
    expect(MISSION_CHAINS.modify.map((s) => s.actor)).toEqual(['REASONER', 'ARCHITECT']);
    expect(MISSION_CHAINS.fix.map((s) => s.actor)).toEqual(['REASONER', 'DEBUGGER']);
    expect(MISSION_CHAINS.document.map((s) => s.actor)).toEqual(['REASONER', 'DOCUMENTATION']);
  });

  it('modèle d’un rôle : choix de l’utilisateur, sinon modèle de code, sinon aucun', () => {
    const developer = { codeModel: 'code:a', roleModels: { REVIEWER: 'relecteur:b' } };
    expect(resolveRoleModel('REVIEWER', developer)).toBe('relecteur:b');
    expect(resolveRoleModel('CODER', developer)).toBe('code:a');
    expect(resolveRoleModel('CODER', { codeModel: '' })).toBeNull();
    expect(rolesWithoutModel('question', { codeModel: '' })).toEqual(['REASONER']);
    expect(rolesWithoutModel('modify', { codeModel: '', roleModels: { CODER: 'x' } })).toEqual([
      'ARCHITECT',
      'REASONER',
      'REVIEWER',
      'DEBUGGER',
      'TESTER',
    ]);
    expect(rolesWithoutModel('fix', developer)).toEqual([]);
  });

  it('réglage developer.roleModels : facultatif, aucune clé gagnée, rôles inconnus refusés', () => {
    expect(parseSettings({}).developer).not.toHaveProperty('roleModels');
    const parsed = parseSettings({ developer: { roleModels: { REVIEWER: 'm:1' } } });
    expect(parsed.developer.roleModels).toEqual({ REVIEWER: 'm:1' });
    const previous = parseSettings({ developer: { codeModel: 'c' } });
    const bad = parseSettings(
      { ...previous, developer: { ...previous.developer, roleModels: { PILOTE: 'x' } } },
      previous,
    );
    expect(bad.developer).toEqual(previous.developer);
  });
});

describe('état de mission (0.5.2)', () => {
  it('création, étapes, résumé, relecture', () => {
    const mission = createMission({
      id: 'm1',
      projectId: 'jarvis',
      kind: 'modify',
      request: 'Ajoute X',
      skipQuestions: false,
      now: 1,
    });
    expect(mission.steps.map((s) => [s.id, s.status])).toEqual([
      ['goal', 'pending'],
      ['design', 'pending'],
    ]);
    patchStep(mission, 'goal', { status: 'running', model: 'm' }, 5);
    patchStep(mission, 'goal', { status: 'done' }, 9);
    expect(mission.steps[0]).toMatchObject({
      status: 'done',
      startedAt: 5,
      finishedAt: 9,
      model: 'm',
    });
    upsertStep(
      mission,
      { id: 'review-1', actor: 'REVIEWER', label: 'Revue', status: 'running' },
      10,
    );
    expect(mission.steps).toHaveLength(3);
    expect(summarizeMission(mission)).toMatchObject({
      id: 'm1',
      kind: 'modify',
      status: 'running',
    });
    expect(isMissionState(JSON.parse(JSON.stringify(mission)))).toBe(true);
    expect(isMissionState({ id: 1 })).toBe(false);
  });

  it('contexte transmis au plan : objectif, réponses, conception ; diagnostic lisible', () => {
    const brief = {
      request: 'Ajoute X',
      goal: { goal: 'X existe', questions: ['Où ?'], criteria: ['test vert'], constraints: [] },
      answers: [{ question: 'Où ?', answer: 'dans core' }],
    };
    const text = designContext(
      'ARCHITECT',
      architectSchema.parse({
        architecture: 'Une fonction pure.',
        modules: [{ name: 'x', files: ['packages/core/src/x.ts'] }],
      }),
      brief,
    );
    expect(text).toContain('Objectif : X existe');
    expect(text).toContain("Réponse de l'utilisateur : dans core");
    expect(text).toContain('packages/core/src/x.ts');
    expect(
      diagnosisText({
        hypotheses: [{ cause: 'zéro manquant', fix: 'padStart' }],
        chosen: 0,
        filesToRead: [],
      }),
    ).toBe('→ zéro manquant : padStart');
  });
});
