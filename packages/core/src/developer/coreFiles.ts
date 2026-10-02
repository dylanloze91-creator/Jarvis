import { normalizeRepoRelative } from './repoPaths.js';

/**
 * « Cœur du système » (plan, §5) : un fichier de cette liste redemande
 * toujours confirmation avec son diff, même s'il est dans le plan validé.
 * Jarvis ne peut pas desserrer ses propres garde-fous sans l'utilisateur.
 */
const CORE_RULES: ReadonlyArray<{ test: (path: string) => boolean; reason: string }> = [
  { test: (p) => p.startsWith('packages/core/src/agent/'), reason: 'agent du chat' },
  {
    test: (p) => p.startsWith('packages/core/src/tools/'),
    reason: 'gestionnaire d’outils et permissions',
  },
  { test: (p) => p.startsWith('packages/core/src/security/'), reason: 'sécurité' },
  { test: (p) => p.startsWith('packages/core/src/audit/'), reason: 'journal d’audit' },
  {
    test: (p) => p.startsWith('packages/core/src/providers/'),
    reason: 'fournisseurs du modèle (requêtes du chat figées par des tests)',
  },
  { test: (p) => p === 'packages/core/src/settings.ts', reason: 'réglages' },
  {
    test: (p) =>
      p.startsWith('packages/core/src/developer/') ||
      p.startsWith('apps/desktop/src/main/developer/') ||
      p.startsWith('apps/desktop/src/renderer/src/components/developer/'),
    reason: 'module Jarvis Développeur lui-même',
  },
  {
    test: (p) =>
      [
        'apps/desktop/src/main/index.ts',
        'apps/desktop/src/main/startup.ts',
        'apps/desktop/src/main/window.ts',
      ].includes(p),
    reason: 'démarrage et fenêtre de l’application',
  },
  {
    test: (p) => p === 'apps/desktop/src/main/session.ts',
    reason: 'session du chat (agent)',
  },
  { test: (p) => p === 'apps/desktop/src/main/store.ts', reason: 'réglages (fichier)' },
  {
    test: (p) =>
      p === 'apps/desktop/src/main/mediaPermissions.ts' ||
      p === 'apps/desktop/src/main/audit-store.ts',
    reason: 'sécurité (autorisations, journal)',
  },
  {
    test: (p) =>
      [
        'apps/desktop/src/main/tools/index.ts',
        'apps/desktop/src/main/tools/shell.ts',
        'apps/desktop/src/main/tools/filesystem.ts',
      ].includes(p) || p.startsWith('apps/desktop/src/main/tools/platform/'),
    reason: 'registre des outils, commandes et suppressions',
  },
  {
    test: (p) =>
      p.startsWith('apps/desktop/src/preload/') || p.startsWith('apps/desktop/src/shared/'),
    reason: 'canaux IPC',
  },
  {
    test: (p) => p === 'apps/desktop/src/renderer/src/components/confirmationcard.tsx',
    reason: 'carte de confirmation',
  },
  {
    test: (p) =>
      [
        'apps/desktop/electron-builder.yml',
        'apps/desktop/electron.vite.config.ts',
        'apps/desktop/vite.ui.config.ts',
      ].includes(p) || p.startsWith('apps/desktop/scripts/'),
    reason: 'configuration de construction et d’installation',
  },
  {
    test: (p) => /(^|\/)package(-lock)?\.json$/.test(p) || /(^|\/)\.npmrc$/.test(p),
    reason: 'dépendances et scripts npm',
  },
  { test: (p) => p === 'claude.md', reason: 'règles du projet (CLAUDE.md)' },
  {
    test: (p) =>
      p.includes('/__golden__/') ||
      p.endsWith('/chat-unchanged.test.ts') ||
      p.endsWith('/ollama-unchanged.test.ts'),
    reason: 'tests de référence figés (jamais régénérés)',
  },
  {
    test: (p) =>
      p === 'eslint.config.js' ||
      /(^|\/)tsconfig[^/]*\.json$/.test(p) ||
      /(^|\/)vitest\.config\.[cm]?[jt]s$/.test(p) ||
      p === '.gitignore' ||
      p.startsWith('.github/'),
    reason: 'configuration des vérifications',
  },
];

/**
 * Raison si le fichier fait partie du cœur, sinon null. Comparaison sans
 * casse (Windows) ; un chemin illisible compte comme cœur.
 */
export function coreFileReason(path: string): string | null {
  const rel = normalizeRepoRelative(path);
  if (rel === null || rel === '') return 'chemin invalide';
  const lower = rel.toLowerCase().replace(/[.\s]+$/, '');
  for (const rule of CORE_RULES) if (rule.test(lower)) return rule.reason;
  return null;
}
