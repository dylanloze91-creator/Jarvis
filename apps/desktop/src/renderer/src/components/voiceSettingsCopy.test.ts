import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_VOICE_SURFACE_TERMS,
  VOICE_DIAGNOSTIC_INTRO,
  VOICE_WAKE_TEST_INTRO,
} from './voiceSettingsCopy';

describe('voiceSettingsCopy — surface simple', () => {
  it('évite les noms techniques au premier niveau', () => {
    for (const term of FORBIDDEN_VOICE_SURFACE_TERMS) {
      expect(VOICE_WAKE_TEST_INTRO).not.toContain(term);
      expect(VOICE_DIAGNOSTIC_INTRO).not.toContain(term);
    }
  });
});
