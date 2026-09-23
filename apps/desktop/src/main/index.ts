import { join } from 'node:path';
import { BrowserWindow, Menu, Tray, app, globalShortcut, ipcMain, nativeImage } from 'electron';
import {
  createDefaultRegistry,
  parseSettings,
  type ProviderDescriptor,
  type Settings,
} from '@jarvis/core';
import { IpcChannel, type SendChatInput, type ToolInfo } from '../shared/ipc.js';
import { ChatSession } from './session.js';
import { FileConversationStore, readSettings, writeSettings } from './store.js';
import { createToolManager } from './tools/index.js';
import { createOverlayWindow, type OverlayWindow } from './window.js';

const isDev = !app.isPackaged;
const registry = createDefaultRegistry();
const tools = createToolManager();
const store = new FileConversationStore();

let settings: Settings = parseSettings({});
let overlay: OverlayWindow | null = null;
let tray: Tray | null = null;

const session = new ChatSession({
  registry,
  tools,
  store,
  getSettings: () => settings,
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => overlay?.show());
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  app.setName('Jarvis');
  settings = await readSettings();
  await app.whenReady();

  app.setAppUserModelId('com.thedexios.jarvis');
  if (process.platform === 'darwin') app.dock?.hide();

  // En développement, garder la fenêtre visible quand le focus part (devtools, éditeur).
  overlay = createOverlayWindow(settings.hideOnBlur && !isDev);
  registerIpc();
  await loadRenderer(overlay.browserWindow);
  registerHotkey(settings.hotkey);
  createTray();

  overlay.show();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) return;
    overlay?.show();
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devServer) {
    await window.loadURL(devServer);
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Le raccourci global est la porte d'entrée de l'assistant : il doit toujours
 * rester enregistré, même si l'utilisateur en choisit un autre.
 */
function registerHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(accelerator, () => overlay?.toggle());
  } catch {
    return false;
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Jarvis');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Jarvis', click: () => overlay?.show() },
      { type: 'separator' },
      { label: 'Quitter', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => overlay?.toggle());
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.chatSend, async (event, input: SendChatInput) => {
    await session.send(event.sender, input);
  });
  ipcMain.handle(IpcChannel.chatCancel, () => session.cancel());
  ipcMain.handle(IpcChannel.confirmRespond, (_event, requestId: string, approved: boolean) =>
    session.respondConfirmation(requestId, approved),
  );

  ipcMain.handle(IpcChannel.settingsGet, () => ({ settings, status: session.status() }));
  ipcMain.handle(IpcChannel.settingsSet, async (_event, patch: Partial<Settings>) => {
    const next = parseSettings({ ...settings, ...patch });
    const hotkeyChanged = next.hotkey !== settings.hotkey;
    settings = next;
    await writeSettings(settings);

    overlay?.setHideOnBlur(settings.hideOnBlur);
    if (hotkeyChanged && !registerHotkey(settings.hotkey)) {
      registerHotkey('Control+Space');
      settings = parseSettings({ ...settings, hotkey: 'Control+Space' });
      await writeSettings(settings);
    }
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }

    return { settings, status: session.status() };
  });
  ipcMain.handle(IpcChannel.settingsProviders, (): ProviderDescriptor[] => registry.list());

  ipcMain.handle(IpcChannel.historyList, () => store.list());
  ipcMain.handle(IpcChannel.historyGet, (_event, id: string) => store.get(id));
  ipcMain.handle(IpcChannel.historyRemove, (_event, id: string) => store.remove(id));
  ipcMain.handle(IpcChannel.historyClear, () => store.clear());

  ipcMain.handle(IpcChannel.toolsList, (): ToolInfo[] =>
    tools.list().map(({ name, description, risk }) => ({ name, description, risk })),
  );

  ipcMain.handle(IpcChannel.windowHide, () => overlay?.hide());
  ipcMain.handle(IpcChannel.windowResize, (_event, height: number) => overlay?.resize(height));
}

app.on('window-all-closed', () => {
  // L'assistant vit dans la zone de notification : fermer la fenêtre ne quitte pas.
});

app.on('will-quit', () => globalShortcut.unregisterAll());
