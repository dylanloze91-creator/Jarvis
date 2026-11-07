import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { looksLikeQuestionnaireIntent } from './intent.js';
import { onboardingPlan, onboardingPlanFromAnswers } from './plan.js';
import { emptyPersonalization } from '../personalization/types.js';
import type { OnboardingEnvironment } from './types.js';

const env = (models: string[], repoOk = false): OnboardingEnvironment => ({
  ollamaModels: models,
  developerRepoValid: repoOk,
  personalization: emptyPersonalization(),
});

describe('onboardingPlan', () => {
  it('parseSettings({}) ne gagne aucune clé via un plan vide', () => {
    const before = JSON.stringify(parseSettings({}));
    const plan = onboardingPlanFromAnswers({}, parseSettings({}), env([]));
    const after = parseSettings({ ...parseSettings({}), ...plan.patch });
    expect(Object.keys(after)).toEqual(Object.keys(parseSettings({})));
    expect(JSON.stringify(parseSettings({}))).toBe(before);
  });

  it('ne met jamais une politique à never', () => {
    const plan = onboardingPlan(
      { confirmBefore: 'risky' },
      parseSettings({}),
      env([]),
    );
    expect(plan.patch.toolPolicies?.apps).not.toBe('never');
    expect(plan.patch.toolPolicies?.files).not.toBe('never');
    expect(plan.patch.toolPolicies?.capture).not.toBe('never');
  });

  it('n’active pas le chef d’orchestre sans modèles installés', () => {
    const plan = onboardingPlan({ orchestra: 'yes' }, parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' }), env([]));
    expect(plan.patch.orchestra?.enabled).not.toBe(true);
  });

  it('active le chef d’orchestre quand le modèle cerveau est installé', () => {
    const plan = onboardingPlan(
      { orchestra: 'yes' },
      parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' }),
      env(['qwen2.5:7b']),
    );
    expect(plan.patch.orchestra?.enabled).toBe(true);
  });

  it('propose Développeur et missions seulement avec copie valide', () => {
    const without = onboardingPlan({ services: ['code'] }, parseSettings({}), env([], false));
    expect(without.patch.developer?.enabled).not.toBe(true);
    const withRepo = onboardingPlan({ services: ['code'] }, parseSettings({}), env([], true));
    expect(withRepo.patch.developer?.enabled).toBe(true);
    expect(withRepo.patch.developer?.chatMissions).toBe(true);
  });

  it('looksLikeQuestionnaireIntent reconnaît la phrase express', () => {
    expect(looksLikeQuestionnaireIntent('Jarvis, refais le questionnaire')).toBe(true);
    expect(looksLikeQuestionnaireIntent('Quelle météo ?')).toBe(false);
  });
});
