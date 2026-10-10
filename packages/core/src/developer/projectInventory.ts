import { npmValidationCommands } from './projectValidation.js';

/** Lecture ciblée du dépôt (sans node_modules) pour le plan et les missions. */
export type ProjectInventoryKind = 'node' | 'dotnet' | 'python' | 'go' | 'rust' | 'unknown';

export interface ProjectInventory {
  kind: ProjectInventoryKind;
  languages: string[];
  packageName: string | null;
  version: string | null;
  scripts: Record<string, string>;
  /** Scripts npm/dotnet détectés comme tests ou build. */
  validationScripts: string[];
  entryHints: string[];
  configFiles: string[];
  lockfiles: string[];
  workspaces: string[];
}

export interface InventoryFileAccess {
  exists(relativePath: string): boolean;
  readUtf8(relativePath: string): string | null;
}

const LOCKFILES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'packages.lock.json',
] as const;

const CONFIG_CANDIDATES = [
  'package.json',
  'tsconfig.json',
  'eslint.config.js',
  'vitest.config.ts',
  'vite.config.ts',
  'electron.vite.config.ts',
  'electron-builder.yml',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'global.json',
  'Directory.Build.props',
] as const;

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function firstCsproj(access: InventoryFileAccess): string | null {
  const candidates = ['App.csproj', 'Jarvis.csproj', 'src/App.csproj', 'apps/desktop/App.csproj'];
  for (const path of candidates) {
    if (access.exists(path)) return path;
  }
  return null;
}

/** Détecte le type de projet à partir des fichiers présents (pas du nom du dossier). */
export function detectProjectInventory(access: InventoryFileAccess): ProjectInventory {
  const languages = new Set<string>();
  const configFiles: string[] = [];
  const lockfiles: string[] = [];
  for (const file of CONFIG_CANDIDATES) {
    if (access.exists(file)) configFiles.push(file);
  }
  for (const file of LOCKFILES) {
    if (access.exists(file)) lockfiles.push(file);
  }

  let kind: ProjectInventoryKind = 'unknown';
  let packageName: string | null = null;
  let version: string | null = null;
  const scripts: Record<string, string> = {};
  const workspaces: string[] = [];
  const entryHints: string[] = [];

  const pkgText = access.readUtf8('package.json');
  if (pkgText) {
    kind = 'node';
    languages.add('javascript');
    const pkg = safeJson(pkgText);
    if (pkg) {
      if (typeof pkg.name === 'string') packageName = pkg.name;
      if (typeof pkg.version === 'string') version = pkg.version;
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [key, value] of Object.entries(pkg.scripts as Record<string, unknown>)) {
          if (typeof value === 'string') scripts[key] = value;
        }
      }
      if (Array.isArray(pkg.workspaces)) {
        for (const ws of pkg.workspaces) if (typeof ws === 'string') workspaces.push(ws);
      }
      if (typeof pkg.main === 'string') entryHints.push(pkg.main);
      if (typeof pkg.module === 'string') entryHints.push(pkg.module);
    }
    if (access.exists('tsconfig.json')) languages.add('typescript');
  }

  const csproj = firstCsproj(access);
  if (csproj) {
    kind = kind === 'node' ? kind : 'dotnet';
    languages.add('csharp');
    entryHints.push(csproj);
  }

  if (access.exists('pyproject.toml') || access.exists('requirements.txt')) {
    kind = kind === 'unknown' ? 'python' : kind;
    languages.add('python');
  }
  if (access.exists('go.mod')) {
    kind = kind === 'unknown' ? 'go' : kind;
    languages.add('go');
  }
  if (access.exists('Cargo.toml')) {
    kind = kind === 'unknown' ? 'rust' : kind;
    languages.add('rust');
  }

  if (access.exists('apps/desktop/package.json')) entryHints.push('apps/desktop');
  if (access.exists('packages/core/package.json')) entryHints.push('packages/core');

  const validationScripts =
    kind === 'node'
      ? npmValidationCommands(scripts)
      : kind === 'dotnet'
        ? ['dotnet build', 'dotnet test']
        : [];

  return {
    kind,
    languages: [...languages],
    packageName,
    version,
    scripts,
    validationScripts,
    entryHints: [...new Set(entryHints)].slice(0, 12),
    configFiles,
    lockfiles,
    workspaces,
  };
}

/** Bloc court injecté dans le prompt de plan (inspection avant modification). */
export function formatProjectInventoryBlock(inventory: ProjectInventory): string {
  const lines = [
    'Inventaire du dépôt (fichiers réellement présents) :',
    `- Type : ${inventory.kind}`,
    `- Langages : ${inventory.languages.length ? inventory.languages.join(', ') : 'non détecté'}`,
  ];
  if (inventory.packageName) lines.push(`- Paquet : ${inventory.packageName}${inventory.version ? ` @ ${inventory.version}` : ''}`);
  if (inventory.workspaces.length) lines.push(`- Workspaces : ${inventory.workspaces.join(', ')}`);
  if (inventory.validationScripts.length)
    lines.push(`- Commandes de validation détectées : ${inventory.validationScripts.join(' ; ')}`);
  if (inventory.configFiles.length) lines.push(`- Config : ${inventory.configFiles.join(', ')}`);
  if (inventory.entryHints.length) lines.push(`- Points d’entrée probables : ${inventory.entryHints.join(', ')}`);
  if (inventory.lockfiles.length) lines.push(`- Lockfiles : ${inventory.lockfiles.join(', ')}`);
  return lines.join('\n');
}
