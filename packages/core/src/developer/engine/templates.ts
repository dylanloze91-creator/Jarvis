import { z } from 'zod';
import {
  DOTNET_TEMPLATES,
  DOTNET_TEMPLATE_IDS,
  dotnetIdentifier,
  renderDotnetTemplate,
  type DotnetTemplateId,
} from './dotnetTemplates.js';
import { briefBlock, type MissionBrief } from './missionPrompts.js';

/**
 * Project Factory : gabarits locaux Node / TypeScript, écrits par Jarvis sans
 * réseau. Les versions suivent celles de Jarvis (déjà installées et vérifiées
 * sur le PC de l'utilisateur). Seul `npm install`, confirmé, va sur le réseau.
 */
export const NODE_TEMPLATE_IDS = [
  'node-cli',
  'ts-lib',
  'vite-react',
  'web-game',
  'node-skill',
] as const;
export const PROJECT_TEMPLATE_IDS = [...NODE_TEMPLATE_IDS, ...DOTNET_TEMPLATE_IDS] as const;
export type ProjectTemplateId = (typeof PROJECT_TEMPLATE_IDS)[number];

export function templateToolchain(id: ProjectTemplateId): 'node' | 'dotnet' {
  return (DOTNET_TEMPLATE_IDS as readonly string[]).includes(id) ? 'dotnet' : 'node';
}

export const PROJECT_TEMPLATES: Record<ProjectTemplateId, { label: string; description: string }> =
  {
    ...DOTNET_TEMPLATES,
    'node-cli': {
      label: 'Outil en ligne de commande (Node.js, TypeScript)',
      description: 'un programme lancé dans un terminal, avec ses options et ses tests',
    },
    'ts-lib': {
      label: 'Bibliothèque TypeScript',
      description: 'des fonctions réutilisables par d’autres projets, avec leurs tests',
    },
    'vite-react': {
      label: 'Application web (Vite, React, TypeScript)',
      description: 'une interface dans le navigateur, servie en local par Vite',
    },
    'web-game': {
      label: 'Jeu dans le navigateur (TypeScript, canvas, Vite)',
      description:
        'canvas, boucle et tests minimaux qui compilent ; le programme demandé (jeu ou autre) est à écrire dans game.ts et game.test.ts',
    },
    'node-skill': {
      label: 'Compétence de Jarvis (outils TypeScript, hors du chat)',
      description: 'un module d’outils testés, que le chat n’utilise pas sans ta décision',
    },
  };

export const TEMPLATE_VERSIONS = {
  typescript: '^5.9.3',
  vitest: '^3.2.4',
  '@types/node': '^22.18.12',
  vite: '^7.3.6',
  '@vitejs/plugin-react': '^5.2.0',
  react: '^19.3.0',
  'react-dom': '^19.3.0',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.3.0',
} as const;

export interface TemplateInput {
  /** Nom npm et nom du dossier (minuscules, chiffres, tirets). */
  packageName: string;
  title: string;
  description: string;
  /** Gabarits .NET : cible tirée du SDK installé (`net10.0`…). */
  tfm?: string;
  /** Compétence : outils prévus par l'ARCHITECTE, listés dans `jarvis-skill.json`. */
  skillTools?: ReadonlyArray<{ name: string; description: string }>;
}

export interface TemplateFile {
  path: string;
  content: string;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function pick(...names: Array<keyof typeof TEMPLATE_VERSIONS>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) out[name] = TEMPLATE_VERSIONS[name];
  return out;
}

const GITIGNORE = 'node_modules/\ndist/\ncoverage/\n.env\n.env.*\n*.log\n';

function readme(id: ProjectTemplateId, input: TemplateInput, commands: string[]): string {
  return `# ${input.title}

${input.description || PROJECT_TEMPLATES[id].description}.

## Commandes

${commands.map((c) => `- \`${c}\``).join('\n')}

