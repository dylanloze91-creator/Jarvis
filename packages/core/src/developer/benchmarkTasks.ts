import type { ToolLoopResult } from './toolLoop.js';

/**
 * Banc de code : un petit projet TypeScript copié dans un dossier jetable,
 * jamais la copie de travail. Les réussites se vérifient (texte exact,
 * compilation tsc), jamais sur la parole du modèle.
 */
export const BENCH_FIXTURE: Record<string, string> = {
  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['src'],
    },
    null,
    2,
  )}\n`,
  'src/defineTool.ts': [
    'export interface Tool {',
    '  name: string;',
    '  description: string;',
    '  run: (input: Record<string, unknown>) => string;',
    '}',
    '',
    'export function defineTool(tool: Tool): Tool {',
    '  return tool;',
    '}',
    '',
  ].join('\n'),
  'src/tools/readFile.ts': [
    "import { defineTool } from '../defineTool';",
    '',
    'export const DEFAULT_MAX_CHARS = 8000;',
    '',
    'export const readFileTool = defineTool({',
    "  name: 'read_file',",
    "  description: 'Lit un fichier.',",
    "  run: (input) => String(input.path ?? '').slice(0, DEFAULT_MAX_CHARS),",
    '});',
    '',
  ].join('\n'),
  'src/tools/version.ts': [
    "import { defineTool } from '../defineTool';",
    '',
    'export const getJarvisVersionTool = defineTool({',
    "  name: 'get_jarvis_version',",
    "  description: 'Donne la version de Jarvis.',",
    "  run: () => '0.4.24',",
    '});',
    '',
  ].join('\n'),
  'src/tools/index.ts': [
    "import type { Tool } from '../defineTool';",
    "import { readFileTool } from './readFile';",
    '',
    'export function createToolManager(): Tool[] {',
    '  return [readFileTool];',
    '}',
    '',
  ].join('\n'),
};

/** Le fichier cassé de la tâche de correction : la constante a été renommée, pas son usage. */
export const BENCH_BROKEN_READFILE = BENCH_FIXTURE['src/tools/readFile.ts']!.replace(
  'export const DEFAULT_MAX_CHARS',
  'export const MAX_CHARS_DEFAULT',
);

export const BENCH_SYSTEM = [
  'Tu travailles sur un petit projet TypeScript avec trois outils : list_files (liste les fichiers), read_file (lit un fichier), edit_file (remplace un texte exact).',
  'Pour edit_file, « search » doit être copié exactement depuis le fichier lu et n’y apparaître qu’une fois.',
  'Fais ce qui est demandé avec les outils, puis réponds en une phrase en français.',
].join(' ');

export type BenchTaskKind = 'tool-call' | 'edit' | 'fix';

export interface BenchTask {
  id: string;
  label: string;
  kind: BenchTaskKind;
  maxRounds: number;
  prompt: (context: { tscOutput?: string }) => string;
}

export const BENCH_TASKS: BenchTask[] = [
  {
    id: 'tool-read',
    label: 'Appel d’outil : lire un fichier',
    kind: 'tool-call',
    maxRounds: 3,
    prompt: () => 'Lis le fichier src/tools/version.ts.',
  },
  {
    id: 'tool-list',
    label: 'Appel d’outil : lister les fichiers',
    kind: 'tool-call',
    maxRounds: 3,
    prompt: () => 'Liste les fichiers du projet.',
  },
  {
    id: 'tool-find',
    label: 'Appel d’outil : trouver une valeur',
    kind: 'tool-call',
    maxRounds: 4,
    prompt: () =>
      'Quelle est la valeur de DEFAULT_MAX_CHARS ? Lis le fichier src/tools/readFile.ts pour répondre.',
  },
  {
    id: 'edit',
    label: 'Modification exacte vérifiée par tsc',
    kind: 'edit',
    maxRounds: 6,
    prompt: () =>
      'Enregistre l’outil getJarvisVersionTool (défini dans src/tools/version.ts) dans le tableau renvoyé par createToolManager (src/tools/index.ts) : ajoute son import et ajoute-le au tableau, après readFileTool. Ne change rien d’autre.',
  },
  {
    id: 'fix',
    label: 'Correction d’une erreur de compilation',
    kind: 'fix',
    maxRounds: 6,
    prompt: ({ tscOutput }) =>
      `La compilation échoue :\n${tscOutput ?? '(sortie indisponible)'}\nCorrige l’erreur avec les outils, sans désactiver la vérification.`,
  },
];

export interface Verdict {
  ok: boolean;
  detail: string;
}

export function scoreToolCall(taskId: string, result: ToolLoopResult): Verdict {
  const called = (name: string, path?: RegExp) =>
    result.calls.some(
      (call) =>
        call.name === name &&
        call.status === 'ok' &&
        (!path || path.test(String(call.arguments.path ?? ''))),
    );
  if (result.error) return { ok: false, detail: `Erreur : ${result.error}` };
  if (taskId === 'tool-read')
    return called('read_file', /version\.ts$/)
      ? { ok: true, detail: 'read_file sur version.ts' }
      : { ok: false, detail: 'Pas d’appel structuré à read_file(version.ts).' };
  if (taskId === 'tool-list')
    return called('list_files')
      ? { ok: true, detail: 'list_files appelé' }
      : { ok: false, detail: 'Pas d’appel structuré à list_files.' };
  const read = called('read_file', /readFile\.ts$/);
  const answered = /8\s?000/.test(result.finalText);
  return read && answered
    ? { ok: true, detail: 'readFile.ts lu, valeur 8000 donnée' }
    : {
        ok: false,
        detail: read
          ? 'Fichier lu, mais la valeur 8000 n’est pas dans la réponse.'
          : 'readFile.ts n’a pas été lu.',
      };
}

/** Texte attendu après la modification (la compilation est vérifiée à part). */
export function checkEdit(indexSource: string): Verdict {
  const imported =
    /import\s*\{\s*getJarvisVersionTool\s*\}\s*from\s*['"]\.\/version(\.js)?['"]/.test(indexSource);
  const registered = /return\s*\[\s*readFileTool\s*,\s*getJarvisVersionTool\s*,?\s*\]/.test(
    indexSource,
  );
  if (imported && registered) return { ok: true, detail: 'import et entrée du tableau présents' };
  return {
    ok: false,
    detail:
      `${imported ? '' : 'import absent ; '}${registered ? '' : 'entrée du tableau absente ou mal placée'}`.replace(
        / ; $/,
        '',
      ),
  };
}
