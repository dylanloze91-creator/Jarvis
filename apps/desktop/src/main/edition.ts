import { createRequire } from 'node:module';
import { edition as resolveEdition, type Edition } from '@jarvis/core';

function bakedEdition(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { jarvisEdition?: unknown };
    return typeof pkg.jarvisEdition === 'string' ? pkg.jarvisEdition : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Édition de ce processus. `JARVIS_EDITION=test` en développement.
 * L'installateur de Test porte `jarvisEdition: "test"` dans son package.json
 * (écrit à la construction, pas dans le dépôt). Sans les deux : Live.
 */
export function edition(): Edition {
  return resolveEdition({ env: process.env.JARVIS_EDITION, baked: bakedEdition() });
}
