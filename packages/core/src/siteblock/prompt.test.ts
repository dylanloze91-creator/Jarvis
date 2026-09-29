import { describe, expect, it } from 'vitest';
import { SITEBLOCK_SYSTEM_PROMPT_FRAGMENT, withSiteBlockPrompt } from './prompt.js';

describe('withSiteBlockPrompt', () => {
  it('ajoute la consigne si le prompt n’en parle pas', () => {
    const result = withSiteBlockPrompt('Tu es Jarvis.');
    expect(result).toContain('Tu es Jarvis.');
    expect(result).toContain('siteblock_');
  });

  it('ne duplique pas la consigne déjà présente', () => {
    const already = `Tu es Jarvis. ${SITEBLOCK_SYSTEM_PROMPT_FRAGMENT}`;
    expect(withSiteBlockPrompt(already)).toBe(already);
  });
});
