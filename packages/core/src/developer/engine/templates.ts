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
export const NODE_TEMPLATE_IDS = ['node-cli', 'ts-lib', 'vite-react', 'node-skill'] as const;
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
L'utilisateur veut un nouveau projet, indépendant de Jarvis. Choisis le gabarit local le plus simple qui convient, un nom court et une phrase de description. Une « appli Windows » (fenêtre) est un gabarit .NET ; un outil sans interface peut rester en Node.js. Réponds en français.
Gabarits :
${list}
Le format attendu est :
{"template": "${PROJECT_TEMPLATE_IDS.filter((id) => id !== 'node-skill').join('" | "')}", "name": "Nom du projet", "description": "une phrase"}`;
}

export function factoryPrompt(brief: MissionBrief): string {
  return briefBlock(brief);
}
