import { describe, expect, it } from 'vitest';
import { classifyCommand } from './commandSafety.js';
import { CodeModelFormatError } from './codeSchemas.js';
import { MAX_TEST_SERIES, orderSuites, suiteCommand, TEST_SUITE_IDS } from './taskPlan.js';
import {
  approvalFromPlan,
  planCoverage,
  reviewPlan,
  sandboxBranch,
  slugify,
} from './taskPolicy.js';
import { parsePlanReply } from './taskPrompts.js';

const existing = new Set([
  'apps/desktop/src/main/tools/index.ts',
  'packages/core/src/web/format.ts',
]);
const exists = (path: string) => existing.has(path);

describe('plan proposé par le modèle', () => {
  it('JSON en français, dans un bloc de code', () => {
    const plan = parsePlanReply(
      'Voici le plan :\n```json\n{"resume": "Ajouter un outil version", "criteres": ["tsc passe"], "fichiers": [{"chemin": "apps/desktop/src/main/tools/version.ts", "action": "créer", "pourquoi": "nouvel outil"}, {"chemin": "apps/desktop/src/main/tools/index.ts", "action": "modifier"}], "tests": ["test-desktop"]}\n```',
    );
    expect(plan).toEqual({
      summary: 'Ajouter un outil version',
      criteria: ['tsc passe'],
      files: [
        {
          path: 'apps/desktop/src/main/tools/version.ts',
          action: 'create',
          reason: 'nouvel outil',
        },
        { path: 'apps/desktop/src/main/tools/index.ts', action: 'edit', reason: '' },
      ],
      tests: ['typecheck', 'test-desktop'],
    });
  });

  it('JSON en anglais accepté ; tests inconnus ignorés ; défaut si aucun', () => {
    const plan = parsePlanReply(
      '{"summary": "s", "files": [{"path": "a.ts", "action": "modify"}], "tests": ["rm -rf /"]}',
    );
    expect(plan.files[0]).toMatchObject({ path: 'a.ts', action: 'edit' });
    expect(plan.tests).toEqual(['typecheck', 'test-core']);
  });

  it('sans fichier ou sans JSON : erreur de format à renvoyer au modèle', () => {
    expect(() => parsePlanReply('{"resume": "rien"}')).toThrow(CodeModelFormatError);
    expect(() => parsePlanReply('Je vais réfléchir.')).toThrow(CodeModelFormatError);
  });

  it('la vérification des types passe toujours en premier ; « test » couvre les deux espaces', () => {
    expect(orderSuites(['lint', 'test-core'])).toEqual(['typecheck', 'test-core', 'lint']);
    expect(orderSuites(['test', 'test-desktop'])).toEqual(['typecheck', 'test']);
  });
});

describe('contrôle du plan par Jarvis', () => {
  const plan = reviewPlan(
    {
      summary: 's',
      criteria: [],
      files: [
        { path: 'apps/desktop/src/main/tools/version.ts', action: 'create', reason: '' },
        { path: 'apps\\desktop\\src\\main\\tools\\index.ts', action: 'edit', reason: '' },
        { path: 'packages/core/src/web/format.ts', action: 'delete', reason: '' },
        { path: '../hors.ts', action: 'edit', reason: '' },
        { path: '.env', action: 'create', reason: '' },
        { path: 'manquant.ts', action: 'edit', reason: '' },
      ],
      tests: ['typecheck'],
    },
    exists,
  );

  it('cœur, chemins refusés et fichiers introuvables marqués par Jarvis', () => {
    expect(plan.files.map((f) => [f.path, f.action, Boolean(f.core), f.problem])).toEqual([
      ['apps/desktop/src/main/tools/version.ts', 'create', false, null],
      ['apps/desktop/src/main/tools/index.ts', 'edit', true, null],
      ['packages/core/src/web/format.ts', 'delete', false, null],
      ['../hors.ts', 'edit', true, 'chemin invalide (absolu ou avec « .. »)'],
      ['.env', 'create', false, expect.stringContaining('protégé')],
      ['manquant.ts', 'edit', false, 'fichier introuvable'],
    ]);
  });

  it('décision 9 : la validation couvre les fichiers hors cœur du plan et les tests de la liste', () => {
    const approval = approvalFromPlan(plan, 'jarvis-dev/2026-10-02-version');
    const cover = (request: Parameters<typeof planCoverage>[1]) => planCoverage(approval, request);
    expect(cover({ kind: 'write', path: 'apps/desktop/src/main/tools/version.ts' }).covered).toBe(
      true,
    );
    expect(cover({ kind: 'write', path: 'Apps/Desktop/src/main/tools/VERSION.ts' }).covered).toBe(
      true,
    );
    expect(cover({ kind: 'write', path: 'apps/desktop/src/main/tools/index.ts' })).toEqual({
      covered: false,
      reason:
        'fichier du cœur (registre des outils, commandes et suppressions) : toujours confirmé',
    });
    expect(cover({ kind: 'write', path: 'apps/desktop/src/main/tools/autre.ts' }).reason).toBe(
      'fichier hors du plan validé',
    );
    expect(cover({ kind: 'write', path: '.env' }).covered).toBe(false);
    expect(cover({ kind: 'write', path: 'manquant.ts' }).covered).toBe(false);
    expect(cover({ kind: 'delete', path: 'packages/core/src/web/format.ts' }).covered).toBe(false);
    expect(cover({ kind: 'tests', suite: 'typecheck', series: MAX_TEST_SERIES }).covered).toBe(
      true,
    );
    expect(cover({ kind: 'tests', suite: 'typecheck', series: MAX_TEST_SERIES + 1 }).covered).toBe(
      false,
    );
    expect(cover({ kind: 'tests', suite: 'lint', series: 1 }).covered).toBe(false);
    expect(cover({ kind: 'branch', branch: 'jarvis-dev/2026-10-02-version' }).covered).toBe(true);
    expect(cover({ kind: 'branch', branch: 'main' }).covered).toBe(false);
    for (const kind of ['rollback', 'discard', 'install'] as const)
      expect(cover({ kind }).covered).toBe(false);
    expect(cover({ kind: 'other', toolName: 'run_command' }).covered).toBe(false);
    expect(planCoverage(null, { kind: 'write', path: 'x.ts' }).covered).toBe(false);
  });
});

describe('branches et commandes de test', () => {
  it('jarvis-dev/<date>-<sujet>, ASCII, court', () => {
    expect(
      sandboxBranch(new Date('2026-10-02T10:00:00Z'), 'Ajoute un outil qui donne ta version !'),
    ).toBe('jarvis-dev/2026-10-02-ajoute-un-outil-qui-donne-ta-version');
    expect(slugify('Équipe — « été » ; ça marche ? œuvre')).toBe('equipe-ete-ca-marche-ouvre');
    expect(slugify('x'.repeat(60))).toHaveLength(40);
    expect(slugify('!!!')).toBe('tache');
  });

  it('chaque test de la liste fixe est automatique dans la copie isolée, à confirmer ailleurs', () => {
    for (const id of TEST_SUITE_IDS) {
      const command = suiteCommand(id);
      expect(
        classifyCommand(command, { insideSandbox: true, branch: 'jarvis-dev/2026-10-02-x' }).level,
      ).toBe('auto');
      expect(classifyCommand(command, {}).level).toBe('confirm');
    }
  });
});
