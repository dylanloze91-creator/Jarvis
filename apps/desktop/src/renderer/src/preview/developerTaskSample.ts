import { parseUnifiedDiff, suiteCommand, type TestRunSummary } from '@jarvis/core';
import type { CodeTaskState, DevStep, DeveloperState } from '../../../shared/developerIpc';

/** Données d'aperçu (captures seulement) : « ajoute un outil qui donne la version de Jarvis ». */
const ROOT = 'C:\\dev\\Jarvis-taches';
const BRANCH = 'jarvis-dev/2026-10-02-ajoute-un-outil-qui-donne-la-version';
const PATH = `${ROOT}\\2026-10-02-ajoute-un-outil-qui-donne-la-version`;

const DIFF = `diff --git a/apps/desktop/src/main/tools/version.ts b/apps/desktop/src/main/tools/version.ts
new file mode 100644
--- /dev/null
+++ b/apps/desktop/src/main/tools/version.ts
@@ -0,0 +1,12 @@
+import { app } from 'electron';
+import { z } from 'zod';
+import { defineTool, toolSuccess } from '@jarvis/core';
+
+export const jarvisVersionTool = defineTool({
+  name: 'get_jarvis_version',
+  description: 'Donne la version de Jarvis installée.',
+  risk: 'safe',
+  schema: z.object({}),
+  execute: async () => toolSuccess(\`Jarvis \${app.getVersion()}\`),
+});
+
diff --git a/apps/desktop/src/main/tools/version.test.ts b/apps/desktop/src/main/tools/version.test.ts
new file mode 100644
--- /dev/null
+++ b/apps/desktop/src/main/tools/version.test.ts
@@ -0,0 +1,9 @@
+import { describe, expect, it, vi } from 'vitest';
+vi.mock('electron', () => ({ app: { getVersion: () => '0.4.25' } }));
+import { jarvisVersionTool } from './version';
+
+describe('get_jarvis_version', () => {
+  it('donne la version', async () => {
+    expect((await jarvisVersionTool.run({}, { requestConfirmation: async () => true })).content).toBe('Jarvis 0.4.25');
+  });
+});
`;

const INDEX_DIFF = `diff --git a/apps/desktop/src/main/tools/index.ts b/apps/desktop/src/main/tools/index.ts
--- a/apps/desktop/src/main/tools/index.ts
+++ b/apps/desktop/src/main/tools/index.ts
@@ -38,6 +38,7 @@
 import { createWebTools } from './web';
 import { youtubeTranscriptTool } from './youtube';
+import { jarvisVersionTool } from './version';
 
 export function createToolManager(deps: ToolDeps): ToolManager {
   return new ToolManager().registerAll([
@@ -61,4 +62,5 @@
     youtubeTranscriptTool,
+    jarvisVersionTool,
   ]);
 }
`;

function summary(
  suite: 'typecheck' | 'test-desktop',
  text: string,
  failures: string[] = [],
): TestRunSummary {
  return {
    suite,
    command: suiteCommand(suite),
    exitCode: failures.length ? 1 : 0,
    failures,
    summary: text,
    excerpt: failures.join('\n'),
    durationMs: suite === 'typecheck' ? 9_400 : 16_800,
    timedOut: false,
  };
}

const BASELINE = [
  summary('typecheck', 'réussi'),
  summary('test-desktop', '1 test(s) échoué(s) sur 380', [
    'test src/main/voicePackaging.test.ts > ressources voix > présentes',
  ]),
];
const FAILED =
  'tsc apps/desktop/src/main/tools/version.test.ts TS2554 Expected 3 arguments, but got 2.';

function baseState(): CodeTaskState {
  return {
    id: 'apercu-tache',
    request: 'Ajoute un outil qui donne la version de Jarvis, avec son test.',
    model: 'qwen3.6:35b-a3b-coding',
    status: 'running',
    branch: BRANCH,
    worktreePath: PATH,
    baseCommit: '8d7c9b28fdb950862c7e624dae69106e623bc78b',
    plan: {
      summary:
        'Ajouter l’outil get_jarvis_version (lecture seule) dans un nouveau fichier, avec son test, puis l’enregistrer dans le registre des outils.',
      criteria: ['tsc sans erreur', 'le test de l’outil passe', 'aucun nouvel échec'],
      files: [
        {
          path: 'apps/desktop/src/main/tools/version.ts',
          action: 'create',
          reason: 'nouvel outil',
          core: null,
          problem: null,
          exists: false,
        },
        {
          path: 'apps/desktop/src/main/tools/version.test.ts',
          action: 'create',
          reason: 'test de l’outil',
          core: null,
          problem: null,
          exists: false,
        },
        {
          path: 'apps/desktop/src/main/tools/index.ts',
          action: 'edit',
          reason: 'enregistrer l’outil',
          core: 'registre des outils, commandes et suppressions',
          problem: null,
          exists: true,
        },
      ],
      tests: ['typecheck', 'test-desktop'],
      testCommands: [suiteCommand('typecheck'), suiteCommand('test-desktop')],
      maxTestSeries: 5,
      dirtyFiles: [],
      branchCommand: `git worktree add -b ${BRANCH} "${PATH}" HEAD`,
      installCommand: 'npm ci --ignore-scripts --no-audit --no-fund',
    },
    approvedAt: null,
    checkpoints: [],
    diff: [],
    baseline: null,
    runs: [],
    attempts: 0,
    maxAttempts: 3,
    testSeriesUsed: 0,
    findings: [],
    pauses: [],
    planApproved: [],
    asked: 0,
    report: null,
    closed: null,
    startedAt: Date.now() - 6 * 60_000,
    finishedAt: null,
  };
}

