import { describe, expect, it } from 'vitest';
import { buildMissionModelPlan, routeRoleToInstalledModel } from './roleModelRouting.js';

describe('routeRoleToInstalledModel', () => {
  const installed = new Set(['code:main', 'relecteur:b', 'nomic-embed-text']);

  it('utilise le choix du rôle s’il est installé', () => {
    const route = routeRoleToInstalledModel(
      'REVIEWER',
      { codeModel: 'code:main', roleModels: { REVIEWER: 'relecteur:b' } },
      installed,
    );
    expect(route).toMatchObject({ model: 'relecteur:b', reason: 'user-role' });
    expect(route?.logLine).toBe('');
  });

  it('replie sur le modèle de code avec journal si aucun modèle dédié', () => {
    const route = routeRoleToInstalledModel('ARCHITECT', { codeModel: 'code:main' }, installed);
    expect(route).toMatchObject({ model: 'code:main', reason: 'code-model' });
    expect(route?.logLine).toContain('repli');
  });

  it('replie si le choix du rôle n’est pas installé', () => {
    const route = routeRoleToInstalledModel(
      'REVIEWER',
      { codeModel: 'code:main', roleModels: { REVIEWER: 'absent:xx' } },
      installed,
    );
    expect(route?.model).toBe('code:main');
    expect(route?.logLine).toContain('absent d’Ollama');
  });

  it('choisit selon l’historique de vraies missions quand aucun rôle n’est forcé', () => {
    const runs = [
      {
        at: 1,
        model: 'relecteur:b',
        category: 'role:CODER:mission:modify' as const,
        success: true,
      },
      {
        at: 2,
        model: 'relecteur:b',
        category: 'role:CODER:mission:modify' as const,
        success: true,
      },
      {
        at: 3,
        model: 'code:main',
        category: 'role:CODER:mission:modify' as const,
        success: false,
      },
    ];
    const route = routeRoleToInstalledModel('CODER', { codeModel: 'code:main' }, installed, {
      missionKind: 'modify',
      runs,
    });
    expect(route).toMatchObject({ model: 'relecteur:b', reason: 'run-memory' });
  });

  it('planifie une mission modify avec un seul modèle de complétion', () => {
    const plan = buildMissionModelPlan('modify', { codeModel: 'code:main' }, installed);
    expect(plan instanceof Map).toBe(true);
    if (!(plan instanceof Map)) return;
    expect(plan.get('CODER')?.model).toBe('code:main');
    expect(plan.get('REVIEWER')?.model).toBe('code:main');
  });
});
