import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../../../providers/registry.js';
import type { ChatRequest, ChatStreamEvent, LLMProvider } from '../../../providers/types.js';
import { createCodeAIProvider } from '../../codeProvider.js';
import { classifyCommand } from '../../commandSafety.js';
import type { RepoFacts } from '../../repoCheck.js';
import { MAX_TEST_SERIES } from '../../taskPlan.js';
import type { ReviewedPlan } from '../../taskPolicy.js';
import {
  editPrompt,
  editSystemPrompt,
  fixSystemPrompt,
  planPrompt,
  planSystemPrompt,
} from '../../taskPrompts.js';
import { JARVIS_PROJECT_PROFILE as profile } from './jarvis.js';

/**
 * Valeurs relevées sur l'arbre 0.4.26 (commit a22ddca) avant la création du
 * profil. Ne jamais les régénérer pour faire passer ce test : un écart veut
 * dire que Jarvis Développeur ne se comporte plus comme en 0.4.26.
 */
const PROMPT_CONTEXT_0426 =
  'Dépôt : Jarvis, monorepo TypeScript (npm workspaces).\n- packages/core : logique sans Electron (agent, outils, fournisseurs, réglages Zod, développeur).\n- apps/desktop : application Electron (main, preload, renderer React).\nTests : Vitest à côté des fichiers (*.test.ts). Code et messages en français.';

const CODE_SYSTEM_0426 =
  'Tu es le modèle de code de Jarvis Développeur, un assistant qui travaille sur le code de l’application Jarvis (TypeScript, Electron, React). Réponds en français. N’invente aucun fichier ni aucune fonction : appuie-toi seulement sur ce qu’on te montre.';

const TEST_SUITES_0426 = {
  typecheck: {
    label: 'Vérification des types',
    npmArgs: ['run', 'typecheck'],
  },
  'test-core': {
    label: 'Tests du cœur',
    npmArgs: ['run', 'test', '--workspace', '@jarvis/core'],
  },
  'test-desktop': {
    label: 'Tests de l’application',
    npmArgs: ['run', 'test', '--workspace', '@jarvis/desktop'],
  },
  test: {
    label: 'Tous les tests',
    npmArgs: ['test'],
  },
  lint: {
    label: 'Lint',
    npmArgs: ['run', 'lint'],
  },
};

const CANDIDATES_WIN_0426 = [
  'C:\\dev\\Jarvis',
  'C:\\Users\\thedexios\\dev\\Jarvis',
  'C:\\Users\\thedexios\\source\\repos\\Jarvis',
  'C:\\Users\\thedexios\\Documents\\Jarvis',
  'C:\\Users\\thedexios\\Jarvis',
  'D:\\dev\\Jarvis',
];

const CANDIDATES_LINUX_0426 = [
  '/home/thedexios/dev/Jarvis',
  '/home/thedexios/Jarvis',
  '/home/thedexios/src/Jarvis',
];

