import {
  applyMachineProfile,
  assertChatModelDownload,
  defaultSettings,
  ollamaDescriptor,
  selectMachineProfile,
  shouldDownloadChatModel,
  type ProfileDecision,
  type Settings,
} from '@jarvis/core';
import { ipcMain, type WebContents } from 'electron';
import {
  IpcChannel,
  type MachineAnalysis,
  type MachinePullResult,
  type RuntimeStatus,
} from '../../shared/ipc.js';
import { createOllamaApi } from '../developer/models/ollamaApi.js';
import { writeSettings } from '../store.js';
import { modelAlreadyInstalled, surveyMachine, type MachineSurvey } from './probe.js';

export interface MachineHost {
  getSettings(): Settings;
  setSettings(settings: Settings): void;
  /** Vrai si `settings.json` existait au démarrage de ce processus. */
  fileExistedAtStart(): boolean;
  refreshTools(): void;
  /** Après un profil non modeste, Google peut se charger. */
  onApplied(settings: Settings): void;
  status(): { settings: Settings; status: RuntimeStatus };
}

export function registerMachineIpc(host: MachineHost): void {
  let decision: ProfileDecision | null = null;
  let survey: MachineSurvey | null = null;
  let pullAbort: AbortController | null = null;
  let applied = false;

  const baseUrl = (): string =>
    host.getSettings().baseUrl || ollamaDescriptor.defaultBaseUrl || 'http://127.0.0.1:11434';

  ipcMain.handle(IpcChannel.machineStatus, () => ({
    setupRequired: !host.fileExistedAtStart() && !applied,
    downloadAllowed: !host.fileExistedAtStart() && !applied && !host.getSettings().machine,
  }));

  ipcMain.handle(IpcChannel.machineAnalyze, async (): Promise<MachineAnalysis> => {
    survey = await surveyMachine(baseUrl());
    decision = selectMachineProfile(survey);
    const installed = modelAlreadyInstalled(survey, decision.chatModel);
    const allowed = shouldDownloadChatModel({
      firstLaunch: !host.fileExistedAtStart() && !applied && !host.getSettings().machine,
      ollamaPresent: survey.ollamaPresent,
      installed,
      model: decision.chatModel,
    });
    return {
      detected: decision.detected,
      chosen: decision.chosen,
      profile: decision.profile,
      chatModel: decision.chatModel,
      cpuOnly: decision.cpuOnly,
      measureFailed: decision.measureFailed,
      download: {
        allowed,
        alreadyInstalled: installed,
        ollamaPresent: survey.ollamaPresent,
      },
    };
  });

  ipcMain.handle(IpcChannel.machinePull, async (event): Promise<MachinePullResult> => {
    const chosen = decision;
    if (!chosen || !survey) return { ok: false, error: 'La mesure n’a pas encore été faite.' };
    if (host.fileExistedAtStart() || applied || host.getSettings().machine) {
      return { ok: false, error: 'Un profil est déjà enregistré : rien n’est téléchargé.' };
    }
    try {
      assertChatModelDownload(chosen.chatModel);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Téléchargement refusé.' };
    }
    if (!shouldDownloadChatModel({
      firstLaunch: true,
      ollamaPresent: survey.ollamaPresent,
      installed: modelAlreadyInstalled(survey, chosen.chatModel),
      model: chosen.chatModel,
    })) {
      return { ok: true };
    }
    pullAbort?.abort();
    const controller = new AbortController();
    pullAbort = controller;
    try {
      await createOllamaApi(baseUrl()).pull(
        chosen.chatModel,
        (progress) => {
          sendProgress(event.sender, progress);
        },
        controller.signal,
      );
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, cancelled: true };
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Le téléchargement n’a pas abouti.',
      };
    } finally {
      if (pullAbort === controller) pullAbort = null;
    }
  });

  ipcMain.handle(IpcChannel.machinePullCancel, () => {
    pullAbort?.abort();
  });

  ipcMain.handle(IpcChannel.machineApply, async () => {
    if (!decision) return host.status();
    const base = host.fileExistedAtStart() ? host.getSettings() : defaultSettings;
    const next = applyMachineProfile(base, decision);
    host.setSettings(next);
    await writeSettings(next);
    applied = true;
    host.refreshTools();
    host.onApplied(next);
    return host.status();
  });
}

function sendProgress(
  sender: WebContents,
  progress: { status: string; completed: number; total: number },
): void {
  if (sender.isDestroyed()) return;
  sender.send(IpcChannel.machinePullEvent, progress);
}
