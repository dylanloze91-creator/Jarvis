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
  });

  const refused = (): DeveloperState => ({ ...disabled(), notice: DEVELOPER_DISABLED_NOTICE });
  const modelId = (value: unknown): string =>
    typeof value === 'string' ? value.slice(0, 100) : '';

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
    (_event, kind: unknown, request: unknown, skip: unknown) =>
      get()?.startMission(
        (MISSION_KINDS as readonly string[]).includes(String(kind))
          ? (kind as MissionKind)
          : 'modify',
        typeof request === 'string' ? request.slice(0, 2_000) : '',
        skip === true,
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
  ipcMain.handle(DeveloperChannel.missions, () => get()?.listMissions() ?? refused());
  ipcMain.handle(
    DeveloperChannel.missionOpen,
    (_event, id: unknown) =>
      get()?.openMission(typeof id === 'string' ? id.slice(0, 80) : '') ?? refused(),
  );
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