const PROTECTED_0426: Record<string, string | null> = {
  'packages/core/src/agent/agent.ts': 'agent du chat',
  'packages/core/src/tools/manager.ts': 'gestionnaire d’outils et permissions',
  'packages/core/src/security/redact.ts': 'sécurité',
  'packages/core/src/audit/log.ts': 'journal d’audit',
  'packages/core/src/providers/ollama.ts':
    'fournisseurs du modèle (requêtes du chat figées par des tests)',
  'packages/core/src/settings.ts': 'réglages',
  'packages/core/src/developer/taskPlan.ts': 'module Jarvis Développeur lui-même',
  'packages/core/src/developer/engine/profiles/jarvis.ts': 'module Jarvis Développeur lui-même',
  'apps/desktop/src/main/developer/runner.ts': 'module Jarvis Développeur lui-même',
  'apps/desktop/src/renderer/src/components/developer/DeveloperPanel.tsx':
    'module Jarvis Développeur lui-même',
  'apps/desktop/src/main/index.ts': 'démarrage et fenêtre de l’application',
  'apps/desktop/src/main/session.ts': 'session du chat (agent)',
  'apps/desktop/src/main/store.ts': 'réglages (fichier)',
  'apps/desktop/src/main/audit-store.ts': 'sécurité (autorisations, journal)',
  'apps/desktop/src/main/tools/index.ts': 'registre des outils, commandes et suppressions',
  'apps/desktop/src/main/tools/shell.ts': 'registre des outils, commandes et suppressions',
  'apps/desktop/src/main/tools/platform/exec.ts': 'registre des outils, commandes et suppressions',
  'apps/desktop/src/preload/index.ts': 'canaux IPC',
  'apps/desktop/src/shared/ipc.ts': 'canaux IPC',
  'apps/desktop/src/renderer/src/components/ConfirmationCard.tsx': 'carte de confirmation',
  'apps/desktop/electron-builder.yml': 'configuration de construction et d’installation',
  'apps/desktop/scripts/setup-voice-assets.mjs': 'configuration de construction et d’installation',
  'package.json': 'dépendances et scripts npm',
  'apps/desktop/package.json': 'dépendances et scripts npm',
  'package-lock.json': 'dépendances et scripts npm',
  'CLAUDE.md': 'règles du projet (CLAUDE.md)',
  'apps/desktop/src/main/__golden__/chat-0.4.22/x.json':
    'tests de référence figés (jamais régénérés)',
  'apps/desktop/src/main/chat-unchanged.test.ts': 'tests de référence figés (jamais régénérés)',
  'eslint.config.js': 'configuration des vérifications',
  'tsconfig.base.json': 'configuration des vérifications',
  '.gitignore': 'configuration des vérifications',
  '.github/workflows/a.yml': 'configuration des vérifications',
  'apps/desktop/src/main/tools/spotify.ts': null,
  'packages/core/src/search/chain.ts': null,
  'apps/desktop/src/renderer/src/App.tsx': null,
  'README.md': null,
  '../x.ts': 'chemin invalide',
  'C:/x.ts': 'chemin invalide',
  'APPS/DESKTOP/SRC/MAIN/INDEX.TS': 'démarrage et fenêtre de l’application',
};

const ROOT_SCRIPTS_0426: Record<string, string> = {
  dev: 'npm run dev --workspace @jarvis/desktop',
  build: 'npm run build --workspace @jarvis/core && npm run build --workspace @jarvis/desktop',
  'package:win':
    'npm run build --workspace @jarvis/core && npm run package:win --workspace @jarvis/desktop',
  'package:win:publish':
    'npm run build --workspace @jarvis/core && npm run package:win:publish --workspace @jarvis/desktop',
  typecheck:
    'npm run build --workspace @jarvis/core && npm run typecheck --workspaces --if-present',
  test: 'npm run test --workspaces --if-present',
  lint: 'eslint .',
  format: 'prettier --write "**/*.{ts,tsx,json,md,css}"',
};

const SANDBOX_COMMANDS_0426 = {
  'npm run typecheck': {
    level: 'auto',
    reasons: ['npm run typecheck : liste fixe, dans la copie isolée'],
  },
  'npm run test --workspace @jarvis/core': {
    level: 'auto',
    reasons: ['npm run test : liste fixe, dans la copie isolée'],
  },
  'npm run test --workspace @jarvis/desktop': {
    level: 'auto',
    reasons: ['npm run test : liste fixe, dans la copie isolée'],
  },
  'npm test': {
    level: 'auto',
    reasons: ['npm run test : liste fixe, dans la copie isolée'],
  },
  'npm run lint': {
    level: 'auto',
    reasons: ['npm run lint : liste fixe, dans la copie isolée'],
  },
  'npm run test --workspace @autre/paquet': {
    level: 'always-confirm',
    reasons: ['« npm run test » avec des options ou arguments hors de la liste fixe'],
  },
  'npm run build': {
    level: 'always-confirm',
    reasons: ['build complet : setup:voice télécharge des fichiers (réseau)'],
  },
  'npm run package:win:publish': {
    level: 'denied',
    reasons: ['script de publication « package:win:publish » : Jarvis ne publie jamais'],
  },
};

