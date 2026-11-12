import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { testBuilder, testBuilderCliArgs } = require('../../scripts/packageTestConfig.mjs') as {
  testBuilder: {
    appId: string;
    productName: string;
    jarvisEdition: string;
    output: string;
  };
  testBuilderCliArgs: () => string[];
};

const here = fileURLToPath(new URL('.', import.meta.url));
const desktop = resolve(here, '../..');
const root = resolve(desktop, '../..');

describe('construction de Jarvis Test', () => {
  it('a un autre appId et un autre nom, et ne change pas package:win', () => {
    const yml = readFileSync(resolve(desktop, 'electron-builder.yml'), 'utf8');
    expect(yml).toContain('appId: com.thedexios.jarvis');
    expect(yml).toContain('productName: Jarvis');
    expect(testBuilder.appId).toBe('com.thedexios.jarvis.test');
    expect(testBuilder.productName).toBe('Jarvis Test');
    expect(testBuilder.appId).not.toBe('com.thedexios.jarvis');
    expect(testBuilder.productName).not.toBe('Jarvis');
    expect(testBuilder.jarvisEdition).toBe('test');
    expect(testBuilder.output).toBe('release-test');
    const args = testBuilderCliArgs().join(' ');
    expect(args).toContain('com.thedexios.jarvis.test');
    expect(args).toContain('Jarvis Test');
    expect(args).not.toContain('latest.yml');

    const desktopPkg = JSON.parse(readFileSync(resolve(desktop, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(desktopPkg.scripts['package:win']).toBe(
      'npm run build && node scripts/setup-piper.mjs --target win-x64 && node scripts/verify-piper-windows-bundle.mjs && electron-builder --win --publish never',
    );
    expect(desktopPkg.scripts['package:win:test']).toContain('package-test.mjs');

    const release = readFileSync(resolve(root, 'release.sh'), 'utf8');
    expect(release).not.toContain('package:win:test');
    const draft = readFileSync(resolve(root, 'release-test.sh'), 'utf8');
    expect(draft).toContain('--prerelease');
    expect(draft).toContain('test.yml');
    expect(draft).toContain('5\\.1\\.');
  });
});
