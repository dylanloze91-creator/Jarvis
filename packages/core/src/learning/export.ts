import type { LocalLearningExample } from './types.js';

/** Format messages ChatML / instruction pour SFT (une ligne JSON par exemple). */
export function examplesToJsonl(examples: LocalLearningExample[]): string {
  const lines: string[] = [];
  for (const ex of examples) {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'user', content: ex.user },
      { role: 'assistant', content: ex.assistant },
    ];
    if (ex.correction?.trim()) {
      messages.push({ role: 'user', content: ex.correction.trim() });
      messages.push({
        role: 'assistant',
        content: ex.assistant,
      });
    }
    lines.push(JSON.stringify({ messages }));
  }
  return `${lines.join('\n')}\n`;
}

export const MIN_EXAMPLES_FOR_TRAIN = 6;
