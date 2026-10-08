import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  safeStorage,
  session as electronSession,
  shell,
} from 'electron';
import {
  checkOllamaStatus,
  createDefaultMarketDataRegistry,
  createDefaultRegistry,
  createWebSearchRegistry,
  ollamaDescriptor,
  parseSettings,
  testOllamaConnection,
  type MarketDataProviderDescriptor,
  type ProviderDescriptor,
  type SearchProviderDescriptor,
  type Settings,
} from '@jarvis/core';
import {
  IpcChannel,
  type GoogleConfigDraft,
  type SendChatInput,
  type ToolInfo,
  type VoiceSpeakInput,
  type VoiceTranscribeInput,
} from '../shared/ipc.js';
import { FileAuditLogStore } from './audit-store.js';
import { SpotifyBridge } from './media/SpotifyBridge.js';
import { SiteBlockBridge } from './siteblock/SiteBlockBridge.js';
import { createGoogleRuntime } from './google/runtime.js';
import { PersonalizationStore } from './personalization.js';
import { KnowledgeStore } from './knowledge.js';
import { ChatSession } from './session.js';
import { FileConversationStore, readSettings, settingsFileExists, writeSettings } from './store.js';
import { readMachineSnapshot } from './machineStats.js';
import { createToolManager } from './tools/index.js';
import { registerMachineIpc } from './machine/ipc.js';
import { registerDeveloperIpc } from './developer/ipc.js';
import { ChatActivity } from './developer/task/chatActivity.js';
import { summarizeYoutubeLink } from './youtube/runtime.js';
import { UpdateManager } from './updater.js';
import { VoiceBridge } from './voice.js';
import { presentWindow } from './startup.js';
import { allowPermissionCheck, allowPermissionRequest, originForLog } from './mediaPermissions.js';
import { VoiceCaptureLog } from './voiceCaptureLog.js';
import { WakeLearningStore } from './wakeLearningStore.js';
import { LocalLearningStore } from './learning/store.js';
import { LocalLearningController } from './learning/controller.js';
import { ListeningIndicatorWindow } from './listeningIndicator.js';
import { createOverlayWindow, type OverlayWindow } from './window.js';
import {
  currentVoiceAssetsRoot,
  inspectVoiceAssets,
  registerVoiceAssetsProtocol,
  registerVoiceAssetsScheme,
} from './voiceAssetsProtocol.js';

registerVoiceAssetsScheme();
// Whisper tourne dans un worker sur plusieurs threads (onnxruntime-web) :
// il faut SharedArrayBuffer, absent d'une page file:// non isolée. La
// fenêtre ne charge que l'interface locale (navigation bloquée).
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

const isDev = !app.isPackaged;
const registry = createDefaultRegistry();
const searchRegistry = createWebSearchRegistry();
const marketDataRegistry = createDefaultMarketDataRegistry();
const store = new FileConversationStore();
const personalization = new PersonalizationStore();
const knowledge = new KnowledgeStore({ getUserDataPath: () => app.getPath('userData') });
const auditLog = new FileAuditLogStore();
const voice = new VoiceBridge(() => settings);
const updateManager = new UpdateManager();
const voiceCaptureLog = new VoiceCaptureLog(() => join(app.getPath('userData'), 'logs', 'voice-capture.log'));
const wakeLearning = new WakeLearningStore(() => app.getPath('userData'), (line) => voiceCaptureLog.append(line));
let listeningIndicator: ListeningIndicatorWindow | null = null;

