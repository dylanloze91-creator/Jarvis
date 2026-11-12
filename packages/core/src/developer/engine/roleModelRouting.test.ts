import { describe, expect, it } from 'vitest';
import {
  buildMissionModelPlan,
  chooseCreationCoder,
  routeRoleToInstalledModel,
} from './roleModelRouting.js';

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

  it('garde le modèle de code sans historique mesuré (exploration seulement si vide)', () => {
    const route = routeRoleToInstalledModel('CODER', { codeModel: 'code:main' }, installed, {
      runs: [],
    });
    expect(route).toMatchObject({ model: 'code:main', reason: 'code-model' });
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

  it('garde le relecteur choisi même quand le codeur de mission est fixé', () => {
    const plan = buildMissionModelPlan(
      'modify',
      { codeModel: 'code:main', roleModels: { REVIEWER: 'relecteur:b' } },
      installed,
    );
    expect(plan instanceof Map).toBe(true);
    if (!(plan instanceof Map)) return;
    expect(plan.get('CODER')?.model).toBe('code:main');
    expect(plan.get('REVIEWER')).toMatchObject({ model: 'relecteur:b', reason: 'user-role' });
  });

  it('5.0.78 : le Codeur choisi dans « Modèle par rôle » prime sur le modèle de code (mission modify)', () => {
    const models = new Set(['code:main', 'ornith:9b', 'relecteur:b']);
    const plan = buildMissionModelPlan(
      'modify',
      { codeModel: 'code:main', roleModels: { CODER: 'ornith:9b', REVIEWER: 'relecteur:b' } },
      models,
    );
    expect(plan instanceof Map).toBe(true);
    if (!(plan instanceof Map)) return;
    expect(plan.get('CODER')).toMatchObject({ model: 'ornith:9b', reason: 'user-role' });
    expect(plan.get('CODER')?.logLine).toContain('Modèle par rôle');
    expect(plan.get('REVIEWER')).toMatchObject({ model: 'relecteur:b', reason: 'user-role' });
    // Le débogueur sans choix dédié partage le Codeur de mission (un seul modèle chargé).
    expect(plan.get('DEBUGGER')?.model).toBe('ornith:9b');
  });

  it('5.0.78 : un Codeur par rôle absent d’Ollama retombe sur le modèle de code', () => {
    const plan = buildMissionModelPlan(
      'modify',
      { codeModel: 'code:main', roleModels: { CODER: 'absent:xx' } },
      installed,
    );
    expect(plan instanceof Map).toBe(true);
    if (!(plan instanceof Map)) return;
    expect(plan.get('CODER')).toMatchObject({ model: 'code:main', reason: 'code-model' });
  });

  it('respecte le 14B choisi même si un 35B préféré est installé', () => {
    const models = new Set(['qwen2.5-coder:14b', 'qwen3.6:35b-a3b-coding']);
    const plan = buildMissionModelPlan(
      'new-project',
      { codeModel: 'qwen2.5-coder:14b' },
      models,
    );
    expect(plan instanceof Map).toBe(true);
    if (!(plan instanceof Map)) return;
    expect(plan.get('CODER')?.model).toBe('qwen2.5-coder:14b');
    expect(plan.get('CODER')?.logLine).toContain('choisi');
  });
});

describe('codeur qui tient dans 6 Go (pas le modèle de discussion)', () => {
  const installed = new Set([
    'deepseek-coder-v2:16b',
    'qwen2.5-coder:14b',
    'qwen2.5:3b',
    'qwen3.5:4b',
    'qwen3.6:35b-a3b-coding',
    'qwen3.8:latest',
  ]);

  it('préfère le MoE qui tient, pas le 14B ni le chat 4B', () => {
    const choice = chooseCreationCoder({
      selected: 'qwen2.5-coder:14b',
      chatModel: 'qwen3.5:4b',
      installed,
    });
    expect(choice.model).toBe('qwen3.6:35b-a3b-coding');
    expect(choice.pull).toBeNull();
    expect(choice.reason).toMatch(/6 Go/);
  });

  it('préfère le MoE 35B même si un petit codeur dense est installé', () => {
    const choice = chooseCreationCoder({
      selected: 'qwen3.5:4b',
      chatModel: 'qwen3.5:4b',
      installed: new Set([...installed, 'qwen2.5-coder:1.5b']),
    });
    expect(choice.model).toBe('qwen3.6:35b-a3b-coding');
    expect(choice.pull).toBeNull();
  });

  it('ne télécharge rien si seuls des modèles trop gros ou le chat sont là', () => {
    const choice = chooseCreationCoder({
      selected: 'qwen3.5:4b',
      chatModel: 'qwen3.5:4b',
      installed: new Set(['qwen2.5-coder:14b', 'qwen3.5:4b', 'qwen2.5:3b']),
    });
    expect(choice.pull).toBeNull();
    expect(choice.model).not.toBe('qwen2.5-coder:1.5b');
    expect(choice.reason).toMatch(/n’est téléchargé|téléchargé/);
  });

  it('5.0.78 : un 9B dense choisi dans « Modèle par rôle » est gardé (règle 6 Go assouplie), pas un 14B', () => {
    const ornith = 'hf.co/exemple/Ornith-1.0-9B-GGUF:Q4_K_M';
    const sizes = (name: string) => (name === ornith ? '8.95B' : null);
    const kept = chooseCreationCoder({
      selected: ornith,
      chatModel: 'qwen3.5:4b',
      installed: new Set([...installed, ornith]),
      parameterSize: sizes,
      userChosen: true,
    });
    expect(kept.model).toBe(ornith);
    expect(kept.pull).toBeNull();
    expect(kept.reason).toMatch(/Modèle par rôle/);
    // Sans choix explicite, la règle stricte s'applique : le MoE prend la place.
    const auto = chooseCreationCoder({
      selected: ornith,
      chatModel: 'qwen3.5:4b',
      installed: new Set([...installed, ornith]),
      parameterSize: sizes,
    });
    expect(auto.model).toBe('qwen3.6:35b-a3b-coding');
    // Un 14B dense dépasse même la règle assouplie.
    const big = chooseCreationCoder({
      selected: 'qwen2.5-coder:14b',
      chatModel: 'qwen3.5:4b',
      installed,
      userChosen: true,
    });
    expect(big.model).toBe('qwen3.6:35b-a3b-coding');
  });

  it('garde un modèle de test dont la taille est inconnue', () => {
    const choice = chooseCreationCoder({
      selected: 'scripte:mission',
      chatModel: 'qwen3.5:4b',
      installed: new Set(['scripte:mission', 'qwen3.5:4b']),
    });
    expect(choice).toEqual({ model: 'scripte:mission', pull: null, reason: '' });
  });
});
