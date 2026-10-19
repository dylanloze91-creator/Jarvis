import {
  defaultNodePlanSuites,
  verificationCriteriaFromScripts,
} from '../projectValidation.js';
import type { TaskPlan } from '../taskPlan.js';
import type { MissionKind } from './router.js';
import type { SkillDesign } from './skill.js';
import type { GoalOutput } from './specialistSchemas.js';
import { isPlatformerRequest, platformerProjectTitle } from './newProjectMethod.js';
import {
  renderTemplate,
  templateToolchain,
  type FactoryOutput,
  type ProjectTemplateId,
} from './templates.js';
import {
  DESKTOP_WINDOWS_EXE,
  dotnetProjectBaseName,
  dotnetTemplateEntryFiles,
} from './dotnetDesktop.js';
import { DOTNET_TEMPLATE_IDS } from './dotnetTemplates.js';

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
  /\b(jeu|jeux|game|pong|snake|tetris|casse[- ]briques?|breakout|morpion|tic[- ]tac[- ]toe|flappy|space invaders|labyrinthe|platformer|plateforme|mario|side[- ]scroller|asteroids?)\b/i;
const WEB = /\b(site|page web|navigateur|web|react|interface web)\b/i;
const LIBRARY = /\b(bibliothèque|bibliotheque|librairie|library|module réutilisable)\b/i;
const NAMED = /\b(pong|snake|tetris|morpion|breakout|flappy|asteroids?)\b/i;

function nameFromAfterColon(request: string): string | null {
  const idx = request.indexOf(':');
  if (idx < 0) return null;
  let tail = clean(request.slice(idx + 1));
  tail = tail.replace(/^(un|une|le|la|des)\s+/i, '');
  tail = tail.split(/[,.]| dans /i)[0]!.trim();
  if (tail.length < 3 || tail.length > 56) return null;
  return tail[0]!.toUpperCase() + tail.slice(1);
}

const POLITE =
  /^(?:je souhaiterais|je voudrais|j['’]aimerais|je veux|peux-tu|tu peux|il me faut|merci de|s['’]il te pla[iî]t)\s+/iu;
const CREATE_PREFIX =
  /^(?:créer|creer|crée|cree|fais|fabrique|génère|genere|écris|ecris)(?:-moi)?\s+(?:moi\s+)?(?:une|un|le|la|des)?\s*(?:petite|petit|nouvelle|nouveau|simple)?\s*(?:projet|application|appli|programme|outil)?\s*[:,-]?\s*/iu;
const STOP = new Set([
  'de',
  'du',
  'des',
  'un',
  'une',
  'le',
  'la',
  'les',
  'type',
  'd',
]);
const GENERIC = new Set([
  ...STOP,
  'je',
  'tu',
  'jeu',
  'jeux',
  'game',
  'souhaiterais',
  'voudrais',
  'aimerais',
  'veux',
  'petit',
  'petite',
  'simple',
  'projet',
  'moi',
  'merci',
]);
const PLATFORMER_WORD =
  /^(?:plateforme|platformer|2d|vue|cote|côté|side|scroller)$/iu;
/** Formules d’ordre (« que tu crées ») : ce ne sont pas un nom de projet. */
const FRAME = new Set([
  'que',
  'crées',
  'crée',
  'cree',
  'créé',
  'crees',
  'fais',
  'fait',
  'faire',
  'fabrique',
  'fabriques',
  'écris',
  'ecris',
  'écrit',
  'ecrit',
  'génère',
  'genere',
]);
/** Aparté d’une demande plateforme (« pour tester tes possibilités »). */
const PURPOSE = new Set([
  'pour',
  'tester',
  'test',
  'teste',
  'tes',
  'ton',
  'ta',
  'possibilités',
  'possibilité',
  'possibilites',
  'possibilite',
  'en',
  'si',
  'inspirations',
  'inspiration',
  'peux',
  'peut',
  'aller',
  'voir',
  'classiques',
  'classique',
  'avec',
  'dans',
  'sur',
  'par',
  'et',
  'ou',
  'au',
  'aux',
  'ce',
  'cette',
  'ces',
]);

function nameWords(request: string): string[] {
  let text = clean(request);
  text = text.replace(/[.!?…]+$/u, '').trim();
  const sentenceEnd = text.search(/(?<=[\p{L}\p{N}])[.!?](?=\s)/u);
  if (sentenceEnd >= 0) text = text.slice(0, sentenceEnd).trim();
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(POLITE, '').trim();
  }
  text = text.replace(CREATE_PREFIX, '').trim();
  text = text.replace(/^(?:un|une)\s+jeu\s+type\s+/iu, '').trim();
  return text.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
}

