import { describe, expect, it } from 'vitest';
import { PIPER_WINDOWS_BUNDLE_CHECKS, resolvePiperBinaryTarget } from './piperAssets.js';

describe('resolvePiperBinaryTarget', () => {
  it('force win-x64 quand JARVIS_PIPER_TARGET=win-x64 sur Linux', () => {
    expect(resolvePiperBinaryTarget({ platform: 'linux', targetOverride: 'win-x64' })).toBe('win-x64');
  });

  it('prend linux-x64 sur Linux sans override', () => {
    expect(resolvePiperBinaryTarget({ platform: 'linux' })).toBe('linux-x64');
  });

  it('prend win-x64 sur Windows sans override', () => {
    expect(resolvePiperBinaryTarget({ platform: 'win32' })).toBe('win-x64');
  });
});

describe('PIPER_WINDOWS_BUNDLE_CHECKS', () => {
  it('exige piper.exe, les DLL et espeak-ng-data', () => {
    const paths = PIPER_WINDOWS_BUNDLE_CHECKS.map((check) => check.relativePath);
    expect(paths).toContain('bin/win-x64/piper/piper.exe');
    expect(paths).toContain('bin/win-x64/piper/espeak-ng-data/fr_dict');
    expect(paths.some((path) => path.endsWith('.dll'))).toBe(true);
  });
});
