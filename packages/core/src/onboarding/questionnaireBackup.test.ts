import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { emptyPersonalization } from '../personalization/types.js';
import {
  questionnaireSettingsBackup,
  questionnaireSettingsRestore,
  sanitizeQuestionnaireSetPatch,
} from './questionnaireBackup.js';
import { onboardingPlan } from './plan.js';
import type { OnboardingEnvironment } from './types.js';

const SHORT_RULE = 'Réponds court, en une ou deux phrases quand c’est possible.';
const DETAIL_RULE = 'Détaille tes réponses quand c’est utile, avec des exemples concrets.';

describe('questionnaireSettingsBackup / restore', () => {
  it('persona absent → complice → restore → persona absent, prénom et règles inchangés', () => {
    const base = parseSettings({});
    expect(base.persona).toBeUndefined();

    const personalization = emptyPersonalization();
    personalization.user.prenom = 'Alex';
    personalization.rules = ['Règle perso', SHORT_RULE];

    const backup = questionnaireSettingsBackup(base, personalization);
    expect(backup.absentKeys).toContain('persona');

    const afterApply = parseSettings({
      ...base,
      persona: { enabled: true, style: 'complice', humour: true },
    });
    personalization.user.prenom = 'Bob';
    personalization.rules = [DETAIL_RULE];

    const restoredSettings = questionnaireSettingsRestore(afterApply, backup);
    expect(restoredSettings.persona).toBeUndefined();

    expect(backup.personalization.user.prenom).toBe('Alex');
    expect(backup.personalization.rules).toEqual(['Règle perso', SHORT_RULE]);
  });
});

describe('sanitizeQuestionnaireSetPatch', () => {
  it('n’accepte que answers et dismissed', () => {
    expect(
      sanitizeQuestionnaireSetPatch({
        answers: { firstName: 'Lee' },
        dismissed: true,
        completedAt: 99,
        settingsBackup: { voice: { enabled: true } },
        preferredServices: ['music'],
      }),
    ).toEqual({ answers: { firstName: 'Lee' }, dismissed: true });
  });
});

describe('onboardingPlan — modèles d’orchestre partiels', () => {
  const env = (models: string[]): OnboardingEnvironment => ({
    ollamaModels: models,
    developerRepoValid: false,
    personalization: emptyPersonalization(),
  });

  it('replie les équipes sur le cerveau si leur modèle n’est pas installé', () => {
    const plan = onboardingPlan(
      { orchestra: 'yes' },
      parseSettings({ provider: 'ollama', model: 'qwen2.5:7b' }),
      env(['qwen2.5:7b']),
    );
    expect(plan.patch.orchestra?.enabled).toBe(true);
    expect(plan.patch.orchestra?.brain).toBe('qwen2.5:7b');
    const teams = plan.patch.orchestra?.teams ?? {};
    for (const assignment of Object.values(teams)) {
      expect(assignment?.model).toBe('qwen2.5:7b');
    }
  });
});
