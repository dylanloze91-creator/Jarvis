import { protectedRepoPath } from './repoPaths.js';
import type { ReviewedPlan } from './taskPolicy.js';

export interface CodeSearchMatch {
  file: string;
  line: number;
  text: string;
}

export type CodeSearcher = (pattern: string) => Promise<readonly CodeSearchMatch[]>;
export type PathExists = (relativePath: string) => boolean;

const STOP_SYMBOLS = new Set([
  'string',
  'number',
  'boolean',
  'export',
  'import',
  'const',
  'function',
  'async',
  'await',
  'return',
  'type',
  'interface',
  'class',
  'from',
  'true',
  'false',
  'null',
  'undefined',
  'jarvis',
  'fichier',
  'fichiers',
  'modifier',
  'ajoute',
  'ajouter',
  'tests',
  'test',
]);

const SKIP_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
]);

/** Chemins ignorés pour la localisation de symboles (build, deps, secrets). */
export function isSkippedSymbolPath(relative: string): boolean {
  if (protectedRepoPath(relative)) return true;
  const segments = relative.toLowerCase().split('/');
  return segments.some((s) => SKIP_DIR_SEGMENTS.has(s));
}

function extractSymbols(request: string, plan: ReviewedPlan): string[] {
  const blob = [
    request,
    plan.summary,
    ...plan.criteria,
    ...plan.files.map((f) => `${f.path} ${f.reason}`),
  ].join('\n');
  const found = new Set<string>();
  const patterns = [
    /\b([A-Z][A-Z0-9_]{2,})\b/g,
    /\b([A-Z][a-z][a-zA-Z0-9]*)\b/g,
    /\b([a-z][a-zA-Z0-9]{3,})\b/g,
  ];
  for (const re of patterns) {
    for (const match of blob.matchAll(re)) {
      const sym = match[1]!;
      if (STOP_SYMBOLS.has(sym.toLowerCase())) continue;
      if (/^\d+$/.test(sym)) continue;
      found.add(sym);
    }
  }
  return [...found].slice(0, 12);
}

export interface SymbolResolution {
  symbol: string;
  plannedPath: string;
  resolvedPath: string;
  line: number;
  snippet: string;
}

export interface EditSymbolContextResult {
  block: string;
  resolutions: SymbolResolution[];
  /** Plan avec chemins corrigés quand la recherche a trouvé le symbole ailleurs. */
  plan: ReviewedPlan;
}

function uniqueFiles(matches: readonly CodeSearchMatch[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (isSkippedSymbolPath(m.file)) continue;
    if (seen.has(m.file)) continue;
    seen.add(m.file);
    out.push(m.file);
  }
  return out;
}

/**
 * Avant la modification : localise exports / symboles cités par recherche,
 * sans se fier au seul nom de fichier du plan.
 */
export async function buildEditSymbolContext(input: {
  request: string;
  plan: ReviewedPlan;
  exists: PathExists;
  search: CodeSearcher;
}): Promise<EditSymbolContextResult> {
  const symbols = extractSymbols(input.request, input.plan);
  const resolutions: SymbolResolution[] = [];
  const pathByPlanned = new Map<string, string>();

  for (const symbol of symbols) {
    const matches = await input.search(symbol);
    const files = uniqueFiles(matches);
    if (!files.length) continue;
    const primary = files[0]!;
    const match = matches.find((m) => m.file === primary) ?? matches[0]!;
    const planned = input.plan.files.find(
      (f) =>
        (f.action === 'edit' || f.action === 'create') &&
        (f.path === primary ||
          f.path.endsWith(`/${symbol}.ts`) ||
          f.path.endsWith(`/${symbol}.tsx`) ||
          f.path.toLowerCase().includes(symbol.toLowerCase())),
    );
    const guessed = input.plan.files.find(
      (f) =>
        f.action === 'edit' &&
        !input.exists(f.path) &&
        files.length &&
        !files.includes(f.path),
    );
    const plannedPath = planned?.path ?? guessed?.path;
    if (!plannedPath || plannedPath === primary) continue;
    if (input.exists(plannedPath)) continue;
    if (files.includes(plannedPath)) continue;
    resolutions.push({
      symbol,
      plannedPath,
      resolvedPath: primary,
      line: match.line,
      snippet: match.text.trim().slice(0, 160),
    });
    pathByPlanned.set(plannedPath, primary);
  }

  for (const file of input.plan.files) {
    if (file.action !== 'edit' || input.exists(file.path)) continue;
    const base = file.path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    if (!base || base.length < 3) continue;
    const matches = await input.search(base);
    const files = uniqueFiles(matches);
    if (files.length !== 1 || files[0] === file.path) continue;
    if (!resolutions.some((r) => r.plannedPath === file.path)) {
      const m = matches.find((x) => x.file === files[0]!)!;
      resolutions.push({
        symbol: base,
        plannedPath: file.path,
        resolvedPath: files[0]!,
        line: m.line,
        snippet: m.text.trim().slice(0, 160),
      });
      pathByPlanned.set(file.path, files[0]!);
    }
  }

  const plan: ReviewedPlan = {
    ...input.plan,
    files: input.plan.files.map((f) => {
      const resolved = pathByPlanned.get(f.path);
      if (!resolved) return f;
      const present = input.exists(resolved);
      return {
        ...f,
        path: resolved,
        exists: present,
        problem: present ? null : f.problem,
        reason: `${f.reason} (fichier réel : ${resolved})`,
      };
    }),
  };

  if (!resolutions.length) {
    return { block: '', resolutions, plan };
  }

  const lines = [
    'Localisation réelle (recherche git, hors node_modules / build / secrets) — ne modifie pas un fichier deviné si le symbole est ailleurs :',
    ...resolutions.map(
      (r) =>
        `- « ${r.symbol} » : utilise \`${r.resolvedPath}\`${r.line ? `:${r.line}` : ''} (pas \`${r.plannedPath}\`).${r.snippet ? ` Extrait : ${r.snippet}` : ''}`,
    ),
  ];
  return { block: lines.join('\n'), resolutions, plan };
}
