import type { IpcRenderer, IpcRendererEvent } from 'electron';
import {
  DeveloperChannel,
  type DeveloperApi,
  type DeveloperState,
} from '../shared/developerIpc.js';

/** Surface `window.jarvis.developer` : appels typés seulement, pas d'ipcRenderer brut. */
export function createDeveloperApi(ipc: IpcRenderer): DeveloperApi {
  return {
    status: () => ipc.invoke(DeveloperChannel.status),
    detect: () => ipc.invoke(DeveloperChannel.detect),
    validate: (path: string) => ipc.invoke(DeveloperChannel.validate, path),
    checkEnvironment: () => ipc.invoke(DeveloperChannel.environment),
    clone: (path: string) => ipc.invoke(DeveloperChannel.clone, path),
    install: () => ipc.invoke(DeveloperChannel.install),
    analyze: () => ipc.invoke(DeveloperChannel.analyze),
    cancel: () => ipc.invoke(DeveloperChannel.cancel),
    respondConfirmation: (requestId: string, approved: boolean) =>
      ipc.invoke(DeveloperChannel.confirmRespond, requestId, approved),
    checkHardware: () => ipc.invoke(DeveloperChannel.hardware),
    calibrate: (model?: string) => ipc.invoke(DeveloperChannel.calibrate, model),
    validateConfig: (modelId: string, expertsInRam: boolean) =>
      ipc.invoke(DeveloperChannel.validateConfig, modelId, expertsInRam),
    confirmExperts: (applied: boolean) => ipc.invoke(DeveloperChannel.experts, applied),
    pull: (modelId: string) => ipc.invoke(DeveloperChannel.pull, modelId),
    refreshOllamaModels: () => ipc.invoke(DeveloperChannel.refreshOllamaModels),
    pullOllamaModel: (model: string) => ipc.invoke(DeveloperChannel.pullOllamaModel, model),
    benchmark: (modelId: string) => ipc.invoke(DeveloperChannel.benchmark, modelId),
    startTask: (request: string) => ipc.invoke(DeveloperChannel.taskStart, request),
    approvePlan: (approved: boolean) => ipc.invoke(DeveloperChannel.taskApprove, approved),
    rollbackTask: (checkpoint: string) => ipc.invoke(DeveloperChannel.taskRollback, checkpoint),
    discardTask: () => ipc.invoke(DeveloperChannel.taskDiscard),
    keepTask: () => ipc.invoke(DeveloperChannel.taskKeep),
    listSandboxes: () => ipc.invoke(DeveloperChannel.sandboxes),
    cleanSandboxes: (paths: string[]) => ipc.invoke(DeveloperChannel.sandboxesClean, paths),
    ask: (question: string) => ipc.invoke(DeveloperChannel.ask, question),
    realBenchmark: (modelId: string) => ipc.invoke(DeveloperChannel.realBenchmark, modelId),
    startMission: (kind, request, skipQuestions, projectId) =>
      ipc.invoke(DeveloperChannel.missionStart, kind, request, skipQuestions, projectId),
    answerMission: (answers: string[]) => ipc.invoke(DeveloperChannel.missionAnswer, answers),
    listMissions: (projectId?: string) => ipc.invoke(DeveloperChannel.missions, projectId),
    openMission: (id: string, projectId?: string) =>
      ipc.invoke(DeveloperChannel.missionOpen, id, projectId),
    listProjects: () => ipc.invoke(DeveloperChannel.projects),
    importProject: (path: string) => ipc.invoke(DeveloperChannel.projectImport, path),
    forgetProject: (id: string) => ipc.invoke(DeveloperChannel.projectForget, id),
    saveProjectMemory: (id: string, notes: string) =>
      ipc.invoke(DeveloperChannel.projectMemory, id, notes),
    buildProject: (id: string) => ipc.invoke(DeveloperChannel.projectBuild, id),
    openProjectChat: (projectId: string) => ipc.invoke(DeveloperChannel.projectChatOpen, projectId),
    sendProjectChat: (projectId: string, text: string, withScreenshot?: boolean) =>
      ipc.invoke(DeveloperChannel.projectChatSend, projectId, text, withScreenshot === true),
    setProjectChatPreview: (projectId: string, open: boolean) =>
      ipc.invoke(DeveloperChannel.projectChatPreview, projectId, open),
    compareProjectChatModels: (projectId: string, alternateModel: string) =>
      ipc.invoke(DeveloperChannel.projectChatCompare, projectId, alternateModel),
    startMissionFromChat: (projectId: string) =>
      ipc.invoke(DeveloperChannel.startMissionFromChat, projectId),
    applyTask: () => ipc.invoke(DeveloperChannel.taskApply),
    revertTask: () => ipc.invoke(DeveloperChannel.taskRevert),
    startProposal: (missionId: string, index: number, projectId: string) =>
      ipc.invoke(DeveloperChannel.missionProposal, missionId, index, projectId),
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, state: DeveloperState): void => listener(state);
      ipc.on(DeveloperChannel.event, handler);
      return () => ipc.removeListener(DeveloperChannel.event, handler);
    },
  };
}
