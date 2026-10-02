import type { IpcMain, WebContents } from 'electron';
import { SUGGESTED_REPO_PATH, candidateRepoPaths } from '@jarvis/core';
import { DeveloperChannel, type DeveloperState } from '../../shared/developerIpc.js';
import {
  DEVELOPER_DISABLED_NOTICE,
  DeveloperController,
  type ControllerDeps,
} from './controller.js';

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
    suggestedPath:
      deps.platform === 'win32'
        ? SUGGESTED_REPO_PATH
        : candidateRepoPaths({ platform: deps.platform, home: deps.home })[0]!,
    repoPath: deps.getSettings().developer.repoPath,
    repo: null,
    environment: null,
    task: null,
    confirmation: null,
    report: null,
    busy: false,
    notice: null,
  });

  const refused = (): DeveloperState => ({ ...disabled(), notice: DEVELOPER_DISABLED_NOTICE });

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