Créé par Jarvis Développeur à partir du gabarit « ${PROJECT_TEMPLATES[id].label} ».
`;
}

const NODE_TSCONFIG = {
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    types: ['node'],
    rootDir: 'src',
    outDir: 'dist',
  },
  include: ['src'],
};

function nodeCli(input: TemplateInput): TemplateFile[] {
  const name = input.packageName;
  return [
    {
      path: 'package.json',
      content: json({
        name,
        version: '0.1.0',
        description: input.description,
        private: true,
        type: 'module',
        bin: { [name]: 'dist/cli.js' },
        scripts: {
          build: 'tsc -p tsconfig.build.json',
          start: 'node dist/cli.js',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
        },
        devDependencies: pick('@types/node', 'typescript', 'vitest'),
        engines: { node: '>=20' },
      }),
    },
    { path: 'tsconfig.json', content: json(NODE_TSCONFIG) },
    {
      path: 'tsconfig.build.json',
      content: json({ extends: './tsconfig.json', exclude: ['src/**/*.test.ts'] }),
    },
    {
      path: 'src/main.ts',
      content: `export interface Options {
  name: string;
  help: boolean;
}

export function parseArgs(args: readonly string[]): Options {
  const options: Options = { name: 'monde', help: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--name' && args[i + 1]) options.name = args[(i += 1)]!;
  }
  return options;
}

export function run(args: readonly string[]): string {
  const options = parseArgs(args);
  if (options.help) return 'Utilisation : ${name} [--name <nom>]';
  return \`Bonjour, \${options.name} !\`;
}
`,
    },
    {
      path: 'src/cli.ts',
      content: `#!/usr/bin/env node
import { run } from './main.js';

console.log(run(process.argv.slice(2)));
`,
    },
    {
      path: 'src/main.test.ts',
      content: `import { describe, expect, it } from 'vitest';
import { parseArgs, run } from './main.js';

describe('${name}', () => {
  it('salue par défaut', () => {
    expect(run([])).toBe('Bonjour, monde !');
  });

  it('lit --name et --help', () => {
    expect(parseArgs(['--name', 'Dylan'])).toEqual({ name: 'Dylan', help: false });
    expect(run(['--help'])).toContain('Utilisation');
  });
});
`,
    },
    {
      path: 'README.md',
      content: readme('node-cli', input, [
        'npm install',
        'npm test',
        'npm run build',
        `node dist/cli.js --name Dylan`,
      ]),
    },
    { path: '.gitignore', content: GITIGNORE },
  ];
}

function tsLib(input: TemplateInput): TemplateFile[] {
  return [
    {
      path: 'package.json',
      content: json({
        name: input.packageName,
        version: '0.1.0',
        description: input.description,
        private: true,
        type: 'module',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        files: ['dist'],
        scripts: {
          build: 'tsc -p tsconfig.build.json',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
        },
        devDependencies: pick('@types/node', 'typescript', 'vitest'),
        engines: { node: '>=20' },
      }),
    },
    {
      path: 'tsconfig.json',
      content: json({
        ...NODE_TSCONFIG,
        compilerOptions: { ...NODE_TSCONFIG.compilerOptions, declaration: true },
      }),
    },
    {
      path: 'tsconfig.build.json',
      content: json({ extends: './tsconfig.json', exclude: ['src/**/*.test.ts'] }),
    },
    {
      path: 'src/index.ts',
      content: `/** Transforme un texte en identifiant court : minuscules, chiffres et tirets. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
`,
    },
    {
      path: 'src/index.test.ts',
      content: `import { describe, expect, it } from 'vitest';
import { slugify } from './index.js';

describe('slugify', () => {
  it('retire les accents et les espaces', () => {
    expect(slugify('Été à Paris !')).toBe('ete-a-paris');
  });
});
`,
    },
    {
      path: 'README.md',
      content: readme('ts-lib', input, ['npm install', 'npm test', 'npm run build']),
    },
    { path: '.gitignore', content: GITIGNORE },
  ];
}

