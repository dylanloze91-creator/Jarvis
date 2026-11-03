import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PIPER_WINDOWS_BUNDLE_CHECKS } from '@jarvis/core';

const require = createRequire(import.meta.url);
const { verifyPiperWindowsBundle } = require('./piperWindowsBundle.cjs');

describe('verifyPiperWindowsBundle (installateur Windows)', () => {
  it('refuse un dossier sans piper.exe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'piper-pack-'));
    try {
      const problems = verifyPiperWindowsBundle(dir, PIPER_WINDOWS_BUNDLE_CHECKS);
      expect(problems.some((line: string) => line.includes('piper.exe'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepte piper.exe, DLL et espeak-ng-data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'piper-pack-'));
    try {
      for (const check of PIPER_WINDOWS_BUNDLE_CHECKS) {
        const file = join(dir, ...check.relativePath.split('/'));
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, Buffer.alloc(check.minBytes));
      }
      expect(verifyPiperWindowsBundle(dir, PIPER_WINDOWS_BUNDLE_CHECKS)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
