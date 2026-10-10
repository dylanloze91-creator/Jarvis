import { describe, expect, it } from 'vitest';
import {
  defaultNodePlanSuites,
  detectNpmValidationKinds,
  formatTaskVerificationSummary,
  hasNpmTestScript,
  npmValidationCommands,
  verificationCriteriaFromScripts,
} from './projectValidation.js';
import { detectProjectInventory } from './projectInventory.js';

describe('projectValidation', () => {
  it('détecte typecheck, test, lint et build seulement si présents dans package.json', () => {
    const scripts = {
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
      build: 'tsc -p tsconfig.build.json',
      start: 'node dist/index.js',
    };
    expect(detectNpmValidationKinds(scripts)).toEqual(['typecheck', 'lint', 'build']);
    expect(hasNpmTestScript(scripts)).toBe(false);
    expect(npmValidationCommands(scripts)).toEqual([
      'npm run typecheck',
      'npm run lint',
      'npm run build',
    ]);
    expect(defaultNodePlanSuites(scripts)).toEqual(['typecheck']);
    expect(verificationCriteriaFromScripts(scripts)).toEqual([
      'la vérification des types passe',
      'la compilation (build) passe',
    ]);
  });

  it('n’invente pas npm test sans script « test »', () => {
    const inv = detectProjectInventory({
      exists: (rel) => rel === 'package.json',
      readUtf8: () =>
        JSON.stringify({
          name: 'lib',
          scripts: { typecheck: 'tsc --noEmit', build: 'tsc' },
        }),
    });
    expect(inv.validationScripts).not.toContain('npm test');
    expect(inv.validationScripts[0]).toContain('typecheck');
  });

  it('sans script test, le résumé de vérification ne prétend pas que des tests sont passés', () => {
    const scripts = { typecheck: 'tsc --noEmit' };
    const text = formatTaskVerificationSummary(
      [{ suite: 'typecheck', summary: 'réussi' }],
      { scripts },
    );
    expect(text).toContain('typecheck : réussi');
    expect(text).not.toMatch(/tests.*réuss/i);
    expect(text).toContain('aucun script « test »');
  });
});
