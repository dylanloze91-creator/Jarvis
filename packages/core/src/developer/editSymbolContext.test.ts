import { describe, expect, it } from 'vitest';
import { buildEditSymbolContext, isSkippedSymbolPath } from './editSymbolContext.js';
import type { ReviewedPlan } from './taskPolicy.js';

describe('buildEditSymbolContext', () => {
  const plan: ReviewedPlan = {
    summary: 'Exporter createToolManager',
    criteria: ['tests verts'],
    files: [
      {
        path: 'src/guessed-tools.ts',
        action: 'edit',
        reason: 'createToolManager',
        problem: 'fichier introuvable',
        core: null,
        exists: false,
      },
    ],
    tests: ['typecheck'],
  };

  it('ignore node_modules et dossiers de build', () => {
    expect(isSkippedSymbolPath('node_modules/foo/index.js')).toBe(true);
    expect(isSkippedSymbolPath('apps/desktop/out/main.js')).toBe(true);
    expect(isSkippedSymbolPath('packages/core/src/index.ts')).toBe(false);
  });

  it('n’utilise pas le fichier deviné quand le symbole est ailleurs', async () => {
    const real = 'apps/desktop/src/main/tools/index.ts';
    const result = await buildEditSymbolContext({
      request: 'Où est enregistré createToolManager ? Modifie-le.',
      plan,
      exists: (p) => p === real,
      search: async (pattern) => {
        if (pattern === 'createToolManager') {
          return [
            {
              file: real,
              line: 12,
              text: 'export function createToolManager(registry: ProviderRegistry)',
            },
          ];
        }
        return [];
      },
    });
    expect(result.resolutions[0]?.resolvedPath).toBe(real);
    expect(result.resolutions[0]?.plannedPath).toBe('src/guessed-tools.ts');
    expect(result.plan.files[0]?.path).toBe(real);
    expect(result.block).toContain(real);
    expect(result.block).toContain('pas `src/guessed-tools.ts`');
  });
});