const STEP_LABELS: Array<[string, string]> = [
  ['model', 'Modèle de code'],
  ['plan', 'Plan (lecture du dépôt, rien n’est modifié)'],
  ['approval', 'Ta validation du plan'],
  ['sandbox', 'Copie isolée (branche jarvis-dev/*)'],
  ['install', 'Dépendances de la copie isolée'],
  ['baseline', 'Tests de référence (avant modification)'],
  ['edit', 'Modification'],
  ['scan', 'Revue du diff avant les tests'],
  ['test', 'Tests'],
  ['fix-1', 'Correction 1/3 : analyse des erreurs'],
  ['retest-1', 'Tests après la correction 1'],
  ['report', 'Rapport'],
];

function steps(
  done: number,
  running: string | null,
  details: Record<string, string> = {},
): DevStep[] {
  return STEP_LABELS.filter(([id]) => !id.endsWith('-1') || done > 9).map(([id, label], index) => ({
    id,
    label,
    status: index < done ? 'done' : id === running ? 'running' : 'pending',
    ...(details[id] ? { detail: details[id] } : {}),
  }));
}

const REPORT = `## Tâche : Ajoute un outil qui donne la version de Jarvis, avec son test.

**Verdict :** Réussie : aucun nouvel échec par rapport à la référence.

Branche \`${BRANCH}\` · copie isolée \`${PATH}\` · modèle \`qwen3.6:35b-a3b-coding\` · 412 s

### Fichiers modifiés

- \`apps/desktop/src/main/tools/version.ts\` (+12 −0)

- \`apps/desktop/src/main/tools/version.test.ts\` (+9 −0)

- \`apps/desktop/src/main/tools/index.ts\` (+2 −0) — cœur

### Tests

| Série | typecheck | test-desktop | Nouveaux échecs |
| --- | --- | --- | --- |
| Référence (avant) | réussi | 1 test(s) échoué(s) sur 380 | — |
| Après modification | 1 erreur(s) TypeScript | 1 test(s) échoué(s) sur 381 | 1 |
| Correction 1 | réussi | 1 test(s) échoué(s) sur 381 | aucun |

Corrections : 1 sur 3 au plus.

### Points de reprise

- \`4c1e9a2\` Modification (plan validé)

- \`b77d013\` Correction 1

### Confirmations

7 action(s) couvertes par ta validation du plan, 2 confirmation(s) demandée(s).

### Et maintenant

Ta copie de travail n’a pas été touchée. Tu peux garder la branche, revenir à un point de reprise ou jeter la tâche. Appliquer à ta copie arrivera dans une prochaine version.`;