const GOOD: RepoFacts = {
  path: 'C:\\dev\\Jarvis',
  exists: true,
  isDirectory: true,
  hasGit: true,
  rootPackageName: 'jarvis',
  desktopPackageName: '@jarvis/desktop',
  desktopVersion: '0.4.26',
  originUrl: 'https://github.com/dylanloze91-creator/Jarvis.git',
  branch: 'main',
  head: 'a22ddca5bd717b85dc4303fb4bb9c67521a3027f',
  dirtyFiles: 0,
  hasNodeModules: true,
};
const FACTS: Record<string, RepoFacts> = {
  good: GOOD,
  trap: { ...GOOD, desktopVersion: '0.3.0' },
  other: {
    ...GOOD,
    path: 'C:\\Users\\thedexios\\OneDrive\\Jarvis',
    rootPackageName: 'autre',
    originUrl: 'git@github.com:a/b.git',
    hasNodeModules: false,
    dirtyFiles: 2,
  },
  missing: { path: 'C:\\dev\\Jarvis', exists: false, isDirectory: false, hasGit: false },
};

const VALIDATE_0426 = {
  good: {
    ok: true,
    checks: [
      {
        id: 'folder',
        label: 'Dossier',
        status: 'ok',
        detail: 'C:\\dev\\Jarvis',
      },
      {
        id: 'git',
        label: 'Dépôt Git',
        status: 'ok',
        detail: 'Branche main, commit a22ddca',
      },
      {
        id: 'package',
        label: 'Code de Jarvis',
        status: 'ok',
        detail: 'package.json « jarvis » et « @jarvis/desktop » trouvés.',
      },
      {
        id: 'version',
        label: 'Version',
        status: 'ok',
        detail: '0.4.26 (Jarvis installé : 0.4.26)',
      },
      {
        id: 'remote',
        label: 'Dépôt d’origine',
        status: 'ok',
        detail: 'github.com/dylanloze91-creator/Jarvis',
      },
      {
        id: 'dependencies',
        label: 'Dépendances',
        status: 'ok',
        detail: 'node_modules présent.',
      },
    ],
  },
  trap: {
    ok: false,
    checks: [
      {
        id: 'folder',
        label: 'Dossier',
        status: 'ok',
        detail: 'C:\\dev\\Jarvis',
      },
      {
        id: 'git',
        label: 'Dépôt Git',
        status: 'ok',
        detail: 'Branche main, commit a22ddca',
      },
      {
        id: 'package',
        label: 'Code de Jarvis',
        status: 'ok',
        detail: 'package.json « jarvis » et « @jarvis/desktop » trouvés.',
      },
      {
        id: 'version',
        label: 'Version',
        status: 'fail',
        detail:
          'Copie en 0.3.0, plus ancienne que le Jarvis installé (0.4.26). Mets-la à jour (git pull) avant de travailler dessus.',
        command: 'git pull',
      },
      {
        id: 'remote',
        label: 'Dépôt d’origine',
        status: 'ok',
        detail: 'github.com/dylanloze91-creator/Jarvis',
      },
      {
        id: 'dependencies',
        label: 'Dépendances',
        status: 'ok',
        detail: 'node_modules présent.',
      },
    ],
  },
  other: {
    ok: false,
    checks: [
      {
        id: 'folder',
        label: 'Dossier',
        status: 'ok',
        detail: 'C:\\Users\\thedexios\\OneDrive\\Jarvis',
      },
      {
        id: 'git',
        label: 'Dépôt Git',
        status: 'ok',
        detail: 'Branche main, commit a22ddca, 2 fichier(s) modifié(s)',
      },
      {
        id: 'package',
        label: 'Code de Jarvis',
        status: 'fail',
        detail: 'Ce n’est pas le code de Jarvis (package.json attendus absents).',
      },
      {
        id: 'version',
        label: 'Version',
        status: 'ok',
        detail: '0.4.26 (Jarvis installé : 0.4.26)',
      },
      {
        id: 'remote',
        label: 'Dépôt d’origine',
        status: 'warn',
        detail: 'Autre dépôt : git@github.com:a/b.git',
      },
      {
        id: 'onedrive',
        label: 'Synchronisation',
        status: 'warn',
        detail:
          'Ce dossier est dans OneDrive : préfère C:\\dev\\Jarvis (dépendances lourdes, fichiers verrouillés).',
      },
      {
        id: 'dependencies',
        label: 'Dépendances',
        status: 'warn',
        detail:
          'Pas encore installées : « Installer les dépendances » lance npm ci, avec ta confirmation.',
      },
    ],
  },
  missing: {
    ok: false,
    checks: [
      {
        id: 'folder',
        label: 'Dossier',
        status: 'fail',
        detail:
          '« C:\\dev\\Jarvis » n’existe pas encore. Jarvis peut cloner le code ici, avec ta confirmation.',
      },
    ],
  },
};