function titleCase(words: string[]): string {
  const name = words.join(' ').trim();
  if (!name || /[\\/]|\.\./.test(name)) return 'Mon projet';
  return name[0]!.toUpperCase() + name.slice(1);
}

/** Nom seulement fait de politesses ou de mots vides : on ne le prend pas. */
export function isWeakProjectName(name: string): boolean {
  const words = name
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
  return (
    words.length === 0 ||
    words.every((word) => {
      const lower = word.toLowerCase();
      return GENERIC.has(lower) || FRAME.has(lower);
    })
  );
}

/**
 * Nom court tiré de la demande.
 * Une formule de politesse ne devient pas le nom : « Je souhaiterais un jeu type jeu de plateforme 2D »
 * donne « Jeu plateforme 2D » (dossier `jeu-plateforme-2d`).
 */
export function projectNameFromRequest(request: string): string {
  const named = NAMED.exec(request)?.[1];
  if (named) return named[0]!.toUpperCase() + named.slice(1).toLowerCase();
  const colon = nameFromAfterColon(request);
  if (colon) return colon;
  if (/\b(bloque|bloquer)\b/i.test(request) && /\bhosts\b/i.test(request)) return 'Bloqueur de sites';
  const words = nameWords(request);
  if (isPlatformerRequest(request)) {
    const specific = words.filter((word) => {
      const lower = word.toLowerCase();
      return (
        !GENERIC.has(lower) &&
        !FRAME.has(lower) &&
        !PURPOSE.has(lower) &&
        !PLATFORMER_WORD.test(word)
      );
    });
    if (specific.length === 0) return 'Jeu plateforme 2D';
    return titleCase(specific.slice(0, 3));
  }
  const kept = words.filter((word) => {
    const lower = word.toLowerCase();
    return !STOP.has(lower) && !FRAME.has(lower);
  });
  const picked = (kept.length ? kept : words).slice(0, 3);
  if (
    picked.length === 0 ||
    picked.every((word) => {
      const lower = word.toLowerCase();
      return GENERIC.has(lower) || FRAME.has(lower);
    })
  )
    return 'Mon projet';
  return titleCase(picked);
}

/** Une seule question si aucun nom sûr ne sort de la demande. `null` : le nom est décidé. */
export function projectNameNeedsQuestion(request: string): string | null {
  return projectNameFromRequest(request) === 'Mon projet'
    ? 'Quel nom court pour ce projet ?'
    : null;
}

/** Gabarit et nom de secours, par règles fixes, si l'ARCHITECTE ne répond pas au format. */
export function fallbackFactory(request: string): FactoryOutput {
  const text = request.toLowerCase();
  const template: ProjectTemplateId = GAME.test(text)
    ? 'web-game'
    : DESKTOP_WINDOWS_EXE.test(request)
      ? 'dotnet-winforms'
      : LIBRARY.test(text)
        ? 'ts-lib'
        : WEB.test(text)
          ? 'vite-react'
          : 'node-cli';
  return lockFactoryToRequest(request, {
    template,
    name: projectNameFromRequest(request).slice(0, 60),
    description: clean(request).slice(0, 300),
  });
}

/**
 * Règle fixe après l'ARCHITECTE : un jeu demandé sans plateforme Windows part
 * du gabarit jeu (guide, structure et tests prêts), même si le modèle en choisit un autre.
 */
export function steerFactory(request: string, chosen: FactoryOutput): FactoryOutput {
  const text = request.toLowerCase();
  let out = chosen;
  if (
    DESKTOP_WINDOWS_EXE.test(text) &&
    !(DOTNET_TEMPLATE_IDS as readonly string[]).includes(chosen.template)
  ) {
    out = { ...chosen, template: 'dotnet-winforms' };
  } else if (chosen.template !== 'web-game' && GAME.test(text) && !DESKTOP_WINDOWS_EXE.test(text)) {
    out = { ...chosen, template: 'web-game' };
  }
  return lockFactoryToRequest(request, out);
}

const OTHER_GAME_NAME =
  /\b(snake|serpent|pong|tetris|breakout|flappy|asteroids?|pac-?man|morpion)\b/i;

