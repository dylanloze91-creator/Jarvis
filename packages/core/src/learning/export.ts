import type { LocalLearningExample } from './types.js';

/** Format messages ChatML / instruction pour SFT (une ligne JSON par exemple). */
export function examplesToJsonl(examples: LocalLearningExample[]): string {
  const lines: string[] = [];
  for (const ex of examples) {
    // Une correction signale une mauvaise réponse : elle n’entre pas dans le jeu d’entraînement.
    if (ex.correction?.trim()) continue;
    const user = ex.user.trim();
    const assistant = ex.assistant.trim();
    if (!user || !assistant) continue;
    lines.push(
      JSON.stringify({
        messages: [
          { role: 'user', content: user },
          { role: 'assistant', content: assistant },
        ],
      }),
    );
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export const MIN_EXAMPLES_FOR_TRAIN = 6;
