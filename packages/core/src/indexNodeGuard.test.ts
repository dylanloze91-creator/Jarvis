/**
 * La fenêtre importe `@jarvis/core`. Un `import` Node dans un module de l'index
 * casse `electron-vite build` (le module Node est remplacé par un module vide).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = dirname(fileURLToPath(import.meta.url));

function directExports(indexSource: string): string[] {
  const paths: string[] = [];
  const re = /from\s+['"](\.\/[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(indexSource))) {
    const spec = match[1];
    if (spec) paths.push(spec);
  }
  return paths;
}

/** Imports `node:` qui restent au runtime. `import type` est ignoré. */
export function runtimeNodeImports(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  const re = /(^|\n)\s*import\s+([\s\S]*?)\s+from\s+['"](node:[^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const clause = (match[2] ?? '').trim();
    const specifier = match[3] ?? '';
    if (/^type\b/.test(clause)) continue;
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named?.[1]) {
      const parts = named[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 0 && parts.every((part) => part.startsWith('type '))) continue;
    }
    found.push(specifier);
  }
  return found;
}

describe('index du cœur sans module Node', () => {
  it('aucun module exporté directement n’importe node: au runtime', () => {
    const indexSource = readFileSync(join(srcRoot, 'index.ts'), 'utf8');
    const offenders: string[] = [];
    for (const spec of directExports(indexSource)) {
      const file = join(srcRoot, spec.replace(/^\.\//, '').replace(/\.js$/, '.ts'));
      const nodeImports = runtimeNodeImports(readFileSync(file, 'utf8'));
      if (nodeImports.length > 0) offenders.push(`${spec} → ${nodeImports.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('un import node: dans notes.ts serait refusé', () => {
    const sample = "import { readFile } from 'node:fs/promises';\nexport const x = 1;\n";
    expect(runtimeNodeImports(sample)).toEqual(['node:fs/promises']);
    expect(runtimeNodeImports("import type { Dirent } from 'node:fs';\n")).toEqual([]);
  });
});