const PLAN: ReviewedPlan = {
  summary: 'Ajouter un outil qui donne la version.',
  criteria: ['le test passe'],
  files: [
    {
      path: 'apps/desktop/src/main/tools/version.ts',
      action: 'create',
      reason: 'nouvel outil',
      core: null,
      exists: false,
      problem: null,
    },
    {
      path: 'apps/desktop/src/main/tools/index.ts',
      action: 'edit',
      reason: 'enregistrement',
      core: 'registre des outils, commandes et suppressions',
      exists: true,
      problem: null,
    },
    {
      path: 'packages/core/src/old.ts',
      action: 'delete',
      reason: '',
      core: null,
      exists: true,
      problem: null,
    },
  ],
  tests: ['typecheck', 'test-desktop'],
};

const PROMPTS_0426 = {
  planSystem:
    'Tu es Jarvis Développeur. ÉTAPE : PLAN.\nDépôt : Jarvis, monorepo TypeScript (npm workspaces).\n- packages/core : logique sans Electron (agent, outils, fournisseurs, réglages Zod, développeur).\n- apps/desktop : application Electron (main, preload, renderer React).\nTests : Vitest à côté des fichiers (*.test.ts). Code et messages en français.\nTu prépares un plan de modification. Tu ne modifies rien à cette étape.\nUtilise les outils de lecture (dev_search_files, dev_search_code, dev_read_file) pour trouver les vrais fichiers, en peu d\'appels.\nTermine par un seul bloc JSON, sans autre texte après :\n{"resume": "ce qui va changer", "criteres": ["comment on saura que c\'est réussi"], "fichiers": [{"chemin": "chemin/relatif.ts", "action": "creer|modifier|supprimer", "pourquoi": "..."}], "tests": ["typecheck", "test-core"]}\nTests possibles : "typecheck" (Vérification des types), "test-core" (Tests du cœur), "test-desktop" (Tests de l’application), "test" (Tous les tests), "lint" (Lint).\nListe tous les fichiers à créer ou modifier, tests compris. Garde le plan petit.',
  planPrompt: "Demande de l'utilisateur :\nAjoute un outil.",
  editSystem:
    "Tu es Jarvis Développeur. ÉTAPE : MODIFICATION.\nDépôt : Jarvis, monorepo TypeScript (npm workspaces).\n- packages/core : logique sans Electron (agent, outils, fournisseurs, réglages Zod, développeur).\n- apps/desktop : application Electron (main, preload, renderer React).\nTests : Vitest à côté des fichiers (*.test.ts). Code et messages en français.\nTu travailles dans une copie isolée du dépôt, sur une branche jarvis-dev/*.\nPlan validé par l'utilisateur :\nAjouter un outil qui donne la version.\nFichiers :\n- créer apps/desktop/src/main/tools/version.ts : nouvel outil\n- modifier apps/desktop/src/main/tools/index.ts : enregistrement\n- supprimer packages/core/src/old.ts\nCritères : le test passe\nRègles :\n- Modifie seulement les fichiers du plan. Un autre fichier demandera l'accord de l'utilisateur.\n- Lis un fichier (dev_read_file) avant de le modifier.\n- dev_edit_file remplace un extrait EXACT et UNIQUE du fichier (copie-le tel quel, avec l'indentation) ; préfère plusieurs petits remplacements à un gros.\n- dev_create_file pour un nouveau fichier seulement.\n- Ne supprime rien sans raison : dev_delete_file demande toujours l'accord.\n- Jamais de secret, jamais de réseau, jamais de lancement de processus sans nécessité.\nQuand tout est fait, réponds par un court résumé, sans appel d'outil.",
  editPrompt: 'Fais les modifications du plan pour cette demande :\nAjoute un outil.',
  fixSystem:
    "Tu es Jarvis Développeur. ÉTAPE : CORRECTION (essai 2 sur 3).\nDépôt : Jarvis, monorepo TypeScript (npm workspaces).\n- packages/core : logique sans Electron (agent, outils, fournisseurs, réglages Zod, développeur).\n- apps/desktop : application Electron (main, preload, renderer React).\nTests : Vitest à côté des fichiers (*.test.ts). Code et messages en français.\nTes modifications ont fait échouer des tests. Corrige-les dans la copie isolée.\nPlan validé par l'utilisateur :\nAjouter un outil qui donne la version.\nFichiers :\n- créer apps/desktop/src/main/tools/version.ts : nouvel outil\n- modifier apps/desktop/src/main/tools/index.ts : enregistrement\n- supprimer packages/core/src/old.ts\nCritères : le test passe\nRègles :\n- Modifie seulement les fichiers du plan. Un autre fichier demandera l'accord de l'utilisateur.\n- Lis un fichier (dev_read_file) avant de le modifier.\n- dev_edit_file remplace un extrait EXACT et UNIQUE du fichier (copie-le tel quel, avec l'indentation) ; préfère plusieurs petits remplacements à un gros.\n- dev_create_file pour un nouveau fichier seulement.\n- Ne supprime rien sans raison : dev_delete_file demande toujours l'accord.\n- Jamais de secret, jamais de réseau, jamais de lancement de processus sans nécessité.\nQuand tout est fait, réponds par un court résumé, sans appel d'outil.",
};

