import { describe, expect, it } from 'vitest';
import { buildArchitectureReport, layerOf, type ArchitectureFacts } from './architecture.js';

const FACTS: ArchitectureFacts = {
  version: '0.4.23',
  branch: 'main',
  head: 'abcdef0123456789',
  dirtyFiles: 2,
  files: [
    'package.json',
    'CLAUDE.md',
    'apps/desktop/src/main/tools/index.ts',
    'apps/desktop/src/main/tools/files.ts',
    'apps/desktop/src/main/tools/files.test.ts',
    'apps/desktop/src/main/developer/runner.ts',
    'apps/desktop/src/renderer/src/components/ConfirmationCard.tsx',
    'apps/desktop/src/renderer/src/voice/useVoice.ts',
    'apps/desktop/src/shared/ipc.ts',
    'packages/core/src/agent/agent.ts',
    'packages/core/src/tools/manager.ts',
    'packages/core/src/settings.ts',
  ],
  lineCounts: {
    'apps/desktop/src/main/tools/index.ts': 102,
    'apps/desktop/src/main/tools/files.ts': 300,
    'apps/desktop/src/main/tools/files.test.ts': 120,
    'packages/core/src/agent/agent.ts': 574,
  },
  packages: [
    {
      path: '',
      name: 'jarvis',
      version: '0.3.0',
      dependencies: 0,
      devDependencies: 7,
      scripts: ['dev', 'test', 'lint'],
    },
    {
      path: 'apps/desktop',
      name: '@jarvis/desktop',
      version: '0.4.23',
      dependencies: 12,
      devDependencies: 20,
      scripts: ['build'],
    },
  ],
  toolRegistry: { file: 'apps/desktop/src/main/tools/index.ts', line: 60 },
  toolDefinitions: [
    { file: 'apps/desktop/src/main/tools/files.ts', count: 6 },
    { file: 'apps/desktop/src/main/tools/index.ts', count: 0 },
  ],
  agent: { file: 'packages/core/src/agent/agent.ts', line: 120 },
  settings: { file: 'packages/core/src/settings.ts', line: 30 },
  toolManager: { file: 'packages/core/src/tools/manager.ts', line: 108 },
  confirmationCard: 'apps/desktop/src/renderer/src/components/ConfirmationCard.tsx',
  ipc: { file: 'apps/desktop/src/shared/ipc.ts', channels: 59 },
};

describe('rapport « Analyser mon architecture »', () => {
  const report = buildArchitectureReport(FACTS, new Date(2026, 9, 2, 14, 30));

  it('répond à « où sont enregistrés les outils ? » avec le vrai fichier et la ligne', () => {
    expect(report).toContain(
      '**Où sont enregistrés les outils ?** Dans `apps/desktop/src/main/tools/index.ts` (ligne 60), fonction `createToolManager`',
    );
  });

  it('cite l’agent, le gestionnaire d’outils, la carte de confirmation, les réglages et l’IPC', () => {
    expect(report).toContain('`packages/core/src/agent/agent.ts` (ligne 120)');
    expect(report).toContain('`packages/core/src/tools/manager.ts` (ligne 108)');
    expect(report).toContain('`apps/desktop/src/renderer/src/components/ConfirmationCard.tsx`');
    expect(report).toContain('`packages/core/src/settings.ts` (ligne 30)');
    expect(report).toContain('59 canaux dans `apps/desktop/src/shared/ipc.ts`');
  });

  it('compte les fichiers, les tests, les lignes et les modifications en cours', () => {
    expect(report.replace(/[\u202f\u00a0]/g, ' ')).toContain(
      '12 fichiers suivis par git, dont 10 fichiers de code (1 096 lignes) et 1 fichiers de tests.',
    );
    expect(report).toContain('2 fichier(s) modifié(s)');
    expect(report).toContain('| Outils du chat (Windows, fichiers, web…) | 3 | 1 | 522 |');
    expect(report).toContain('`@jarvis/desktop` | `apps/desktop` | 0.4.23');
  });

  it('dit honnêtement ce qui manque, sans inventer', () => {
    const empty = buildArchitectureReport(
      { ...FACTS, toolRegistry: null, agent: null, ipc: null },
      new Date(2026, 9, 2),
    );
    expect(empty).toContain('Dans un fichier introuvable (createToolManager absent)');
    expect(empty).toContain('**Où vit l’agent (la boucle modèle → outils) ?** introuvable.');
    expect(report).toContain('aucun modèle IA n’a été utilisé');
  });

  it('range chaque fichier dans une seule couche', () => {
    expect(layerOf('apps/desktop/src/main/developer/runner.ts').id).toBe('developer');
    expect(layerOf('apps/desktop/src/renderer/src/voice/useVoice.ts').id).toBe('voice');
    expect(layerOf('apps/desktop/src/main/tools/index.ts').id).toBe('tools');
    expect(layerOf('packages/core/src/settings.ts').id).toBe('core-other');
    expect(layerOf('README.md').id).toBe('other');
  });
});