let settings: Settings = parseSettings({});
let settingsFileExisted = false;
const localLearningStore = new LocalLearningStore(() => app.getPath('userData'));
const localLearning = new LocalLearningController(
  localLearningStore,
  () => settings,
  async (patch) => {
    settings = parseSettings({ ...settings, ...patch }, settings);
    await writeSettings(settings);
    return settings;
  },
  () => app.getPath('userData'),
);
const spotify = new SpotifyBridge(() => settings);
const siteBlock = new SiteBlockBridge(() => settings);
// Jetons chiffrés par safeStorage (DPAPI), consentement dans le navigateur système.
const google = createGoogleRuntime({
  userDataPath: () => app.getPath('userData'),
  cipher: safeStorage,
  openExternal: (url) => shell.openExternal(url),
  getSettings: () => settings,
  log: (line) => console.info(line),
});
let overlay: OverlayWindow | null = null;
let googleStarted = false;

function buildTools() {
  return createToolManager({
    getSettings: () => settings,
    searchRegistry,
    marketDataRegistry,
    spotify,
    siteBlock,
    personalization,
    knowledge,
    google,
    spotifyConnected: () => spotify.connectedNow(),
    summarizeYoutube: (url, onProgress, signal) =>
      summarizeYoutubeLink({
        url,
        getSettings: () => settings,
        getWebContents: () => overlay?.browserWindow.webContents ?? null,
        onProgress,
        signal,
      }),
  });
}

let tools = buildTools();

function startGoogleIfAllowed(): void {
  if (googleStarted) return;
  if (!settingsFileExisted) return;
  if (settings.machine?.profile === 'modest') return;
  googleStarted = true;
  void google.account.init();
}

function ensureGoogleLoaded(): void {
  if (googleStarted) return;
  googleStarted = true;
  void google.account.init();
}
let tray: Tray | null = null;

const chatActivity = new ChatActivity();
const session = new ChatSession({
  registry,
  get tools() {
    return tools;
  },
  store,
  auditLog,
  voice,
  getSettings: () => settings,
  personalization,
  knowledge,
  localLearning,
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => overlay?.show());
  void bootstrap().catch((error: unknown) => {
    console.error(error);
    overlay?.show();
  });
}

async function bootstrap(): Promise<void> {
  app.setName('Jarvis');
  settingsFileExisted = await settingsFileExists();
  const [loaded] = await Promise.all([
    settingsFileExisted ? readSettings() : Promise.resolve(parseSettings({})),
    app.whenReady(),
  ]);
  settings = loaded;
  tools = buildTools();
  if (settings.machine?.profile === 'modest' && settings.spotifyClientId.trim()) {
    void spotify.status();
  }
  // Pas attendu : la fenêtre ne patiente pas pour lire les jetons Google.
  // Profil modeste et premier lancement : Google n’est chargé qu’à l’ouverture des réglages.
  startGoogleIfAllowed();
  registerVoiceAssetsProtocol();
  voiceCaptureLog.append(
    `[démarrage] Jarvis ${app.getVersion()} · Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · ${process.platform} ${process.arch} · écoute ${settings.voice.enabled ? 'activée' : 'coupée'}`,
  );

  app.setAppUserModelId('com.thedexios.jarvis');
  if (process.platform === 'darwin') app.dock?.hide();

  // Micro seul, depuis l'interface ; chaque décision va dans le journal de capture.
  const devServer = isDev ? process.env.ELECTRON_RENDERER_URL : undefined;
  electronSession.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const media = details as { mediaTypes?: string[]; requestingUrl?: string };
      const allowed = allowPermissionRequest(permission, media, devServer);
      if (permission === 'media' || !allowed) {
        voiceCaptureLog.append(
          `[autorisation] demande ${permission}${media.mediaTypes?.length ? ` (${media.mediaTypes.join(', ')})` : ''} de ${originForLog(media.requestingUrl)} → ${allowed ? 'accordée' : 'refusée'}`,
        );
      }
      callback(allowed);
    },
  );
  electronSession.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) => {
      const mediaType = (details as { mediaType?: string }).mediaType;
      const allowed = allowPermissionCheck(permission, mediaType);
      if (!allowed && permission === 'media') {
        voiceCaptureLog.append(`[autorisation] vérification media (${mediaType ?? '?'}) → refusée`);
      }
      return allowed;
    },
  );

  // En développement, garder la fenêtre visible quand le focus part (devtools, éditeur).
  overlay = createOverlayWindow(!settings.stayVisibleOnBlur && !isDev);
  registerIpc();
  const window = overlay.browserWindow;
  listeningIndicator = new ListeningIndicatorWindow(
    () => overlay?.browserWindow ?? null,
    (indicator) => loadRenderer(indicator, 'indicator.html'),
  );
  listeningIndicator.attachToMain(window);
  await presentWindow(
    {
      once: (event, listener) => window.once(event, listener),
      show: () => overlay?.show(),
    },
    () => loadRenderer(window),
  );
  registerHotkey(settings.hotkey);
  createTray();

  // Poussé à l'interface dès qu'un état change (vérification, téléchargement,
  // progression…) : la fenêtre n'a jamais besoin de sonder l'état elle-même.
  updateManager.onStateChange((state) => {
    overlay?.browserWindow.webContents.send(IpcChannel.updateEvent, state);
  });
  updateManager.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) return;
    overlay?.show();
  });
}