describe('profil de projet Jarvis : valeurs identiques à 0.4.26', () => {
  it('identité et copie de travail', () => {
    expect(profile.id).toBe('jarvis');
    expect(profile.toolchain).toBe('node');
    expect(profile.repoUrl).toBe('https://github.com/dylanloze91-creator/Jarvis.git');
    expect(profile.suggestedPath).toBe('C:\\dev\\Jarvis');
    expect(profile.candidatePaths({ platform: 'win32', home: 'C:\\Users\\thedexios' })).toEqual(
      CANDIDATES_WIN_0426,
    );
    expect(profile.candidatePaths({ platform: 'linux', home: '/home/thedexios' })).toEqual(
      CANDIDATES_LINUX_0426,
    );
  });

  it('validation de la copie, piège de version compris', () => {
    for (const [name, facts] of Object.entries(FACTS)) {
      const oneDrive = name === 'other' ? [] : undefined;
      expect(profile.validate(facts, '0.4.26', oneDrive), name).toEqual(
        VALIDATE_0426[name as keyof typeof VALIDATE_0426],
      );
    }
    expect(profile.validate(FACTS.trap!, '0.4.26').ok).toBe(false);
  });

  it('liste fixe des tests, essais de correction et séries', () => {
    expect(profile.testSuites).toEqual(TEST_SUITES_0426);
    expect(profile.defaultTestSuites).toEqual(['typecheck', 'test-core']);
    expect(profile.maxFixAttempts).toBe(3);
    expect(MAX_TEST_SERIES).toBe(5);
  });

  it('fichiers du cœur : mêmes raisons, chemin par chemin', () => {
    for (const [path, reason] of Object.entries(PROTECTED_0426)) {
      expect(profile.protectedFileReason(path), path).toBe(reason);
    }
  });

  it('commandes automatiques dans la copie isolée : mêmes espaces de travail, mêmes scripts, même tri', () => {
    expect([...profile.knownWorkspaces].sort()).toEqual([
      '@jarvis/core',
      '@jarvis/desktop',
      'apps/desktop',
      'packages/core',
    ]);
    expect([...profile.autoScripts].sort()).toEqual(['lint', 'test', 'typecheck']);
    const context = {
      insideSandbox: true,
      branch: 'jarvis-dev/2026-10-03-essai',
      packageScripts: ROOT_SCRIPTS_0426,
    };
    for (const [command, expected] of Object.entries(SANDBOX_COMMANDS_0426)) {
      const actual = classifyCommand(command, context);
      expect({ level: actual.level, reasons: actual.reasons }, command).toEqual(expected);
    }
    expect(classifyCommand('npm run typecheck', {}).level).toBe('confirm');
  });

  it('les scripts npm racine du dépôt sont ceux de 0.4.26', () => {
    const root = JSON.parse(
      readFileSync(new URL('../../../../../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(root.scripts).toEqual(ROOT_SCRIPTS_0426);
  });

  it('branche de la copie isolée', () => {
    expect(profile.sandboxBranchPrefix).toBe('jarvis-dev/');
    const branch = profile.sandboxBranch(
      new Date('2026-10-03T12:00:00Z'),
      'Ajoute un outil qui donne la version !',
    );
    expect(branch).toBe('jarvis-dev/2026-10-03-ajoute-un-outil-qui-donne-la-version');
    expect(branch.startsWith(profile.sandboxBranchPrefix)).toBe(true);
  });

  it('consignes de plan, de modification et de correction : texte identique', () => {
    expect(profile.promptContext).toBe(PROMPT_CONTEXT_0426);
    expect(planSystemPrompt()).toBe(PROMPTS_0426.planSystem);
    expect(planPrompt('  Ajoute un outil.  ')).toBe(PROMPTS_0426.planPrompt);
    expect(editSystemPrompt(PLAN)).toBe(PROMPTS_0426.editSystem);
    expect(editPrompt('Ajoute un outil.')).toBe(PROMPTS_0426.editPrompt);
    expect(fixSystemPrompt(PLAN, 2, 3)).toBe(PROMPTS_0426.fixSystem);
  });

  it('consigne système du fournisseur de code : texte identique', async () => {
    expect(profile.codeSystemPrompt).toBe(CODE_SYSTEM_0426);
    const systems: string[] = [];
    const fake: LLMProvider = {
      id: 'ollama',
      label: 'faux',
      model: 'candidat:test',
      requiresApiKey: false,
      async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
        systems.push(request.system ?? '');
        yield { type: 'text', delta: '{"answer": "ok", "files": []}' };
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const registry = new ProviderRegistry().register(
      {
        id: 'ollama',
        label: 'faux',
        requiresApiKey: false,
        defaultModel: 'x',
        suggestedModels: [],
      },
      () => fake,
    );
    const code = createCodeAIProvider(registry, { model: 'candidat:test' });
    await code.explainError({ output: 'erreur' });
    await code.analyzeCode({ files: [], question: 'q' });
    expect(systems).toEqual([
      CODE_SYSTEM_0426,
      `${CODE_SYSTEM_0426}\nRéponds uniquement par du JSON valide, sans texte autour.`,
    ]);
  });
});