/** Empêche de remplacer la demande (ex. plateforme 2D) par Snake/Pong via le modèle. */
export function lockFactoryToRequest(request: string, chosen: FactoryOutput): FactoryOutput {
  const text = request.toLowerCase();
  let out: FactoryOutput = { ...chosen };
  if (/\bmario\b/i.test(out.name)) out.name = platformerProjectTitle();
  if (/\bmario\b/i.test(out.description)) {
    out.description = out.description
      .replace(/\bsuper\s+mario\b/gi, 'jeu de plateforme 2D')
      .replace(/\bmario\b/gi, 'jeu de plateforme 2D');
  }

  if (isPlatformerRequest(request)) {
    out.template = 'web-game';
    const wrong =
      OTHER_GAME_NAME.test(out.name) ||
      OTHER_GAME_NAME.test(out.description) ||
      isWeakProjectName(out.name) ||
      out.name === platformerProjectTitle() ||
      (!/plateforme|platformer/i.test(out.name) && /jeu du|type de jeu/i.test(out.description));
    if (wrong || !/plateforme|platformer|2d/i.test(out.name)) {
      const fromReq = projectNameFromRequest(request);
      out.name = isWeakProjectName(fromReq) ? 'Jeu plateforme 2D' : fromReq.slice(0, 60);
    }
    if (
      (OTHER_GAME_NAME.test(out.description) || !/plateforme|platformer|2d/i.test(out.description)) &&
      !OTHER_GAME_NAME.test(request)
    ) {
      out.description = request.trim().slice(0, 300);
    }
    return out;
  }

  if (/\b(jeu|jeux|game)\b/i.test(request) && !OTHER_GAME_NAME.test(request)) {
    if (OTHER_GAME_NAME.test(out.name) && !OTHER_GAME_NAME.test(text)) {
      out.name = projectNameFromRequest(request).slice(0, 60);
    }
  }
  return out;
}

const ENTRY_FILES: Partial<Record<ProjectTemplateId, Array<[string, string]>>> = {
  'web-game': [
    ['src/level.ts', 'géométrie du niveau jouable'],
    ['src/game.ts', 'physique et rendu (à garder pour une plateforme)'],
    ['src/rules.ts', 'vitesses et constantes'],
    ['src/game.test.ts', 'tests de la logique'],
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
function templatePackageScripts(template: ProjectTemplateId): Record<string, string> {
  if (templateToolchain(template) !== 'node') return {};
  const file = renderTemplate(template, {
    packageName: 'jarvis-template',
    title: 'jarvis-template',
    description: '',
  }).find((item) => item.path === 'package.json');
  if (!file) return {};
  try {
    const pkg = JSON.parse(file.content) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/** `projectTitle` : nom du projet déjà créé (gabarit) ; sinon dérivé de la demande. */
export function templatePlan(
  template: ProjectTemplateId,
  request: string,
  projectTitle?: string,
): TaskPlan | null {
  const title = projectTitle?.trim() || projectNameFromRequest(request);
  if (template === 'web-game' && isPlatformerRequest(request)) {
    const scripts = templatePackageScripts(template);
    return {
      summary: `Écrire un niveau de plateforme 2D dans src/level.ts pour : ${clean(request).slice(0, 160)}`,
      criteria: [
        'src/level.ts définit un PLAY_LEVEL différent du niveau tutoriel',
        'au moins six plateformes, un collectable, un piège et une arrivée',
        ...verificationCriteriaFromScripts(scripts),
      ],
      files: [{ path: 'src/level.ts', action: 'edit', reason: 'géométrie du niveau jouable' }],
      tests: defaultNodePlanSuites(scripts),
    };
  }
  const dotnetFiles = dotnetTemplateEntryFiles(template, title);
  const nodeFiles = ENTRY_FILES[template];
  const files = dotnetFiles ?? nodeFiles;
  if (!files) return null;
  const scripts = templatePackageScripts(template);
  const isDotnet = templateToolchain(template) === 'dotnet';
  return {
    summary: `Écrire ${clean(request).slice(0, 200)} dans les fichiers d’entrée du gabarit.`,
    criteria: isDotnet
      ? [
          'dotnet build et dotnet test réussissent sur la solution',
          'la logique reste dans Core, l’interface dans App',
        ]
      : verificationCriteriaFromScripts(scripts),
    files: files.map(([path, reason]) => ({ path, action: 'edit' as const, reason })),
    tests: isDotnet ? ['typecheck', 'test'] : defaultNodePlanSuites(scripts),
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
