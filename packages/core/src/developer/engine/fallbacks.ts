import type { TaskPlan } from '../taskPlan.js';
import type { MissionKind } from './router.js';
import type { SkillDesign } from './skill.js';
import type { GoalOutput } from './specialistSchemas.js';
import type { FactoryOutput, ProjectTemplateId } from './templates.js';

/**
 * Secours sans modèle (5.0.1) : quand un spécialiste ne rend pas de JSON
 * valide après sa relance (ou dépasse son délai), la mission continue à
 * partir de la phrase de l'utilisateur au lieu de s'arrêter.
 */

function clean(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Objectif de secours : la demande elle-même, des critères vérifiables, aucune question. */
export function fallbackGoal(request: string, kind: MissionKind): GoalOutput {
  const goal = clean(request).slice(0, 300);
  const criteria =
    kind === 'new-project' || kind === 'skill'
      ? [
          'le projet est créé et ses dépendances s’installent',
          'le code demandé est écrit',
          'les tests du projet passent',
        ]
      : kind === 'document'
        ? ['la documentation demandée est écrite en Markdown']
        : ['les tests ne montrent aucun nouvel échec'];
  return { goal, questions: [], criteria, constraints: [] };
}

const GAME =
  /\b(jeu|jeux|game|pong|snake|tetris|casse[- ]briques?|breakout|morpion|tic[- ]tac[- ]toe|flappy|space invaders|labyrinthe|platformer|asteroids?)\b/i;
const WINDOWS = /\b(appli(cation)? windows|winforms|wpf|fenêtre windows)\b/i;
const WEB = /\b(site|page web|navigateur|web|react|interface web)\b/i;
const LIBRARY = /\b(bibliothèque|bibliotheque|librairie|library|module réutilisable)\b/i;
const NAMED = /\b(pong|snake|tetris|morpion|breakout|flappy|asteroids?)\b/i;

/** Nom court tiré de la demande : un jeu connu, sinon les premiers mots utiles. */
export function projectNameFromRequest(request: string): string {
  const named = NAMED.exec(request)?.[1];
  if (named) return named[0]!.toUpperCase() + named.slice(1).toLowerCase();
  const words = clean(request)
    .replace(
      /^(créer|creer|crée|cree|fais|fabrique|génère|genere|écris|ecris)(-moi)?\s+(moi\s+)?(une|un|le|la|des)?\s*(petite|petit|nouvelle|nouveau|simple)?\s*(projet|application|appli|programme|outil)?\s*[:,-]?\s*/i,
      '',
    )
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .slice(0, 3);
  const name = words.join(' ').trim();
  return name ? name[0]!.toUpperCase() + name.slice(1) : 'Mon projet';
}

/** Gabarit et nom de secours, par règles fixes, si l'ARCHITECTE ne répond pas au format. */
export function fallbackFactory(request: string): FactoryOutput {
  const text = request.toLowerCase();
  const template: ProjectTemplateId = GAME.test(text)
    ? 'web-game'
    : WINDOWS.test(text)
      ? 'dotnet-winforms'
      : LIBRARY.test(text)
        ? 'ts-lib'
        : WEB.test(text)
          ? 'vite-react'
          : 'node-cli';
  return {
    template,
    name: projectNameFromRequest(request).slice(0, 60),
    description: clean(request).slice(0, 300),
  };
}

/**
 * Règle fixe après l'ARCHITECTE : un jeu demandé sans plateforme Windows part
 * du gabarit jeu (guide, structure et tests prêts), même si le modèle en choisit un autre.
 */
export function steerFactory(request: string, chosen: FactoryOutput): FactoryOutput {
  const text = request.toLowerCase();
  if (chosen.template === 'web-game' || !GAME.test(text) || WINDOWS.test(text)) return chosen;
  return { ...chosen, template: 'web-game' };
}

const ENTRY_FILES: Partial<Record<ProjectTemplateId, Array<[string, string]>>> = {
  'web-game': [
    ['src/game.ts', 'logique et dessin du jeu'],
    ['src/rules.ts', 'réglages du jeu'],
  ],
  'node-cli': [
    ['src/main.ts', 'logique du programme'],
    ['src/main.test.ts', 'tests du programme'],
  ],
  'ts-lib': [
    ['src/index.ts', 'fonctions de la bibliothèque'],
    ['src/index.test.ts', 'tests des fonctions'],
  ],
  'vite-react': [
    ['src/App.tsx', 'interface'],
    ['src/counter.ts', 'logique'],
    ['src/counter.test.ts', 'tests de la logique'],
  ],
};

/**
 * Plan de secours d'un projet neuf : les fichiers d'entrée de son gabarit, si
 * le CODER ne rend pas de plan valide. L'utilisateur le valide comme un autre.
 */
export function templatePlan(template: ProjectTemplateId, request: string): TaskPlan | null {
  const files = ENTRY_FILES[template];
  if (!files) return null;
  return {
    summary: `Écrire ${clean(request).slice(0, 200)} dans les fichiers d’entrée du gabarit.`,
    criteria: ['la vérification des types passe', 'les tests passent'],
    files: files.map(([path, reason]) => ({ path, action: 'edit' as const, reason })),
    tests: ['typecheck', 'test'],
  };
}

/** Compétence de secours : un seul outil, décrit par la demande, si l'ARCHITECTE ne répond pas au format. */
export function fallbackSkill(request: string): SkillDesign {
  return {
    skill: projectNameFromRequest(request).slice(0, 60),
    description: clean(request).slice(0, 300),
    tools: [{ name: 'outil_principal', description: clean(request).slice(0, 300), inputs: [] }],
  };
}
