import { describe, expect, it } from 'vitest';
import { normalizeRepoRelative } from '../repoPaths.js';
import { orderSuites } from '../taskPlan.js';
import { planCoverage, reviewPlan, approvalFromPlan } from '../taskPolicy.js';
import { parsePlanReply, planSystemPrompt } from '../taskPrompts.js';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import { createNodeProfile, nodeProtectedReason, nodeSuites } from './profiles/node.js';
import {
  JARVIS_DEFAULT_MEMORY,
  NEW_PROJECT_SCOPE,
  memoryBlock,
  projectEntrySchema,
  projectIdFor,
} from './project.js';
import { MISSION_CHAINS, rolesWithoutModel, suggestMissionKind } from './router.js';
import {
  FACTORY_MARKER,
  PROJECT_TEMPLATE_IDS,
  factorySchema,
  factorySystem,
  renderTemplate,
} from './templates.js';

const scripts = { typecheck: 'tsc --noEmit', test: 'vitest run', build: 'tsc' };
const profile = createNodeProfile({ id: 'photos', name: 'Photos par date', scripts });

describe('profil Node générique (0.5.3)', () => {
  it('tests = scripts automatiques présents dans package.json', () => {
    expect(nodeSuites(scripts)).toEqual(['typecheck', 'test']);
    expect(nodeSuites({ ...scripts, lint: 'eslint .' })).toEqual(['typecheck', 'test', 'lint']);
    expect(nodeSuites({ build: 'tsc' })).toEqual([]);
    expect(Object.keys(profile.testSuites)).toEqual(['typecheck', 'test']);
    expect(profile.defaultTestSuites).toEqual(['typecheck', 'test']);
  });

  it('fichiers protégés : dépendances et configuration, pas le code', () => {
    expect(nodeProtectedReason('package.json')).toMatch(/dépendances/);
    expect(nodeProtectedReason('package-lock.json')).toMatch(/dépendances/);
    expect(nodeProtectedReason('tsconfig.build.json')).toMatch(/configuration/);
    expect(nodeProtectedReason('vite.config.ts')).toMatch(/configuration/);
    expect(nodeProtectedReason('.github/workflows/ci.yml')).toMatch(/configuration/);
    expect(nodeProtectedReason('src/main.ts')).toBeNull();
    expect(nodeProtectedReason('packages/core/src/agent/x.ts')).toBeNull();
    expect(nodeProtectedReason('../x.ts')).toBe('chemin invalide');
  });

  it('consigne de plan : contexte du projet et ses seuls tests ; Jarvis inchangé', () => {
    const text = planSystemPrompt(profile);
    expect(text).toContain('Dépôt : Photos par date, projet Node.js / TypeScript');
    expect(text).toContain(
      'Tests possibles : "typecheck" (Vérification des types), "test" (Tous les tests).',
    );
    expect(text).toContain('"tests": ["typecheck", "test"]');
    expect(text).not.toContain('test-core');
    expect(planSystemPrompt()).toBe(planSystemPrompt(JARVIS_PROJECT_PROFILE));
  });

  it('plan : tests hors du projet ignorés, défauts du projet sinon', () => {
    const reply = (tests: string[]) =>
      JSON.stringify({
        resume: 'x',
        fichiers: [{ chemin: 'src/a.ts', action: 'creer' }],
        tests,
      });
    expect(parsePlanReply(reply(['test-core']), profile).tests).toEqual(['typecheck', 'test']);
    expect(parsePlanReply(reply(['test']), profile).tests).toEqual(['typecheck', 'test']);
    expect(parsePlanReply(reply(['test-core']), JARVIS_PROJECT_PROFILE).tests).toEqual([
      'typecheck',
      'test-core',
    ]);
    expect(orderSuites(['test'], ['test'])).toEqual(['test']);
  });

  it('revue du plan et validation : la règle du projet décide de ce qui redemande', () => {
    const reviewed = reviewPlan(
      {
        summary: 's',
        criteria: [],
        files: [
          { path: 'src/a.ts', action: 'create', reason: '' },
          { path: 'package.json', action: 'edit', reason: '' },
          { path: 'packages/core/src/agent/x.ts', action: 'create', reason: '' },
        ],
        tests: ['typecheck', 'test'],
      },
      (p) => p === 'package.json',
      nodeProtectedReason,
    );
    expect(reviewed.files.map((f) => f.core)).toEqual([null, 'dépendances et scripts npm', null]);
    const approval = approvalFromPlan(reviewed, 'jarvis-dev/x');
    expect(
      planCoverage(approval, { kind: 'write', path: 'package.json' }, nodeProtectedReason).covered,
    ).toBe(false);
    expect(
      planCoverage(
        approval,
        { kind: 'write', path: 'packages/core/src/agent/x.ts' },
        nodeProtectedReason,
      ).covered,
    ).toBe(true);
    expect(
      planCoverage(approval, { kind: 'write', path: 'packages/core/src/agent/x.ts' }).covered,
    ).toBe(false);
  });
});