/** Scènes : developer-task-plan, developer-task-run, developer-task-report. */
export function previewTaskState(
  scene: string | null,
): Pick<DeveloperState, 'codeTask' | 'sandboxes' | 'worktreeRoot'> {
  const sandboxes = [
    {
      path: `${ROOT}\\2026-09-30-renommer-un-libelle`,
      branch: 'jarvis-dev/2026-09-30-renommer-un-libelle',
      head: '1a2b3c4',
      modifiedAt: Date.now() - 2 * 86_400_000,
      missing: false,
      current: false,
    },
  ];
  if (!scene?.startsWith('developer-task'))
    return { codeTask: null, sandboxes: null, worktreeRoot: ROOT };
  const state = baseState();
  if (scene === 'developer-task-plan') {
    state.status = 'awaiting-approval';
    return { codeTask: state, sandboxes, worktreeRoot: ROOT };
  }
  state.approvedAt = Date.now() - 5 * 60_000;
  state.baseline = BASELINE;
  state.diff = parseUnifiedDiff(DIFF);
  state.testSeriesUsed = 1;
  state.planApproved = [
    { tool: 'dev_create_branch', target: BRANCH, at: Date.now() },
    { tool: 'dev_run_tests', target: 'typecheck', at: Date.now() },
    { tool: 'dev_run_tests', target: 'test-desktop', at: Date.now() },
    { tool: 'dev_create_file', target: 'apps/desktop/src/main/tools/version.ts', at: Date.now() },
    {
      tool: 'dev_create_file',
      target: 'apps/desktop/src/main/tools/version.test.ts',
      at: Date.now(),
    },
  ];
  state.asked = 1;
  if (scene === 'developer-task-run') return { codeTask: state, sandboxes, worktreeRoot: ROOT };
  state.diff = parseUnifiedDiff(DIFF + INDEX_DIFF);
  state.runs = [
    {
      label: 'Après modification',
      at: Date.now(),
      results: [
        summary('typecheck', '1 erreur(s) TypeScript', [FAILED]),
        summary('test-desktop', '1 test(s) échoué(s) sur 381', BASELINE[1]!.failures),
      ],
      newFailures: [`typecheck: ${FAILED}`],
      fixed: [],
      ok: false,
    },
    {
      label: 'Correction 1',
      at: Date.now(),
      results: [
        summary('typecheck', 'réussi'),
        summary('test-desktop', '1 test(s) échoué(s) sur 381', BASELINE[1]!.failures),
      ],
      newFailures: [],
      fixed: [],
      ok: true,
    },
  ];
  state.attempts = 1;
  state.testSeriesUsed = 3;
  state.checkpoints = [
    {
      sha: '4c1e9a2f0d6b7c8e9f0a1b2c3d4e5f6a7b8c9d0e',
      label: 'Modification (plan validé)',
      at: Date.now() - 120_000,
    },
    {
      sha: 'b77d013c5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
      label: 'Correction 1',
      at: Date.now() - 30_000,
    },
  ];
  state.asked = 2;
  state.planApproved = [...state.planApproved, ...state.planApproved.slice(1, 3)];
  state.status = 'finished';
  state.finishedAt = Date.now();
  state.report = { markdown: REPORT, verdict: 'success' };
  return { codeTask: state, sandboxes, worktreeRoot: ROOT };
}

/** Étapes, carte et occupation qui vont avec chaque scène de tâche. */
export function applyTaskScene(scene: string | null, state: DeveloperState): void {
  if (!state.codeTask) return;
  const title = 'Tâche : Ajoute un outil qui donne la version de Jarvis, avec son test.';
  const task = (stepsList: DevStep[], outcome?: 'success'): DeveloperState['task'] => ({
    id: 'apercu-tache',
    kind: 'code',
    title,
    steps: stepsList,
    startedAt: Date.now() - 6 * 60_000,
    ...(outcome
      ? { finishedAt: Date.now(), outcome, message: 'Tâche réussie : vois le rapport.' }
      : {}),
    log: [],
  });
  if (scene === 'developer-task-plan') {
    state.busy = true;
    state.task = task(
      steps(2, 'approval', {
        model: 'qwen3.6:35b-a3b-coding',
        plan: '3 fichier(s)',
        approval: 'en attente de ta validation',
      }),
    );
  } else if (scene === 'developer-task-run') {
    state.busy = true;
    state.task = task(
      steps(6, 'edit', {
        baseline: 'typecheck : réussi · test-desktop : 1 test(s) échoué(s) sur 380',
        edit: 'le modèle modifie la copie isolée',
      }),
    );
    const index = parseUnifiedDiff(INDEX_DIFF);
    state.confirmation = {
      requestId: 'apercu-carte',
      toolName: 'dev_edit_file',
      details: 'Modifier apps/desktop/src/main/tools/index.ts (remplacement exact).',
      command: 'Modifier apps/desktop/src/main/tools/index.ts (−1 +2 lignes)',
      safety: {
        command: 'Modifier apps/desktop/src/main/tools/index.ts (−1 +2 lignes)',
        level: 'always-confirm',
        label: 'Toujours à confirmer',
        reasons: [
          'fichier du cœur (registre des outils, commandes et suppressions) : toujours confirmé',
        ],
        runsWithoutAsking: false,
      },
      reason:
        'fichier du cœur (registre des outils, commandes et suppressions) : toujours confirmé',
      diff: [{ ...index[0]!, hunks: [index[0]!.hunks[0]!] }],
    };
  } else if (scene === 'developer-task-report') {
    state.task = task(
      steps(12, null, {
        test: '1 nouvel(s) échec(s)',
        'fix-1': '2 action(s)',
        'retest-1': 'typecheck : réussi · test-desktop : 1 test(s) échoué(s) sur 381',
      }).map((s) => (s.id === 'test' ? { ...s, status: 'failed' } : s)),
      'success',
    );
  }
}
