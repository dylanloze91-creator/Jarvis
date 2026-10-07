import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CodeAIProvider } from '../codeProvider.js';
import { createNodeProfile } from './profiles/node.js';
import { JARVIS_PROJECT_PROFILE } from './profiles/jarvis.js';
import { editSystemPrompt, fileWritePrompt, typeErrorLines } from '../taskPrompts.js';
import {
  fallbackFactory,
  fallbackGoal,
  fallbackSkill,
  projectNameFromRequest,
  steerFactory,
  templatePlan,
} from './fallbacks.js';
import { STEP_LIMITS, retryLimit, withDeadline } from './limits.js';
import { SpecialistError, runSpecialist } from './specialist.js';
import {
  TEMPLATE_GUIDES,
  TEMPLATE_STRUCTURE,
  factorySchema,
  factorySystem,
  renderTemplate,
} from './templates.js';

const usage = {
  promptTokens: 0,
  promptMs: 0,
  outputTokens: 0,
  outputMs: 0,
  loadMs: 0,
  totalMs: 0,
};

/** Faux fournisseur : `reply` reçoit le plafond de jetons et le signal de chaque réponse. */
function provider(
  reply: (input: { maxTokens?: number; signal?: AbortSignal; prompt: string }) => Promise<string>,
): CodeAIProvider {
  return {
    id: 'ollama',
    model: 'petit:modele',
    baseUrl: 'http://127.0.0.1:11434',
    locality: 'local',
    complete: async (input) => ({ text: await reply(input), usage }),
    runTools: async (input) => {
      try {
        const text = await reply({ ...input, prompt: input.prompt });
        return { finalText: text, calls: [], rounds: 1, stoppedBy: 'answer', error: null, usage };
      } catch (error) {
        return {
          finalText: '',
          calls: [],
          rounds: 1,
          stoppedBy: 'error',
          error: error instanceof Error ? error.message : String(error),
          usage,
        };
      }
    },
  } as unknown as CodeAIProvider;
}

const waitForAbort = (signal?: AbortSignal) =>
  new Promise<string>((_, reject) => {
    if (signal?.aborted) return reject(new Error('This operation was aborted'));
    signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')), {
      once: true,
    });
  });