describe('registre et mémoire des projets', () => {
  it('identifiants : tirés du nom, uniques, jamais réservés', () => {
    expect(projectIdFor('Photos par date', new Set())).toBe('photos-par-date');
    expect(projectIdFor('Photos par date', new Set(['photos-par-date']))).toBe('photos-par-date-2');
    expect(projectIdFor('Jarvis', new Set())).toBe('jarvis-2');
    expect(projectIdFor(NEW_PROJECT_SCOPE, new Set())).toBe(`${NEW_PROJECT_SCOPE}-2`);
    expect(projectIdFor('!!!', new Set())).toBe('tache');
    const entry = {
      name: 'x',
      path: '/p',
      kind: 'node',
      origin: 'created',
      createdAt: 1,
    };
    expect(projectEntrySchema.safeParse({ ...entry, id: 'jarvis' }).success).toBe(false);
    expect(projectEntrySchema.safeParse({ ...entry, id: 'photos' }).success).toBe(true);
    expect(projectEntrySchema.safeParse({ ...entry, id: '../x' }).success).toBe(false);
  });

  it('mémoire : notes puis missions récentes, bornée', () => {
    const block = memoryBlock('Pas de dépendance réseau.', [
      {
        id: 'a',
        kind: 'modify',
        request: 'Ajoute --dry-run',
        status: 'finished',
        verdict: 'success',
        createdAt: 2,
        updatedAt: 2,
      },
    ]);
    expect(block).toBe(
      'Pas de dépendance réseau.\nMissions récentes :\n- Modifier ou ajouter « Ajoute --dry-run » : réussie',
    );
    expect(memoryBlock('x'.repeat(5_000), []).length).toBe(2_000);
    expect(JARVIS_DEFAULT_MEMORY).toContain('CLAUDE.md');
  });
});

describe('Project Factory : gabarits locaux', () => {
  it.each(PROJECT_TEMPLATE_IDS)('%s : package.json avec typecheck et test, chemins sûrs', (id) => {
    const files = renderTemplate(id, {
      packageName: 'photos-par-date',
      title: 'Photos <par> date',
      description: 'Renomme des photos.\nPar date.',
    });
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(normalizeRepoRelative(path)).toBe(path);
    expect(paths).toEqual(expect.arrayContaining(['package.json', 'README.md', '.gitignore']));
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content);
    expect(pkg.name).toBe('photos-par-date');
    expect(pkg.description).toBe('Renomme des photos. Par date.');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(Object.keys(pkg.scripts)).not.toContain('postinstall');
    expect(files.some((f) => /\.test\.ts$/.test(f.path))).toBe(true);
    expect(files.find((f) => f.path === '.gitignore')!.content).toContain('node_modules/');
  });

  it('choix de l’architecte : gabarit de la liste (alias acceptés), nom requis', () => {
    expect(factorySchema.parse({ template: 'CLI', name: 'Photos' }).template).toBe('node-cli');
    expect(factorySchema.parse({ template: 'site', name: 'Vitrine' }).template).toBe('vite-react');
    expect(factorySchema.safeParse({ template: 'rust', name: 'x' }).success).toBe(false);
    expect(factorySchema.safeParse({ template: 'ts-lib', name: '' }).success).toBe(false);
    expect(factorySystem()).toContain(FACTORY_MARKER);
  });

  it('routeur : « crée une petite CLI… » propose un nouveau projet ; le reste ne change pas', () => {
    expect(suggestMissionKind('Crée une petite CLI qui renomme des photos par date')).toBe(
      'new-project',
    );
    expect(suggestMissionKind('Nouveau projet : un site pour mes recettes')).toBe('new-project');
    expect(suggestMissionKind('Ajoute un réglage pour le thème')).toBe('modify');
    expect(suggestMissionKind('Crée un test pour formatSeconds')).toBe('modify');
    expect(MISSION_CHAINS['new-project'].map((s) => s.actor)).toEqual([
      'REASONER',
      'ARCHITECT',
      'USER',
    ]);
    expect(rolesWithoutModel('new-project', { codeModel: '' })).toContain('ARCHITECT');
  });
});
