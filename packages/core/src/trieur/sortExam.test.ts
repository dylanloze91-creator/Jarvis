import { describe, expect, it } from 'vitest';
import { dropLastExamLine } from './sortExam.js';

describe('trieur sort exam file', () => {
  it('retire la dernière ligne classée', () => {
    const first = `${JSON.stringify({ team: 'pc' })}\n`;
    const second = `${JSON.stringify({ team: 'web' })}\n`;
    const result = dropLastExamLine(`${first}${second}`);
    expect(result.removed).toBe(true);
    expect(result.content).toBe(first);
    expect(dropLastExamLine('').removed).toBe(false);
  });
});