describe('plafonds des spécialistes (5.0.1)', () => {
  it('chaque étape a un plafond de jetons et une durée ; la relance est plus courte', () => {
    for (const limit of Object.values(STEP_LIMITS)) {
      expect(limit.maxTokens).toBeGreaterThan(0);
      expect(limit.timeoutMs).toBeGreaterThan(0);
    }
    expect(STEP_LIMITS.goal.maxTokens).toBeLessThanOrEqual(600);
    expect(retryLimit(STEP_LIMITS.edit)).toEqual({ maxTokens: 600, timeoutMs: 12.5 * 60_000 });
  });

  it('withDeadline : échéance distinguée d’une annulation par l’utilisateur', async () => {
    const short = withDeadline(undefined, 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(short.signal.aborted).toBe(true);
    expect(short.expired()).toBe(true);
    const user = new AbortController();
    const long = withDeadline(user.signal, 10_000);
    user.abort();
    expect(long.signal.aborted).toBe(true);
    expect(long.expired()).toBe(false);
    long.dispose();
  });

  it('un modèle qui parle sans JSON : plafond transmis, une relance courte, puis erreur « format »', async () => {
    const seen: Array<number | undefined> = [];
    const code = provider(async ({ maxTokens }) => {
      seen.push(maxTokens);
      return 'Je vais réfléchir longuement à cette demande… '.repeat(20);
    });
    const error = await runSpecialist(code, {
      role: 'REASONER',
      system: 's',
      prompt: 'p',
      schema: z.object({ goal: z.string() }),
      limit: STEP_LIMITS.goal,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpecialistError);
    expect((error as SpecialistError).kind).toBe('format');
    expect(seen).toEqual([600, 600]);
  });

  it('un modèle trop lent : arrêté au délai, erreur « timeout », sans attendre la fin', async () => {
    const code = provider(({ signal }) => waitForAbort(signal));
    const started = Date.now();
    for (const tools of [undefined, { schemas: () => [], execute: async () => ({}) as never }]) {
      const error = await runSpecialist(code, {
        role: 'ARCHITECT',
        system: 's',
        prompt: 'p',
        schema: z.object({ x: z.string() }),
        ...(tools ? { tools } : {}),
        limit: { maxTokens: 100, timeoutMs: 30 },
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SpecialistError);
      expect((error as SpecialistError).kind).toBe('timeout');
      expect((error as SpecialistError).message).toMatch(/délai dépassé/);
    }
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('annulation par l’utilisateur : jamais prise pour un délai', async () => {
    const user = new AbortController();
    const code = provider(({ signal }) => waitForAbort(signal));
    const pending = runSpecialist(code, {
      role: 'REASONER',
      system: 's',
      prompt: 'p',
      schema: z.object({ goal: z.string() }),
      limit: STEP_LIMITS.goal,
      signal: user.signal,
    }).catch((e: unknown) => e);
    user.abort();
    const error = await pending;
    expect(error instanceof SpecialistError && error.kind === 'timeout').toBe(false);
  });
});

describe('secours sans modèle (5.0.1)', () => {
  const PONG = 'Crée un Pong jouable dans le navigateur : deux raquettes, une balle, le score.';

  it('objectif de secours : la demande, des critères, aucune question', () => {
    expect(fallbackGoal(PONG, 'new-project')).toEqual({
      goal: PONG,
      questions: [],
      criteria: [
        'le projet est créé et ses dépendances s’installent',
        'le code demandé est écrit',
        'les tests du projet passent',
      ],
      constraints: [],
    });
    expect(fallbackGoal('Ajoute un réglage', 'modify').criteria).toEqual([
      'les tests ne montrent aucun nouvel échec',
    ]);
  });

  it('gabarit et nom par règles fixes', () => {
    expect(fallbackFactory(PONG)).toMatchObject({ template: 'web-game', name: 'Pong' });
    expect(fallbackFactory('Crée un snake').template).toBe('web-game');
    expect(fallbackFactory('Crée une appli Windows qui bloque des sites').template).toBe(
      'dotnet-winforms',
    );
    expect(fallbackFactory('Crée un site pour mes recettes').template).toBe('vite-react');
    expect(fallbackFactory('Crée une petite CLI qui renomme des photos').template).toBe('node-cli');
    expect(projectNameFromRequest('Crée une petite CLI qui renomme des photos')).toBe(
      'CLI qui renomme',
    );
    expect(fallbackSkill('Crée une compétence 3D').tools[0]!.name).toBe('outil_principal');
  });

  it('un jeu part du gabarit jeu, même si l’ARCHITECTE en choisit un autre', () => {
    const react = { template: 'vite-react' as const, name: 'Pong Electron', description: '' };
    expect(steerFactory(PONG, react)).toEqual({ ...react, template: 'web-game' });
    expect(steerFactory('Crée un site pour mes recettes', react)).toBe(react);
    const wpf = { template: 'dotnet-wpf' as const, name: 'Morpion', description: '' };
    expect(steerFactory('Crée un morpion, appli Windows WPF', wpf)).toBe(wpf);
  });

  it('plan de secours : les fichiers d’entrée du gabarit', () => {
    expect(templatePlan('web-game', PONG)).toMatchObject({
      files: [
        { path: 'src/game.ts', action: 'edit' },
        { path: 'src/rules.ts', action: 'edit' },
        { path: 'src/game.test.ts', action: 'edit' },
      ],
      tests: ['typecheck', 'test'],
    });
    expect(templatePlan('dotnet-wpf', PONG)).toBeNull();
  });
});

describe('correction fichier par fichier (5.0.1)', () => {
  const current = [
    'export function update(state: State): State {',
    '  const { x } = state;',
    '  x += 1;',
    '  return { ...state, x: this.x };',
    '}',
  ].join('\n');
  const excerpt = [
    "src/game.ts(3,3): error TS2588: Cannot assign to 'x' because it is a constant.",
    "src/game.ts(4,25): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.",
    "src/game.ts(3,3): error TS2588: Cannot assign to 'x' because it is a constant.",
    "src/other.ts(1,1): error TS2304: Cannot find name 'y'.",
  ].join('\n');

  it('chaque erreur de typage du fichier : sa ligne, son code et un conseil', () => {
    expect(typeErrorLines('src/game.ts', current, [excerpt])).toEqual([
      "- ligne 3 `x += 1;` : TS2588 Cannot assign to 'x' because it is a constant. → déclarée avec const (y compris `const { … } = …`) : déclare-la avec let, ou modifie une copie (`const next = { ...state }`, puis `next.x = …`)",
      "- ligne 4 `return { ...state, x: this.x };` : TS2683 'this' implicitly has type 'any' because it does not have a type annotation. → pas de this hors d’une classe : passe l’état en paramètre",
    ]);
  });

  it('la consigne de correction les cite avant les sorties brutes', () => {
    const prompt = fileWritePrompt({
      request: 'Crée un Pong',
      path: 'src/game.ts',
      current,
      related: [],
      failures: ["tsc src/game.ts TS2588 Cannot assign to 'x' because it is a constant."],
      excerpts: [excerpt],
    });
    const typed = prompt.indexOf('Lignes de src/game.ts refusées par TypeScript');
    expect(typed).toBeGreaterThan(0);
    expect(typed).toBeLessThan(prompt.indexOf('Extraits des sorties'));
    expect(prompt).not.toContain('ligne 1 ');
    expect(
      fileWritePrompt({
        request: 'r',
        path: 'src/game.ts',
        current: null,
        related: [],
        excerpts: [excerpt],
      }),
    ).not.toContain('refusées par TypeScript');
  });
});

describe('gabarit « jeu dans le navigateur » (5.0.7)', () => {
  it('gabarit neutre : compile, boucle canvas, tests minimaux', () => {
    const files = renderTemplate('web-game', {
      packageName: 'snake',
      title: 'Snake',
      description: '',
    });
    const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
    expect(Object.keys(byPath)).toEqual(
      expect.arrayContaining([
        'index.html',
        'src/main.ts',
        'src/rules.ts',
        'src/game.ts',
        'src/game.test.ts',
      ]),
    );
    const pkg = JSON.parse(byPath['package.json']!);
    expect(pkg.scripts).toMatchObject({ typecheck: 'tsc --noEmit', test: 'vitest run' });
    expect(byPath['src/main.ts']).toContain('requestAnimationFrame');
    expect(byPath['src/game.ts']).toMatch(/export function createGame/);
    expect(byPath['src/game.ts']).not.toMatch(/\bball\b/);
    expect(byPath['src/game.test.ts']!.match(/\bit\(/g)).toHaveLength(2);
    expect(TEMPLATE_GUIDES['web-game']).toMatch(/pas de jeu jouable|Point de départ/i);
    expect(factorySchema.parse({ template: 'jeu', name: 'Snake' }).template).toBe('web-game');
    expect(factorySystem()).toContain('"web-game"');
    expect(TEMPLATE_GUIDES['web-game']).toMatch(/tests|game\.test/i);
    expect(TEMPLATE_STRUCTURE['web-game']).toEqual([
      'index.html',
      'src/main.ts',
      'src/game.test.ts',
    ]);
  });

  it('projets : consigne de réécriture d’un fichier entier ; Jarvis inchangé', () => {
    const plan = { summary: 's', criteria: [], files: [], tests: [] };
    const node = createNodeProfile({ id: 'pong', name: 'Pong', scripts: { test: 'vitest run' } });
    expect(editSystemPrompt(plan, node)).toContain('dev_write_file');
    expect(editSystemPrompt(plan, JARVIS_PROJECT_PROFILE)).not.toContain('dev_write_file');
  });
});
