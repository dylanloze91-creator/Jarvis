import { describe, expect, it } from 'vitest';
import { coreFileReason } from './coreFiles.js';

describe('cœur du système : toujours confirmé, même dans le plan', () => {
  it.each([
    ['packages/core/src/agent/agent.ts', /agent/],
    ['packages/core/src/tools/permissions.ts', /outils/],
    ['packages/core/src/security/redact.ts', /sécurité/],
    ['packages/core/src/settings.ts', /réglages/],
    ['packages/core/src/providers/ollama.ts', /fournisseurs/],
    ['packages/core/src/developer/commandSafety.ts', /Développeur/],
    ['apps/desktop/src/main/developer/runner.ts', /Développeur/],
    ['apps/desktop/src/renderer/src/components/developer/DeveloperPanel.tsx', /Développeur/],
    ['apps/desktop/src/main/index.ts', /démarrage/],
    ['apps/desktop/src/main/session.ts', /chat/],
    ['apps/desktop/src/main/tools/index.ts', /registre/],
    ['apps/desktop/src/main/tools/shell.ts', /commandes/],
    ['apps/desktop/src/main/tools/platform/exec.ts', /commandes/],
    ['apps/desktop/src/preload/index.ts', /IPC/],
    ['apps/desktop/src/shared/ipc.ts', /IPC/],
    ['apps/desktop/electron-builder.yml', /installation/],
    ['apps/desktop/scripts/setup-voice-assets.mjs', /installation/],
    ['package.json', /npm/],
    ['apps/desktop/package.json', /npm/],
    ['package-lock.json', /npm/],
    ['CLAUDE.md', /CLAUDE/],
    ['apps/desktop/src/main/__golden__/chat-0.4.22/catalogue.json', /figés/],
    ['packages/core/src/providers/ollama-unchanged.test.ts', /./],
    ['apps/desktop/src/main/chat-unchanged.test.ts', /figés/],
    ['eslint.config.js', /vérifications/],
    ['packages/core/tsconfig.json', /vérifications/],
    ['apps/desktop/vitest.config.ts', /vérifications/],
  ])('%s', (path, reason) => {
    expect(coreFileReason(path)).toMatch(reason);
  });

  it('ne se contourne ni par la casse, ni par les barres inverses, ni par un point final', () => {
    expect(coreFileReason('Packages\\Core\\src\\Agent\\agent.ts')).toMatch(/agent/);
    expect(coreFileReason('claude.MD')).toMatch(/CLAUDE/);
    expect(coreFileReason('CLAUDE.md.')).toMatch(/CLAUDE/);
    expect(coreFileReason('./apps/desktop/src/main/index.ts')).toMatch(/démarrage/);
  });

  it('un chemin invalide compte comme cœur', () => {
    expect(coreFileReason('../outside.ts')).toBe('chemin invalide');
    expect(coreFileReason('C:\\Windows\\x.ts')).toBe('chemin invalide');
    expect(coreFileReason('')).toBe('chemin invalide');
  });

  it.each([
    'apps/desktop/src/main/tools/version.ts',
    'apps/desktop/src/main/tools/version.test.ts',
    'packages/core/src/web/format.ts',
    'apps/desktop/src/renderer/src/components/HistoryPanel.tsx',
    'docs/notes.md',
  ])('hors cœur : %s', (path) => {
    expect(coreFileReason(path)).toBeNull();
  });
});
