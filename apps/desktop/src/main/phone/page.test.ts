import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.ts'),
  'utf8',
);

describe('phone/page.ts — sources compactes', () => {
  it('affiche les liens avec createElement(a) et textContent, jamais innerHTML', () => {
    expect(PAGE_JS).toContain("createElement('a')");
    expect(PAGE_JS).toContain('textContent = link.label');
    expect(PAGE_JS).not.toMatch(/innerHTML\s*=\s*[^'"]/);
    expect(PAGE_JS).toContain('Sources : ');
  });
});