async function loadRenderer(window: BrowserWindow, page = 'index.html'): Promise<void> {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devServer) {
    await window.loadURL(page === 'index.html' ? devServer : `${devServer.replace(/\/+$/, '')}/${page}`);
  } else {
    await window.loadFile(join(__dirname, `../renderer/${page}`));
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
  localLearning.registerIpc(ipcMain);
  localLearning.setBroadcast((status) => {
    const contents = overlay?.browserWindow.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.send(IpcChannel.localLearningEvent, status);
    }
  });

  registerMachineIpc({
    getSettings: () => settings,
    setSettings: (next) => {
      settings = next;
    },
    fileExistedAtStart: () => settingsFileExisted,
    refreshTools: () => {
      tools = buildTools();
    },
    onApplied: (next) => {
      settingsFileExisted = true;
      if (next.machine?.profile === 'modest' && next.spotifyClientId.trim()) {
        void spotify.status();
      }
      if (next.machine?.profile !== 'modest') {
        googleStarted = false;
        startGoogleIfAllowed();
      }
    },
    status: () => ({ settings, status: session.status() }),
  });

  ipcMain.handle(IpcChannel.chatSend, async (event, input: SendChatInput) => {
    if (input.source === 'voice') {
      voiceCaptureLog.append(`[commande] reçue par l'agent (${input.text.length} caractères)`);
    }
    // Jarvis Développeur (décision 5) : une tâche de code en cours cède la place pendant ce tour.
    chatActivity.begin();
    try {
      await session.send(event.sender, input);
    } finally {
      chatActivity.end();
    }
  });
  ipcMain.handle(IpcChannel.chatCancel, () => session.cancel());
  ipcMain.handle(IpcChannel.confirmRespond, (_event, requestId: string, approved: boolean) =>
    session.respondConfirmation(requestId, approved),
  );

  ipcMain.handle(IpcChannel.settingsGet, () => ({ settings, status: session.status() }));
  ipcMain.handle(IpcChannel.settingsSet, async (_event, patch: Partial<Settings>) => {
    const next = parseSettings({ ...settings, ...patch }, settings);
    const hotkeyChanged = next.hotkey !== settings.hotkey;
    settings = next;
    await writeSettings(settings);

    overlay?.setHideOnBlur(!settings.stayVisibleOnBlur && !isDev);
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
  ipcMain.handle(IpcChannel.settingsSearchProviders, (): SearchProviderDescriptor[] =>
    searchRegistry.list(),
  );
  ipcMain.handle(IpcChannel.settingsMarketDataProviders, (): MarketDataProviderDescriptor[] =>
    marketDataRegistry.list(),
  );
  ipcMain.handle(IpcChannel.settingsOllamaStatus, (_event, baseUrl?: string) =>
    checkOllamaStatus(baseUrl || settings.baseUrl || ollamaDescriptor.defaultBaseUrl),
  );
  ipcMain.handle(
    IpcChannel.settingsOllamaTest,
    (_event, input: { baseUrl?: string; model: string }) =>
      testOllamaConnection({
        baseUrl: input.baseUrl || settings.baseUrl || ollamaDescriptor.defaultBaseUrl,
        model: input.model,
      }),
  );
  ipcMain.handle(IpcChannel.settingsSpotifyStatus, (_event, clientId?: string) =>
    spotify.status(clientId),
  );
  ipcMain.handle(IpcChannel.settingsSpotifyConnect, (_event, clientId?: string) =>
    spotify.connect(clientId),
  );
  ipcMain.handle(IpcChannel.settingsSpotifyDisconnect, (_event, clientId?: string) =>
    spotify.disconnect(clientId),
  );
  ipcMain.handle(
    IpcChannel.settingsSiteBlockStatus,
    (_event, credentials?: { baseUrl?: string; token?: string }) =>
      siteBlock.connectionStatus(credentials),
  );
  ipcMain.handle(IpcChannel.settingsGoogleStatus, (_event, draft?: GoogleConfigDraft) => {
    ensureGoogleLoaded();
    return google.account.status(sanitizeGoogleDraft(draft));
  });
  ipcMain.handle(IpcChannel.settingsGoogleConnect, (_event, draft?: GoogleConfigDraft) => {
    ensureGoogleLoaded();
    return google.account.connect(sanitizeGoogleDraft(draft));
  });
  ipcMain.handle(IpcChannel.settingsGoogleCancel, () => google.account.cancelConnect());
  ipcMain.handle(IpcChannel.settingsGoogleDisconnect, () => google.account.disconnect());
  ipcMain.handle(IpcChannel.settingsPersonalizationGet, () => personalization.get());
  ipcMain.handle(IpcChannel.settingsPersonalizationReset, () => personalization.reset());
  ipcMain.handle(IpcChannel.settingsKnowledgeStats, () => knowledge.stats());
  ipcMain.handle(IpcChannel.settingsKnowledgeClear, () =>
    knowledge.clear().then(() => knowledge.stats()),
  );

  ipcMain.handle(IpcChannel.historyList, () => store.list());
  ipcMain.handle(IpcChannel.historyGet, (_event, id: string) => store.get(id));
  ipcMain.handle(IpcChannel.historyRemove, (_event, id: string) => store.remove(id));
  ipcMain.handle(IpcChannel.historyClear, () => store.clear());

  ipcMain.handle(IpcChannel.toolsList, (): ToolInfo[] =>
    tools
      .list()
      .filter((tool) => !tool.internal && (tool.isAvailable?.() ?? true))
      .map(({ name, description, risk, category, forceConfirm }) => ({
        name,
        description,
        risk,
        category,
        forceConfirm,
      })),
  );

  ipcMain.handle(IpcChannel.auditList, (_event, limit?: number) => auditLog.list(limit));
  ipcMain.handle(IpcChannel.auditClear, () => auditLog.clear());

  ipcMain.handle(IpcChannel.windowHide, () => overlay?.hide());
  ipcMain.handle(IpcChannel.windowIsVisible, () => overlay?.browserWindow.isVisible() ?? false);
  ipcMain.handle(IpcChannel.windowResize, (_event, height: number) => overlay?.resize(height));
  ipcMain.handle(IpcChannel.windowSetChrome, (_event, mode: 'compact' | 'dashboard') => {
    if (mode === 'compact' || mode === 'dashboard') overlay?.setChrome(mode);
  });
  ipcMain.handle(IpcChannel.systemSnapshot, () => readMachineSnapshot(app.getVersion()));

  ipcMain.handle(IpcChannel.voiceTranscribe, (_event, input: VoiceTranscribeInput) =>
    voice.transcribe(input),
  );
  ipcMain.handle(IpcChannel.voiceSpeak, (_event, input: VoiceSpeakInput) => voice.speak(input));
  ipcMain.handle(IpcChannel.voiceAssetsReport, async () => {
    const root = currentVoiceAssetsRoot();
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      root,
      files: await inspectVoiceAssets(root),
    };
  });
  ipcMain.handle(IpcChannel.voiceCopyReport, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 20_000));
  });
  ipcMain.on(IpcChannel.voiceCaptureLog, (_event, line: unknown) => {
    if (typeof line === 'string') voiceCaptureLog.append(line);
  });
  // URI fixe, rien ne vient du renderer : Paramètres > Confidentialité > Microphone.
  ipcMain.handle(IpcChannel.voiceOpenMicrophonePrivacy, async () => {
    if (process.platform !== 'win32') return false;
    await shell.openExternal('ms-settings:privacy-microphone');
    return true;
  });

  // Apprentissage du réveil : refusé tant que l'option n'est pas activée.
  ipcMain.handle(IpcChannel.wakeLearningStatus, () => wakeLearning.status());
  ipcMain.handle(IpcChannel.wakeLearningAddSample, (_event, input: unknown) =>
    settings.voice.wakeLearning ? wakeLearning.addSample(input) : null,
  );
  ipcMain.handle(IpcChannel.wakeLearningStats, (_event, kinds: unknown) =>
    settings.voice.wakeLearning ? wakeLearning.recordStats(kinds) : undefined,
  );
  ipcMain.handle(IpcChannel.wakeLearningModel, () => wakeLearning.model());
  ipcMain.handle(IpcChannel.wakeLearningRetrain, () => wakeLearning.retrain());
  ipcMain.handle(IpcChannel.wakeLearningClear, () => wakeLearning.clearSamples());
  ipcMain.handle(IpcChannel.wakeLearningReset, () => wakeLearning.reset());

  const fromMainWindow = (event: Electron.IpcMainEvent): boolean => event.sender === overlay?.browserWindow.webContents;
  ipcMain.on(IpcChannel.listeningIndicator, (event, payload: unknown) => {
    if (!fromMainWindow(event)) return;
    const active = (payload as { active?: unknown } | null)?.active === true;
    listeningIndicator?.setActive(active);
  });
  ipcMain.on(IpcChannel.listeningLevel, (event, level: unknown) => {
    if (!fromMainWindow(event)) return;
    if (typeof level === 'number' && Number.isFinite(level)) listeningIndicator?.setLevel(level);
  });

  ipcMain.handle(IpcChannel.updateGetState, () => updateManager.getState());
  ipcMain.handle(IpcChannel.updateCheck, () => updateManager.checkNow());
  ipcMain.handle(IpcChannel.updateInstall, () => updateManager.quitAndInstall());

  // Jarvis Développeur : session séparée du chat, créée seulement si le mode est activé.
  registerDeveloperIpc(ipcMain, {
    getSettings: () => settings,
    appVersion: () => app.getVersion(),
    platform: process.platform,
    home: app.getPath('home'),
    logsDir: () => join(app.getPath('userData'), 'logs'),
    oneDriveRoots: () => [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter((root): root is string => Boolean(root)),
    auditLog,
    target: () => overlay?.browserWindow.webContents ?? null,
    registry,
    searchRegistry,
    userDataPath: () => app.getPath('userData'),
    chat: chatActivity,
  });
}

function sanitizeGoogleDraft(draft: unknown): GoogleConfigDraft | undefined {
  if (!draft || typeof draft !== 'object') return undefined;
  const value = draft as Record<string, unknown>;
  return {
    clientId: typeof value.clientId === 'string' ? value.clientId.slice(0, 300) : undefined,
    clientSecret: typeof value.clientSecret === 'string' ? value.clientSecret.slice(0, 300) : undefined,
    access: value.access === 'readonly' || value.access === 'full' ? value.access : undefined,
  };
}

app.on('window-all-closed', () => {
  // L'assistant vit dans la zone de notification : fermer la fenêtre ne quitte pas.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  updateManager.stop();
});
