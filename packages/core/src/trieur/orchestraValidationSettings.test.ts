import { describe, expect, it } from 'vitest';
import { teamValidationEnabled } from './validationSettings.js';

describe('OrchestraSettings — validation des équipes', () => {
  it('n’active la validation que si dossier et interrupteur sont présents', () => {
    expect(teamValidationEnabled(undefined)).toBe(false);
    expect(teamValidationEnabled({ enabled: true, brain: 'x', teamValidation: true })).toBe(false);
    expect(
      teamValidationEnabled({
        enabled: true,
        brain: 'x',
        trieurDataDir: 'C:\\data\\trieur',
        teamValidation: true,
      }),
    ).toBe(true);
  });
});
