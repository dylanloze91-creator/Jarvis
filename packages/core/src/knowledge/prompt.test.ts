import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_SYSTEM_PROMPT_FRAGMENT, withKnowledgePrompt } from './prompt.js';

describe('withKnowledgePrompt', () => {
  it('ajoute le fragment s’il est absent', () => {
    const result = withKnowledgePrompt('Tu es Jarvis.');
    expect(result).toContain('Tu es Jarvis.');
    expect(result).toContain(KNOWLEDGE_SYSTEM_PROMPT_FRAGMENT);
  });

  it('n’ajoute pas le fragment une seconde fois', () => {
    const already = `Tu es Jarvis. ${KNOWLEDGE_SYSTEM_PROMPT_FRAGMENT}`;
    expect(withKnowledgePrompt(already)).toBe(already);
  });
});
