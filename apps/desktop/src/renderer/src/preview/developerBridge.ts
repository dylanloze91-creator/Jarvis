import {
  SUGGESTED_REPO_PATH,
  buildArchitectureReport,
  classifyCommand,
  type DevCheck,
} from '@jarvis/core';
import type { DevStep, DeveloperApi, DeveloperState } from '../../../shared/developerIpc';
import { previewArchitectureFacts, previewLineTotal } from './developerSample';

const REPO_CHECKS: DevCheck[] = [
  { id: 'folder', label: 'Dossier', status: 'ok', detail: SUGGESTED_REPO_PATH },
  { id: 'git', label: 'Dépôt Git', status: 'ok', detail: 'Branche main, commit 9596179' },
  {
    id: 'package',
    label: 'Code de Jarvis',
    status: 'ok',
    detail: 'package.json « jarvis » et « @jarvis/desktop » trouvés.',
  },
  { id: 'version', label: 'Version', status: 'ok', detail: '0.4.23 (Jarvis installé : 0.4.23)' },
  {
    id: 'remote',
    label: 'Dépôt d’origine',
    status: 'ok',
    detail: 'github.com/dylanloze91-creator/Jarvis',
  },
  {
    id: 'dependencies',
    label: 'Dépendances',
    status: 'warn',
    detail:
      'Pas encore installées : « Installer les dépendances » lance npm ci, avec ta confirmation.',
  },
];
const ENV_CHECKS: DevCheck[] = [
  { id: 'git', label: 'Git', status: 'ok', detail: 'Git 2.47.1' },
  { id: 'node', label: 'Node.js', status: 'ok', detail: 'Node 22.14.0' },
  { id: 'npm', label: 'npm', status: 'ok', detail: 'npm 10.9.2' },
  { id: 'disk', label: 'Disque', status: 'ok', detail: '412 Go libres sur C:\\.' },
];
const ANALYSIS: Array<[string, string, string]> = [
  ['status', 'État de la copie (git status)', 'branche main, 0 fichier(s) modifié(s)'],
  ['files', 'Fichiers suivis par git', `${previewArchitectureFacts.files.length} fichiers`],
  ['lines', 'Taille du code', `${previewLineTotal} lignes de texte`],
  ['packages', 'Paquets npm', '@jarvis/desktop, jarvis, @jarvis/core'],
  ['tools', 'Outils du chat', 'registre : apps/desktop/src/main/tools/index.ts'],
  ['core', 'Agent, confirmations, réglages, IPC', 'agent : packages/core/src/agent/agent.ts'],
  ['report', 'Rapport', 'prêt'],
];

/** Pont de prévisualisation de Jarvis Développeur (captures d'écran, Vite seul). */
export function createPreviewDeveloperApi(
  scene: string | null,
  enabled: () => boolean,
): DeveloperApi {
  const listeners = new Set<(state: DeveloperState) => void>();
  const developerScene = scene?.startsWith('developer') ?? false;
  let state: DeveloperState = {
    enabled: enabled(),
    suggestedPath: SUGGESTED_REPO_PATH,
    repoPath: developerScene ? SUGGESTED_REPO_PATH : '',
    repo: developerScene
      ? { ok: true, checks: REPO_CHECKS, branch: 'main', version: '0.4.23' }
      : null,
    environment: developerScene ? { ok: true, checks: ENV_CHECKS } : null,
    task: null,
    confirmation: null,
    report: null,
    busy: false,
    notice: null,
  };
  if (scene === 'developer-panel') {
    state.task = {
      id: 'apercu',
      kind: 'analyze',
      title: 'Analyser mon architecture',
      steps: ANALYSIS.map(([id, label, detail]): DevStep => ({
        id,
        label,
        status: 'done',
        detail,
      })),
      startedAt: Date.now() - 2_400,
      finishedAt: Date.now(),
      outcome: 'success',
      log: [],
      message: 'Rapport prêt.',
    };
    state.report = {
      markdown: buildArchitectureReport(previewArchitectureFacts, new Date(2026, 9, 2, 15, 4)),
      createdAt: Date.now(),
    };
  }
  if (scene === 'developer-confirm') {
    const command = `npm ci --no-audit --no-fund\n(dans ${SUGGESTED_REPO_PATH}, avec ONNXRUNTIME_NODE_INSTALL=skip)`;
    state.busy = true;
    state.task = {
      id: 'apercu-install',
      kind: 'install',
      title: 'Installer les dépendances (npm ci)',
      steps: [
        {
          id: 'environment',
          label: 'Node.js et npm',
          status: 'done',
          detail: 'Node 22.14.0, npm 10.9.2',
        },
        {
          id: 'confirm',
          label: 'Ta confirmation',
          status: 'running',
          detail: 'en attente de ta réponse',
        },
        { id: 'install', label: 'Installation (npm ci)', status: 'pending' },
        { id: 'validate', label: 'Vérification de node_modules', status: 'pending' },
      ],
      startedAt: Date.now(),
      log: [],
    };
    state.confirmation = {
      requestId: 'apercu-confirmation',
      toolName: 'dev_install_dependencies',
      details: 'Installer les dépendances de la copie de travail (npm ci, environ 1,1 Go, réseau).',
      command,
      forced: true,
      safety: classifyCommand(command.split('\n')[0]!),
    };
  }
  const set = (patch: Partial<DeveloperState>): DeveloperState => {
    state = { ...state, ...patch, enabled: enabled() };
    for (const listener of listeners) listener(state);
    return state;
  };
  return {
    status: async () => set({}),
    detect: async () =>
      set({
        repoPath: SUGGESTED_REPO_PATH,
        repo: { ok: true, checks: REPO_CHECKS, branch: 'main', version: '0.4.23' },
      }),
    validate: async (path) =>
      set({
        repoPath: path,
        repo: { ok: true, checks: REPO_CHECKS, branch: 'main', version: '0.4.23' },
      }),
    checkEnvironment: async () => set({ environment: { ok: true, checks: ENV_CHECKS } }),
    clone: async () => set({ notice: 'Aperçu : le clonage n’est pas simulé.' }),
    install: async () => set({ notice: 'Aperçu : l’installation n’est pas simulée.' }),
    analyze: async () =>
      set({
        report: {
          markdown: buildArchitectureReport(previewArchitectureFacts, new Date()),
          createdAt: Date.now(),
        },
        task: {
          id: 'apercu',
          kind: 'analyze',
          title: 'Analyser mon architecture',
          steps: ANALYSIS.map(([id, label, detail]) => ({ id, label, status: 'done', detail })),
          startedAt: Date.now(),
          finishedAt: Date.now(),
          outcome: 'success',
          log: [],
          message: 'Rapport prêt.',
        },
      }),
    cancel: async () => {
      set({ busy: false, confirmation: null });
    },
    respondConfirmation: async () => {
      set({ confirmation: null, busy: false, notice: 'Aperçu : rien n’est exécuté.' });
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
