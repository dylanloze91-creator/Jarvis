import { describe, expect, it } from 'vitest';
import { detectProjectInventory, formatProjectInventoryBlock } from './projectInventory.js';

function access(files: Record<string, string>) {
  return {
    exists: (rel: string) => rel in files,
    readUtf8: (rel: string) => files[rel] ?? null,
  };
}

describe('detectProjectInventory', () => {
  it('détecte un monorepo Node/TS', () => {
    const inv = detectProjectInventory(
      access({
        'package.json': JSON.stringify({
          name: 'jarvis',
          version: '5.0.18',
          workspaces: ['packages/*', 'apps/*'],
          scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', build: 'npm run build' },
        }),
        'tsconfig.json': '{}',
        'apps/desktop/package.json': '{}',
      }),
    );
    expect(inv.kind).toBe('node');
    expect(inv.languages).toContain('typescript');
    expect(inv.validationScripts.some((c) => c.includes('typecheck'))).toBe(true);
    expect(formatProjectInventoryBlock(inv)).toContain('5.0.18');
  });

  it('détecte .NET sans inventer npm test', () => {
    const inv = detectProjectInventory(access({ 'App.csproj': '<Project />' }));
    expect(inv.kind).toBe('dotnet');
    expect(inv.validationScripts[0]).toContain('dotnet');
    expect(inv.scripts).toEqual({});
  });
});
