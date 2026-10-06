import type { IpcMain, WebContents } from 'electron';
import { MISSION_KINDS, candidateRepoPaths, type MissionKind } from '@jarvis/core';
import { DeveloperChannel, type DeveloperState } from '../../shared/developerIpc.js';
import {
  DEVELOPER_DISABLED_NOTICE,
  DeveloperController,
  type ControllerDeps,
} from './controller.js';
import { emptyCodeModelState } from './models/workflow.js';

export interface DeveloperIpcDeps extends Omit<ControllerDeps, 'emit'> {
  /** Fenêtre principale, seule destinataire des événements. */
  target(): WebContents | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 400) : '';
}

/**
 * Canaux `dev:*`. La session développeur n'est créée qu'au premier appel avec
 * le mode activé ; mode coupé, chaque action répond « coupé » sans rien faire.
 */
export function registerDeveloperIpc(
  ipcMain: IpcMain,
  deps: DeveloperIpcDeps,
): { current(): DeveloperController | null } {
  let controller: DeveloperController | null = null;
  const enabled = (): boolean => deps.getSettings().developer.enabled;
  const get = (): DeveloperController | null => {
    if (!enabled()) {
      controller?.cancel();
      return null;
    }
    controller ??= new DeveloperController({
      ...deps,
      emit: (state) => {
        const target = deps.target();
        if (target && !target.isDestroyed()) target.send(DeveloperChannel.event, state);
      },
    });
    return controller;
  };
  const disabled = (): DeveloperState => ({
    enabled: false,
    suggestedPath: candidateRepoPaths({ platform: deps.platform, home: deps.home })[0]!,
    repoPath: deps.getSettings().developer.repoPath,
    repo: null,
    environment: null,
    task: null,
    confirmation: null,
    report: null,
    busy: false,
    notice: null,
    model: emptyCodeModelState(deps.env ?? process.env, deps.platform),
    codeTask: null,
    sandboxes: null,
    worktreeRoot: '',
    ask: null,
    mission: null,
    missions: null,
    missionsProject: 'jarvis',
    projects: null,
    projectsRoot: '',
    dotnet: null,
    projectChat: null,
  });

  const refused = (): DeveloperState => ({ ...disabled(), notice: DEVELOPER_DISABLED_NOTICE });
  const modelId = (value: unknown): string =>
    typeof value === 'string' ? value.slice(0, 100) : '';
  const projectId = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value.slice(0, 40) : undefined;

  ipcMain.handle(DeveloperChannel.hardware, () => get()?.checkHardware() ?? refused());
  ipcMain.handle(
    DeveloperChannel.calibrate,
    (_event, model: unknown) =>
      get()?.calibrate(typeof model === 'string' ? modelId(model) : undefined) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.validateConfig,
    (_event, id: unknown, experts: unknown) =>
      get()?.validateConfig(modelId(id), experts === true) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.experts,
    (_event, applied: unknown) => get()?.confirmExperts(applied === true) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.pull,
    (_event, id: unknown) => get()?.pull(modelId(id)) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.refreshOllamaModels,
    () => get()?.refreshOllamaModels() ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.pullOllamaModel,
    (_event, name: unknown) => get()?.pullOllamaModel(modelId(name)) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.benchmark,
    (_event, id: unknown) => get()?.benchmark(modelId(id)) ?? refused(),
  );

  ipcMain.handle(
    DeveloperChannel.taskStart,
    (_event, request: unknown) =>
      get()?.startTask(typeof request === 'string' ? request.slice(0, 2_000) : '') ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.taskApprove,
    (_event, approved: unknown) => get()?.approvePlan(approved === true) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.taskRollback,
    (_event, checkpoint: unknown) =>
      get()?.rollbackTask(typeof checkpoint === 'string' ? checkpoint.slice(0, 40) : '') ??
      refused(),
  );
  ipcMain.handle(DeveloperChannel.taskDiscard, () => get()?.discardTask() ?? refused());
  ipcMain.handle(DeveloperChannel.taskKeep, () => get()?.keepTask() ?? refused());
  ipcMain.handle(DeveloperChannel.sandboxes, () => get()?.listSandboxes() ?? refused());
  ipcMain.handle(
    DeveloperChannel.ask,
    (_event, question: unknown) =>
      get()?.ask(typeof question === 'string' ? question.slice(0, 2_000) : '') ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.missionStart,
    (_event, kind: unknown, request: unknown, skip: unknown, project: unknown) =>
      get()?.startMission(
        (MISSION_KINDS as readonly string[]).includes(String(kind))
          ? (kind as MissionKind)
          : 'modify',
        typeof request === 'string' ? request.slice(0, 2_000) : '',
        skip === true,
        projectId(project),
      ) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.missionAnswer,
    (_event, answers: unknown) =>
      get()?.answerMission(
        Array.isArray(answers)
          ? answers.slice(0, 10).map((a) => (typeof a === 'string' ? a.slice(0, 1_000) : ''))
          : [],
      ) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.missions,
    (_event, project: unknown) => get()?.listMissions(projectId(project)) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.missionOpen,
    (_event, id: unknown, project: unknown) =>
      get()?.openMission(typeof id === 'string' ? id.slice(0, 80) : '', projectId(project)) ??
      refused(),
  );
  ipcMain.handle(DeveloperChannel.projects, () => get()?.listProjects() ?? refused());
  ipcMain.handle(
    DeveloperChannel.projectImport,
    (_event, path: unknown) => get()?.importProject(text(path)) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectForget,
    (_event, id: unknown) => get()?.forgetProject(projectId(id) ?? '') ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectMemory,
    (_event, id: unknown, notes: unknown) =>
      get()?.saveProjectMemory(
        projectId(id) ?? '',
        typeof notes === 'string' ? notes.slice(0, 4_000) : '',
      ) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectBuild,
    (_event, id: unknown) => get()?.buildProject(projectId(id) ?? '') ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectChatOpen,
    (_event, id: unknown) => get()?.openProjectChat(projectId(id) ?? '') ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectChatSend,
    (_event, id: unknown, text: unknown, withScreenshot: unknown) =>
      get()?.sendProjectChat(
        projectId(id) ?? '',
        typeof text === 'string' ? text.slice(0, 4_000) : '',
        withScreenshot === true,
      ) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectChatPreview,
    (_event, id: unknown, open: unknown) =>
      get()?.setProjectChatPreview(projectId(id) ?? '', open === true) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.projectChatCompare,
    (_event, id: unknown, alternate: unknown) =>
      get()?.compareProjectChatModels(
        projectId(id) ?? '',
        typeof alternate === 'string' ? alternate.slice(0, 100) : '',
      ) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.startMissionFromChat,
    (_event, id: unknown) => get()?.startMissionFromChat(projectId(id) ?? '') ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.missionProposal,
    (_event, id: unknown, index: unknown, project: unknown) =>
      get()?.startProposal(
        typeof id === 'string' ? id.slice(0, 80) : '',
        typeof index === 'number' && Number.isInteger(index) ? index : -1,
        projectId(project) ?? 'jarvis',
      ) ?? refused(),
  );
  ipcMain.handle(DeveloperChannel.taskApply, () => get()?.applyTask() ?? refused());
  ipcMain.handle(DeveloperChannel.taskRevert, () => get()?.revertTask() ?? refused());
  ipcMain.handle(
    DeveloperChannel.realBenchmark,
    (_event, id: unknown) => get()?.realBenchmark(modelId(id)) ?? refused(),
  );
  ipcMain.handle(
    DeveloperChannel.sandboxesClean,
    (_event, paths: unknown) =>
      get()?.cleanSandboxes(
        Array.isArray(paths)
          ? paths
              .filter((p): p is string => typeof p === 'string')
              .map(text)
              .slice(0, 50)
          : [],
      ) ?? refused(),
  );

  ipcMain.handle(DeveloperChannel.status, () => get()?.state() ?? disabled());
  ipcMain.handle(DeveloperChannel.detect, () => get()?.detect() ?? refused());
  ipcMain.handle(
    DeveloperChannel.validate,
    (_event, path: unknown) => get()?.validate(text(path)) ?? refused(),
  );
  ipcMain.handle(DeveloperChannel.environment, () => get()?.checkEnvironment() ?? refused());
  ipcMain.handle(
    DeveloperChannel.clone,
    (_event, path: unknown) => get()?.clone(text(path)) ?? refused(),
  );
  ipcMain.handle(DeveloperChannel.install, () => get()?.install() ?? refused());
  ipcMain.handle(DeveloperChannel.analyze, () => get()?.analyze() ?? refused());
  ipcMain.handle(DeveloperChannel.cancel, () => controller?.cancel());
  ipcMain.handle(
    DeveloperChannel.confirmRespond,
    (_event, requestId: unknown, approved: unknown) => {
      if (typeof requestId === 'string')
        controller?.respondConfirmation(requestId, approved === true);
    },
  );
  return { current: () => controller };
}