function viteReact(input: TemplateInput): TemplateFile[] {
  return [
    {
      path: 'package.json',
      content: json({
        name: input.packageName,
        version: '0.1.0',
        description: input.description,
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 5391',
          build: 'tsc --noEmit && vite build',
          preview: 'vite preview --port 5392',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
        },
        dependencies: pick('react', 'react-dom'),
        devDependencies: pick(
          '@types/react',
          '@types/react-dom',
          '@vitejs/plugin-react',
          'typescript',
          'vite',
          'vitest',
        ),
      }),
    },
    {
      path: 'tsconfig.json',
      content: json({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['vite/client'],
        },
        include: ['src', 'vite.config.ts'],
      }),
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${input.title.replace(/[<>&"]/g, '')}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.tsx',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    },
    {
      path: 'src/App.tsx',
      content: `import { useState } from 'react';
import { next } from './counter';

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>${input.title.replace(/[<>{}&"]/g, '')}</h1>
      <button type="button" onClick={() => setCount((value) => next(value))}>
        Cliqué {count} fois
      </button>
    </main>
  );
}
`,
    },
    {
      path: 'src/counter.ts',
      content: `/** Valeur suivante du compteur, plafonnée à 99. */
export function next(value: number): number {
  return Math.min(value + 1, 99);
}
`,
    },
    {
      path: 'src/counter.test.ts',
      content: `import { describe, expect, it } from 'vitest';
import { next } from './counter';

describe('compteur', () => {
  it('avance de un et s’arrête à 99', () => {
    expect(next(0)).toBe(1);
    expect(next(99)).toBe(99);
  });
});
`,
    },
    {
      path: 'src/styles.css',
      content: `:root {
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
}

main {
  max-width: 40rem;
  margin: 4rem auto;
  padding: 0 1rem;
}
`,
    },
    {
      path: 'README.md',
      content: readme('vite-react', input, [
        'npm install',
        'npm run dev (http://localhost:5391)',
        'npm test',
        'npm run build',
      ]),
    },
    { path: '.gitignore', content: GITIGNORE },
  ];
}

function skillReadme(input: TemplateInput, planned: string[]): string {
  const tick = '`';
  const code = (s: string) => `${tick}${s}${tick}`;
  const lines = [
    `# ${input.title}`,
    '',
    `${input.description || PROJECT_TEMPLATES['node-skill'].description}.`,
    '',
    `Compétence de Jarvis Développeur : des outils TypeScript testés, dans ${code('src/tools/')}. **Hors du chat** : ${code('jarvis-skill.json')} garde ${code('"chat": false')}. Pour qu'elle entre dans le chat, il faudra ta décision (D15) et une mise à jour validée des tests figés du catalogue.`,
    '',
    '## Commandes',
    '',
    `- ${code('npm install')}`,
    `- ${code('npm test')}`,
    `- ${code('npm run build')}`,
  ];
  if (planned.length) lines.push('', '## Outils prévus', '', ...planned.map((n) => `- ${code(n)}`));
  return `${lines.join('\n')}\n`;
}

function nodeSkill(input: TemplateInput): TemplateFile[] {
  const id = input.packageName;
  const planned = (input.skillTools ?? []).map((t) => t.name);
  return [
    {
      path: 'package.json',
      content: json({
        name: id,
        version: '0.1.0',
        description: input.description,
        private: true,
        type: 'module',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        scripts: {
          build: 'tsc -p tsconfig.build.json',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
        },
        devDependencies: pick('@types/node', 'typescript', 'vitest'),
        engines: { node: '>=20' },
      }),
    },
    { path: 'tsconfig.json', content: json(NODE_TSCONFIG) },
    {
      path: 'tsconfig.build.json',
      content: json({ extends: './tsconfig.json', exclude: ['src/**/*.test.ts'] }),
    },
    {
      path: 'jarvis-skill.json',
      content: json({
        id,
        name: input.title,
        description: input.description,
        version: '0.1.0',
        chat: false,
        tools: ['bonjour'],
        planned,
      }),
    },
    {
      path: 'src/skill.ts',
      content: `/** Une entrée d'outil : un nom, un type simple, une description. */
export interface ToolInput {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
}

/**
 * Un outil de la compétence. Le chat de Jarvis ne l'utilise pas : il faudra
 * ta décision (D15) pour qu'il y entre.
 */
export interface SkillTool {
  name: string;
  description: string;
  inputs: ToolInput[];
  run(input: Record<string, unknown>): Promise<string> | string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  tools: SkillTool[];
}
`,
    },
    {
      path: 'src/tools/bonjour.ts',
      content: `import type { SkillTool } from '../skill.js';

/** Exemple : chaque outil a cette forme (nom, description, entrées, run). */
export const bonjour: SkillTool = {
  name: 'bonjour',
  description: 'Salue une personne par son prénom.',
  inputs: [{ name: 'prenom', type: 'string', description: 'Prénom à saluer' }],
  run: ({ prenom }) => (typeof prenom === 'string' && prenom.trim() ? \`Bonjour, \${prenom.trim()} !\` : 'Bonjour !'),
};
`,
    },
    {
      path: 'src/index.ts',
      content: `import type { Skill } from './skill.js';
import { bonjour } from './tools/bonjour.js';

export type { Skill, SkillTool, ToolInput } from './skill.js';

export const skill: Skill = {
  id: ${JSON.stringify(id)},
  name: ${JSON.stringify(input.title)},
  description: ${JSON.stringify(input.description)},
  tools: [bonjour],
};
`,
    },
    {
      path: 'src/index.test.ts',
      content: `import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { skill } from './index.js';

describe('compétence', () => {
  it('des outils aux noms uniques en snake_case, décrits', () => {
    const names = skill.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of skill.tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
      expect(tool.description.length).toBeGreaterThan(3);
    }
  });

  it('jarvis-skill.json liste les outils et reste hors du chat', () => {
    const manifest = JSON.parse(readFileSync(new URL('../jarvis-skill.json', import.meta.url), 'utf8'));
    expect(manifest.chat).toBe(false);
    expect(manifest.tools).toEqual(skill.tools.map((t) => t.name));
  });

  it('bonjour salue', async () => {
    const tool = skill.tools.find((t) => t.name === 'bonjour')!;
    expect(await tool.run({ prenom: ' Dylan ' })).toBe('Bonjour, Dylan !');
  });
});
`,
    },
    { path: 'README.md', content: skillReadme(input, planned) },
    { path: '.gitignore', content: GITIGNORE },
  ];
}

function webGame(input: TemplateInput): TemplateFile[] {
  const title = input.title.replace(/[<>&"]/g, '');
  return [
    {
      path: 'package.json',
      content: json({
        name: input.packageName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite --port 5393 --strictPort',
          build: 'vite build',
          preview: 'vite preview',
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
        },
        devDependencies: pick('typescript', 'vite', 'vitest'),
      }),
    },
    {
      path: 'tsconfig.json',
      content: json({
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ['vite/client'],
        },
        include: ['src'],
      }),
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #111; color: #eee; font-family: system-ui, sans-serif; }
      body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; }
      canvas { background: #000; border: 2px solid #444; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <canvas id="game" width="800" height="480"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.ts',
      content: `import { createGame, render, update, type Input } from './game';

/** Boucle canvas : la logique et le dessin sont dans game.ts. */
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const keys = new Set<string>();

addEventListener('keydown', (event) => {
  keys.add(event.key);
  if (event.key.startsWith('Arrow') || event.key === ' ') event.preventDefault();
});
addEventListener('keyup', (event) => keys.delete(event.key));

let state = createGame(canvas.width, canvas.height);
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const input: Input = { keys };
  state = update(state, input, dt);
  render(ctx, state);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
`,
    },
    {
      path: 'src/rules.ts',
      content: `/** Réglages du jeu : constantes modifiables sans toucher à toute la logique. */
export const RULES = {
  title: '${title.replace("'", "\\'")}',
};
`,
    },
    {
      path: 'src/game.ts',
      content: `import { RULES } from './rules';

/** État minimal du gabarit : remplace-le par le jeu ou l’application demandée. */
export interface GameState {
  width: number;
  height: number;
  tick: number;
}

export interface Input {
  keys: ReadonlySet<string>;
}

export function createGame(width: number, height: number): GameState {
  return { width, height, tick: 0 };
}

export function update(state: GameState, _input: Input, dt: number): GameState {
  return { ...state, tick: state.tick + dt };
}

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.fillStyle = '#ccc';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(RULES.title, state.width / 2, state.height / 2 - 12);
  ctx.fillStyle = '#888';
  ctx.font = '14px sans-serif';
  ctx.fillText('Gabarit prêt — écris le programme demandé dans game.ts', state.width / 2, state.height / 2 + 16);
}
`,
    },
    {
      path: 'src/game.test.ts',
      content: `import { describe, expect, it } from 'vitest';
import { createGame, update } from './game';

/** Tests du gabarit : remplace-les par ceux du jeu ou de l’application demandée. */
describe('gabarit jeu navigateur', () => {
  it('createGame respecte la taille du canvas', () => {
    const state = createGame(800, 480);
    expect(state.width).toBe(800);
    expect(state.height).toBe(480);
  });

  it('update avance sans erreur', () => {
    const next = update(createGame(100, 100), { keys: new Set() }, 1 / 60);
    expect(next.tick).toBeGreaterThan(0);
  });
});
`,
    },
    {
      path: 'README.md',
      content: readmeGame(input),
    },
    { path: '.gitignore', content: GITIGNORE },
  ];
}


function readmeGame(input: TemplateInput): string {
  const tick = '`';
  return [
    `# ${input.title}`,
    '',
    `${input.description || PROJECT_TEMPLATES['web-game'].description}.`,
    '',
    '## Jouer',
    '',
    `- ${tick}npm install${tick}`,
    `- ${tick}npm run dev${tick}, puis ouvre http://localhost:5393`,
    '- Le gabarit affiche un écran neutre : écris le jeu ou l’application demandée dans src/game.ts et adapte src/game.test.ts.',
    '',
    '## Vérifier',
    '',
    `- ${tick}npm test${tick}`,
    `- ${tick}npm run build${tick}`,
    '',
    `Les réglages (vitesses, tailles, points pour gagner, touches) sont dans ${tick}src/rules.ts${tick}, la logique et le dessin dans ${tick}src/game.ts${tick} ; ${tick}src/main.ts${tick} gère le canvas, le clavier et la boucle d'images.`,
    '',
    `Créé par Jarvis Développeur à partir du gabarit « ${PROJECT_TEMPLATES['web-game'].label} ».`,
    '',
  ].join('\n');
}

/** Fichiers de structure d'un gabarit (5.0.1) : ils redemandent toujours confirmation, comme le cœur. */
export const TEMPLATE_STRUCTURE: Partial<Record<ProjectTemplateId, readonly string[]>> = {
  'web-game': ['index.html', 'src/main.ts', 'src/game.test.ts'],
};

/** Fichiers montrés au modèle, en référence, quand il écrit un fichier du gabarit (5.0.1). */
export const TEMPLATE_REFERENCES: Partial<Record<ProjectTemplateId, readonly string[]>> = {
  'web-game': ['src/rules.ts', 'src/main.ts', 'src/game.test.ts'],
};

/** Consignes du CODER pour un projet neuf, selon son gabarit (5.0.1). */
export const TEMPLATE_GUIDES: Partial<Record<ProjectTemplateId, string>> = {
  'web-game': [
    'Gabarit « jeu dans le navigateur » : canvas, boucle (main.ts) et tests minimaux seulement — pas de jeu jouable tant que tu n’as pas écrit la demande.',
    '- Écris le jeu ou l’application demandée dans src/game.ts ; réglages optionnels dans src/rules.ts.',
    '- Remplace src/game.test.ts par des tests qui vérifient ce programme (ne garde pas les tests du gabarit neutre).',
    '- index.html et src/main.ts fournissent la boucle requestAnimationFrame : modifie-les seulement si nécessaire.',
  ].join('\n'),
  'node-cli':
    'Gabarit « outil en ligne de commande » : déjà fonctionnel et testé (--name, --help). La logique va dans src/main.ts (fonction run), testée dans src/main.test.ts ; src/cli.ts ne fait que l’appeler. Fais seulement le changement demandé.',
  'ts-lib':
    'Gabarit « bibliothèque TypeScript » : déjà fonctionnel et testé (slugify). Ajoute ou change seulement les fonctions demandées dans src/index.ts, avec leurs tests dans src/index.test.ts.',
  'vite-react':
    'Gabarit « application web » : déjà fonctionnel et testé (un compteur). La logique va dans des fonctions pures testées (comme src/counter.ts), l’interface dans src/App.tsx. Fais seulement le changement demandé.',
};

export function renderTemplate(id: ProjectTemplateId, input: TemplateInput): TemplateFile[] {
  const clean: TemplateInput = {
    packageName: input.packageName,
    title: input.title.trim().slice(0, 80) || input.packageName,
    description: input.description.trim().replace(/\s+/g, ' ').slice(0, 300),
  };
  if (templateToolchain(id) === 'dotnet') {
    if (!input.tfm) throw new Error('Gabarit .NET sans version du SDK.');
    return renderDotnetTemplate(id as DotnetTemplateId, {
      name: dotnetIdentifier(clean.title),
      title: clean.title,
      description: clean.description,
      tfm: input.tfm,
    });
  }
  if (id === 'node-skill') return nodeSkill({ ...clean, skillTools: input.skillTools });
  if (id === 'web-game') return webGame(clean);
  if (id === 'node-cli') return nodeCli(clean);
  if (id === 'ts-lib') return tsLib(clean);
  return viteReact(clean);
}

export const FACTORY_MARKER = 'ÉTAPE : NOUVEAU PROJET';

const TEMPLATE_ALIASES: Record<string, ProjectTemplateId> = {
  cli: 'node-cli',
  node: 'node-cli',
  console: 'node-cli',
  commande: 'node-cli',
  lib: 'ts-lib',
  library: 'ts-lib',
  bibliotheque: 'ts-lib',
  bibliothèque: 'ts-lib',
  librairie: 'ts-lib',
  jeu: 'web-game',
  game: 'web-game',
  canvas: 'web-game',
  pong: 'web-game',
  'jeu-web': 'web-game',
  web: 'vite-react',
  site: 'vite-react',
  react: 'vite-react',
  vite: 'vite-react',
  app: 'vite-react',
  winforms: 'dotnet-winforms',
  windows: 'dotnet-winforms',
  'windows-forms': 'dotnet-winforms',
  wpf: 'dotnet-wpf',
  dotnet: 'dotnet-console',
  '.net': 'dotnet-console',
  csharp: 'dotnet-console',
  'c#': 'dotnet-console',
  worker: 'dotnet-worker',
  service: 'dotnet-worker',
};

/** Choix de l'ARCHITECTE pour un nouveau projet : un gabarit de la liste, un nom, une phrase. */
export const factorySchema = z.object({
  template: z.preprocess((value) => {
    const key = String(value ?? '')
      .trim()
      .toLowerCase();
    return (PROJECT_TEMPLATE_IDS as readonly string[]).includes(key)
      ? key
      : (TEMPLATE_ALIASES[key] ?? key);
  }, z.enum(PROJECT_TEMPLATE_IDS)),
  name: z.string().trim().min(2).max(60),
  description: z.string().max(300).default(''),
});
export type FactoryOutput = z.infer<typeof factorySchema>;

export function factorySystem(): string {
  const list = PROJECT_TEMPLATE_IDS.filter((id) => id !== 'node-skill')
    .map((id) => `- "${id}" : ${PROJECT_TEMPLATES[id].label}, ${PROJECT_TEMPLATES[id].description}`)
    .join('\n');
  return `Tu es le spécialiste ARCHITECT de Jarvis Développeur. ${FACTORY_MARKER}.
L'utilisateur veut un nouveau projet, indépendant de Jarvis. Choisis le gabarit local le plus simple qui convient, un nom court et une phrase de description. Un jeu ou une appli canvas dans le navigateur (Snake, Pong, Tetris…) est « web-game » (gabarit neutre : le codeur écrit le programme). Une « appli Windows » (fenêtre) est un gabarit .NET ; un outil sans interface peut rester en Node.js. Réponds en français.
Gabarits :
${list}
Le format attendu est :
{"template": "${PROJECT_TEMPLATE_IDS.filter((id) => id !== 'node-skill').join('" | "')}", "name": "Nom du projet", "description": "une phrase"}`;
}

export function factoryPrompt(brief: MissionBrief): string {
  return briefBlock(brief);
}
