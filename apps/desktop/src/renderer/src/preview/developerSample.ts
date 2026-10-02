import type { ArchitectureFacts } from '@jarvis/core';

/** Faits d'aperçu proches de l'arbre réel (captures d'écran seulement, jamais utilisés par l'application). */
const AREAS: Array<[string, number, number]> = [
  ['apps/desktop/src/main/developer/', 16, 3_580],
  ['apps/desktop/src/renderer/src/voice/', 86, 13_623],
  ['apps/desktop/src/renderer/src/components/', 50, 6_264],
  ['apps/desktop/src/main/tools/', 38, 5_326],
  ['apps/desktop/src/main/google/', 70, 10_341],
  ['apps/desktop/src/main/', 32, 4_444],
  ['packages/core/src/agent/', 17, 2_818],
  ['packages/core/src/tools/', 15, 1_653],
  ['packages/core/src/providers/', 17, 3_030],
  ['packages/core/src/search/', 49, 5_319],
  ['packages/core/src/developer/', 14, 2_900],
];

const files: string[] = [];
const lineCounts: Record<string, number> = {};
for (const [dir, count, lines] of AREAS) {
  for (let i = 0; i < count; i += 1) {
    const file = `${dir}f${i}${i % 3 === 0 ? '.test' : ''}.ts`;
    files.push(file);
    lineCounts[file] = Math.round(lines / count);
  }
}

export const previewArchitectureFacts: ArchitectureFacts = {
  version: '0.4.23',
  branch: 'main',
  head: '9596179f649a9f4121c6ae65f6dcb4f0bc31b37',
  dirtyFiles: 0,
  files,
  lineCounts,
  packages: [
    {
      path: 'apps/desktop',
      name: '@jarvis/desktop',
      version: '0.4.23',
      dependencies: 2,
      devDependencies: 23,
      scripts: ['dev', 'build', 'typecheck', 'test', 'package:win'],
    },
    {
      path: '',
      name: 'jarvis',
      version: '0.3.0',
      dependencies: 0,
      devDependencies: 7,
      scripts: ['dev', 'build', 'typecheck', 'test', 'lint'],
    },
    {
      path: 'packages/core',
      name: '@jarvis/core',
      version: '0.1.0',
      dependencies: 1,
      devDependencies: 1,
      scripts: ['build', 'typecheck', 'test'],
    },
  ],
  toolRegistry: { file: 'apps/desktop/src/main/tools/index.ts', line: 64 },
  toolDefinitions: [
    { file: 'apps/desktop/src/main/tools/google.ts', count: 16 },
    { file: 'apps/desktop/src/main/tools/knowledge.ts', count: 9 },
    { file: 'apps/desktop/src/main/tools/siteblock.ts', count: 8 },
    { file: 'apps/desktop/src/main/tools/spotify.ts', count: 8 },
    { file: 'apps/desktop/src/main/tools/personalization.ts', count: 5 },
  ],
  agent: { file: 'packages/core/src/agent/agent.ts', line: 132 },
  settings: { file: 'packages/core/src/settings.ts', line: 101 },
  toolManager: { file: 'packages/core/src/tools/manager.ts', line: 107 },
  confirmationCard: 'apps/desktop/src/renderer/src/components/ConfirmationCard.tsx',
  ipc: { file: 'apps/desktop/src/shared/ipc.ts', channels: 58 },
};
