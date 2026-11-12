import { readFile, writeFile } from 'node:fs/promises';
import { readRouterScore } from './orchestra/routerScore.js';
import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  safeStorage,
  session as electronSession,
  shell,
} from 'electron';
import {
  applySecretEdit,
  checkOllamaStatus,
  isKnowCategoryId,
  manifestIsValid,
  maskSecrets,
  coderLearningPrompt,
  memoryRetrievalEnabled,
  skillLibraryEnabled,
  createDefaultMarketDataRegistry,
  createDefaultRegistry,
  createWebSearchRegistry,
  ollamaDescriptor,
  parseSettings,
  sanitizeQuestionnaireSetPatch,
  searchOpenMeteoPlaces,
  testOllamaConnection,
  PIPER_TTS_ID,
  SpeakerChrono,
  speakerRulesOnly,
  speakerStaysAwake,
  speakerUsesPiper,
  speakerWarmupEnabled,
  speakerWhisperHeld,
  homeInterface,
  parseNetStatus,
  SPEAKER_PORT,
  type MarketDataProviderDescriptor,
  type ProviderDescriptor,
  type SearchProviderDescriptor,
  type OrchestraTeam,
  type Settings,
  validateRepo,
  normalizeDirectRequest,
  type ChatAttachment,
} from '@jarvis/core';
import {
  IpcChannel,
  type GoogleConfigDraft,
  type SendChatInput,
  type TeamValidationInput,
  type ChatEvent,
  type RuntimeStatus,
  type ToolInfo,
  type VoiceSpeakInput,
  type VoicePiperSpeakInput,
  type VoiceTranscribeInput,
  type ImagerDirectEvent,
  type ImagerDirectResult,
} from '../shared/ipc.js';
import { FileAuditLogStore } from './audit-store.js';
import { SpotifyBridge } from './media/SpotifyBridge.js';
import { SiteBlockBridge } from './siteblock/SiteBlockBridge.js';
import { RoverClient } from './rover/RoverClient.js';
import { ImagesService } from './images/ImagesService.js';
import { createGoogleRuntime } from './google/runtime.js';
import { PersonalizationStore } from './personalization.js';
import { KnowledgeStore } from './knowledge.js';
import { ChatSession } from './session.js';
import { appendTeamValidation, type TeamValidationPayload } from './orchestra/teamValidation.js';
import { PhoneService } from './phone/service.js';
import { PhoneStore } from './phone/store.js';
import { gatherRepoFacts } from './developer/repo.js';
import { runProcess } from './developer/runner.js';
import { QuestionnaireStore } from './questionnaire/store.js';
import { openAnnounce } from './speaker/announce.js';
import { loadSpeakerFirmware } from './speaker/firmwareBundle.js';
import { keptLanAddresses, lanInterfaces } from './speaker/lan.js';
import { collectSpeakerNet, elevateScript, readStatusScript, repairFirewall, repairPrivate } from './speaker/repair.js';
import { createMulticastSocket } from './speaker/mdnsSocket.js';
import { SpeakerService, localHostName } from './speaker/service.js';
import { SpeakerStore } from './speaker/store.js';
import { createSpeakerSynthesizer } from './speaker/synth.js';
import { transcribeViaRenderer } from './speaker/transcribe.js';
import { FileConversationStore, readSettings, setSettingsDiskStripsSecrets, settingsFileExists, writeSettings } from './store.js';
import { KeyVault } from './vault/store.js';
import { BackupService } from './backup/service.js';
import { PrivacyService } from './privacy/service.js';
import { HealthMonitor } from './health/runtime.js';
import { readGoogleHealth } from './health/googleProbe.js';
import { GOOGLE_TOKEN_FILE } from './google/runtime.js';
import { GoogleTokenStore } from './google/tokenStore.js';
import { readMachineSnapshot } from './machineStats.js';
import { createToolManager } from './tools/index.js';
import { registerMachineIpc } from './machine/ipc.js';
import { registerDeveloperIpc } from './developer/ipc.js';
import { projectIdFromPlayArgs } from './developer/project/projectPlayArg.js';
import { ChatActivity } from './developer/task/chatActivity.js';
import { ChatMissionHub } from './chatMission/hub.js';
import { ChatMissionSync } from './chatMission/sync.js';
import { registerChatMissionIpc } from './chatMission/ipc.js';
import { summarizeYoutubeLink } from './youtube/runtime.js';
import { UpdateManager } from './updater.js';
import { VoiceBridge } from './voice.js';
import { PiperService, phoneVoiceMode } from './piper/service.js';
import { SpeakerChronoFile } from './speaker/chronoFile.js';
import { warmOllamaModels } from './speaker/warmupRun.js';
import { presentWindow } from './startup.js';
import { allowPermissionCheck, allowPermissionRequest, isAppDocumentUrl, originForLog } from './mediaPermissions.js';
import { VoiceCaptureLog } from './voiceCaptureLog.js';
import { WakeLearningStore } from './wakeLearningStore.js';
import { LocalLearningStore } from './learning/store.js';
import { LocalLearningController } from './learning/controller.js';
import { ListeningIndicatorWindow } from './listeningIndicator.js';
import { createOverlayWindow, pickSpeakerPort, type OverlayWindow } from './window.js';
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

function teamValidationPayload(input: TeamValidationInput): TeamValidationPayload {
  return {
    phrase: input.phrase,
    context: input.context,
    proposedTeam: input.proposedTeam as OrchestraTeam,
    chosenTeam: input.chosenTeam as OrchestraTeam,
    path: input.path,
  };
}

const registry = createDefaultRegistry();
const searchRegistry = createWebSearchRegistry();
const marketDataRegistry = createDefaultMarketDataRegistry();
const store = new FileConversationStore();
const personalization = new PersonalizationStore();
const knowledge = new KnowledgeStore({ getUserDataPath: () => app.getPath('userData') });
const auditLog = new FileAuditLogStore();
const voice = new VoiceBridge(() => settings);
const piper = new PiperService();
const speakerChronoFile = new SpeakerChronoFile(() => join(app.getPath('userData'), 'logs', 'enceinte-chrono.jsonl'));
const speakerChrono = new SpeakerChrono({
  append: (line) => speakerChronoFile.append(line),
  clear: () => speakerChronoFile.clear(),
});
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
  {
    listLearning: () => knowledge.listLearning(),
    applyLearning: (record) => knowledge.applyLearning(record),
    setLearningStatus: (id, status) => knowledge.setLearningStatus(id, status),
    deleteLearning: (id) => knowledge.deleteLearning(id),
    correctLearning: (id, content) => knowledge.correctLearning(id, content),
    restoreLearning: (id) => knowledge.restoreLearning(id),
    readRuns: async () => {
      try {
        const raw = await readFile(join(app.getPath('userData'), 'developer', 'code-model.json'), 'utf8');
        const data = JSON.parse(raw) as { modelRuns?: Array<{ success?: boolean }> };
        if (!Array.isArray(data.modelRuns)) return [];
        return data.modelRuns.flatMap((run) => (typeof run.success === 'boolean' ? [{ success: run.success }] : []));
      } catch {
        return [];
      }
    },
    search: async (query) => {
      const { searchWithFallback, webProviderOrder } = await import('@jarvis/core');
      const config = { provider: settings.searchProvider, apiKey: settings.searchApiKey };
      const order = webProviderOrder(searchRegistry, config);
      const response = await searchWithFallback(searchRegistry, order, config, { query, limit: 3 });
      return response.results.map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.snippet ?? '',
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      }));
    },
  },
);
localLearning.armPeriodic();
const spotify = new SpotifyBridge(() => settings);
const siteBlock = new SiteBlockBridge(() => settings);
const rover = new RoverClient(() => settings);
// Module images : Forge (Stable Diffusion) lancé au besoin, modèle de langage déchargé puis rechargé.
const images = new ImagesService({ getSettings: () => settings, log: (line) => console.info(line) });
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
let developerIpc: ReturnType<typeof registerDeveloperIpc> | null = null;
let chatMissionHub: ChatMissionHub | null = null;
let chatMissionSync: ChatMissionSync | null = null;

function pushChatEvent(event: ChatEvent): void {
  const contents = overlay?.browserWindow.webContents;
  if (contents && !contents.isDestroyed()) contents.send(IpcChannel.chatEvent, event);
}

let pendingPlayProjectId = projectIdFromPlayArgs(process.argv);

function openPlayProject(projectId: string | null): void {
  if (!projectId) return;
  const controller = developerIpc?.ensure();
  if (!controller) {
    pendingPlayProjectId = projectId;
    return;
  }
  pendingPlayProjectId = null;
  void controller.playProject(projectId);
}

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
    rover,
    images,
    openImagePath: (path) => shell.openPath(path),
    currentTurn: () => currentTurn.value,
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
/** Mode direct : le message de l'utilisateur en cours, lu par l'outil `generer_image` (jamais recopié par le modèle). */
const currentTurn: { value: { text: string; attachments: ChatAttachment[] } | null } = { value: null };
const vault = new KeyVault(() => app.getPath('userData'), safeStorage);
let healthMonitor: HealthMonitor | null = null;
let backupService: BackupService | null = null;

function settingsForWindow(): Settings {
  if (!vault.encryptionAvailable()) return settings;
  return maskSecrets(settings, vault.secretsNow());
}

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
  getChatMissionHub: () => chatMissionHub,
  images,
  openImagePath: (path) => shell.openPath(path),
  noteUserTurn: (turn) => {
    currentTurn.value = turn;
  },
  // Module images : une photo jointe est enregistrée dans le dossier des images (sous _references).
  saveAttachment: (input) => images.saveReference(input),
  healthReport: () => healthMonitor?.run() ?? Promise.reject(new Error('bilan indisponible')),
});

// 5.0.63 — téléphone : une session de chat à part (un tour sur le téléphone n'annule pas celui de
// la fenêtre), mêmes outils, même historique, mêmes confirmations (affichées sur le téléphone).
const phoneSession = new ChatSession({
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
  getChatMissionHub: () => chatMissionHub,
  images,
  openImagePath: (path) => shell.openPath(path),
  noteUserTurn: (turn) => {
    currentTurn.value = turn;
  },
  healthReport: () => healthMonitor?.run() ?? Promise.reject(new Error('bilan indisponible')),
});
const questionnaire = QuestionnaireStore.inUserData(() => app.getPath('userData'));
const phone = new PhoneService({
  store: PhoneStore.inUserData(() => app.getPath('userData')),
  chat: {
    send: async (sender, input) => {
      chatActivity.begin();
      try {
        await phoneSession.send(sender as unknown as Electron.WebContents, input);
      } finally {
        chatActivity.end();
      }
    },
    respondConfirmation: (requestId, approved) => phoneSession.respondConfirmation(requestId, approved),
    cancel: () => phoneSession.cancel(),
  },
  validateTeam: (input) => appendTeamValidation(settings, teamValidationPayload(input)),
  conversation: (id) => store.get(id),
  icon: () => readFile(join(__dirname, '../../resources/icon.png')),
  version: () => app.getVersion(),
  phoneVoice: async () =>
    phoneVoiceMode(settings.voice.ttsProvider, await piper.isReady(settings.voice.ttsVoice || undefined)),
  synthesizeSpeech: async (text: string) =>
    piper.synthesizeWav({ text, voiceId: settings.voice.ttsVoice || undefined }),
  log: (line) => console.info(line),
  broadcast: (status) => {
    const contents = overlay?.browserWindow.webContents;
    if (contents && !contents.isDestroyed()) contents.send(IpcChannel.phoneEvent, status);
  },
});

async function warmSpeakerSide(): Promise<void> {
  const base =
    settings.provider === 'ollama' && settings.baseUrl.trim()
      ? settings.baseUrl.trim()
      : (ollamaDescriptor.defaultBaseUrl ?? 'http://127.0.0.1:11434');
  if (speakerStaysAwake(settings) || speakerWarmupEnabled(settings)) {
    await warmOllamaModels(settings, base);
  }
  if (speakerWarmupEnabled(settings) || speakerUsesPiper(settings)) {
    await piper.warm(settings.voice.ttsVoice || undefined);
  }
}

// 5.0.64 — enceintes : une session de chat **par enceinte** (une phrase au salon n'annule ni la
// fenêtre, ni le téléphone, ni la cuisine), mêmes outils, même historique. Une carte de
// confirmation y est refusée d'office (`server.ts`) : l'enceinte n'a pas d'écran.
const speakerStore = SpeakerStore.inUserData(() => app.getPath('userData'));
const speakers = new SpeakerService({
  store: speakerStore,
  keptAddresses: () => keptLanAddresses(),
  openAnnounce: async () => {
    try {
      const ifaces = await lanInterfaces();
      return openAnnounce(
        ifaces,
        { pcId: speakerStore.pcId, port: SPEAKER_PORT, hostname: localHostName() },
        (address) => {
          const socket = createMulticastSocket(address);
          if (!socket) throw new Error('annonce impossible');
          return socket;
        },
      );
    } catch (error) {
      console.info(`[enceinte] pas d'annonce mDNS : ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  },
  chatFor: () => {
    const speakerSession = new ChatSession({
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
      getChatMissionHub: () => chatMissionHub,
      images,
      noteUserTurn: (turn) => {
        currentTurn.value = turn;
      },
      healthReport: () => healthMonitor?.run() ?? Promise.reject(new Error('bilan indisponible')),
    });
    return {
      send: async (sender, input) => {
        chatActivity.begin();
        try {
          await speakerSession.send(sender as unknown as Electron.WebContents, input);
        } finally {
          chatActivity.end();
        }
      },
      respondConfirmation: (requestId, approved) => speakerSession.respondConfirmation(requestId, approved),
      cancel: () => speakerSession.cancel(),
    };
  },
  transcribe: (pcm) => transcribeViaRenderer({ webContents: overlay?.browserWindow.webContents ?? null, pcm }),
  synthesizer: createSpeakerSynthesizer({
    getSettings: () => settings,
    voice,
    piper,
    log: (line) => console.info(line),
  }),
  voiceSettings: () => settings.voice,
  version: () => app.getVersion(),
  chrono: speakerChrono,
  rulesOnlyAddressee: () => speakerRulesOnly(settings),
  warmupEnabled: () => speakerWarmupEnabled(settings),
  warm: () => {
    void warmSpeakerSide();
  },
  conversations: store,
  log: (line) => console.info(line),
  broadcast: (status) => {
    const contents = overlay?.browserWindow.webContents;
    if (contents && !contents.isDestroyed()) contents.send(IpcChannel.speakerEvent, status);
  },
  onShowOnPc: (conversationId) => {
    const win = overlay;
    if (!win || win.browserWindow.isDestroyed()) return;
    win.showInactive();
    const contents = win.browserWindow.webContents;
    if (!contents.isDestroyed()) {
      contents.send(IpcChannel.speakerShowConversation, { conversationId });
    }
  },
});

backupService = new BackupService({
  userData: () => app.getPath('userData'),
  getSettings: () => settings,
  version: () => app.getVersion(),
  isIdle: () =>
    !chatActivity.busy &&
    !(chatMissionHub?.missionBusy() ?? false) &&
    !localLearning.status().running &&
    !(developerIpc?.current()?.workInProgress() ?? false),
  relaunch: () => {
    app.relaunch();
    app.exit(0);
  },
});

const privacy = new PrivacyService({
  userData: () => app.getPath('userData'),
  getSettings: () => settings,
  personalization,
  knowledge: {
    listChunks: () => knowledge.listChunks(),
    replaceChunks: (chunks) => knowledge.replaceChunks(chunks as never),
    clearMemoryFiles: () => knowledge.clearMemoryFiles(),
  },
  conversations: {
    list: async () => (await store.list()).map((item) => ({ id: item.id, title: item.title })),
    read: async (id) => JSON.stringify((await store.get(id)) ?? {}),
    remove: (id) => store.remove(id),
    clear: () => store.clear(),
  },
  questionnaire: {
    read: async () => {
      await questionnaire.load();
      return questionnaire.snapshot();
    },
    wipe: async () => {
      await questionnaire.wipe();
    },
  },
  wake: {
    count: async () => (await wakeLearning.status()).clips,
    clear: async () => {
      await wakeLearning.clearSamples();
    },
  },
});

healthMonitor = new HealthMonitor({
  getSettings: () => settings,
  userData: () => app.getPath('userData'),
  ollamaBaseUrl: () => settings.baseUrl || ollamaDescriptor.defaultBaseUrl || 'http://127.0.0.1:11434',
  piperReady: async () => (await piper.isReady(settings.voice.ttsVoice || undefined)) === true,
  spotify: async () => {
    const status = await spotify.status();
    const speakerName = (settings.spotifyDeviceName ?? '').trim();
    if (!status.connected || !speakerName) return { tokenOk: status.connected, speakerVisible: speakerName ? false : null };
    const devices = await spotify.listDevices().catch(() => []);
    const wanted = speakerName.toLowerCase();
    const visible = devices.some((device) => device.name.toLowerCase() === wanted || device.name.toLowerCase().includes(wanted));
    return { tokenOk: true, speakerVisible: visible };
  },
  google: () =>
    readGoogleHealth({
      loaded: google.account.healthView(),
      readToken: () => new GoogleTokenStore(() => join(app.getPath('userData'), GOOGLE_TOKEN_FILE), safeStorage).load(),
    }),
  phoneEnabled: () => phone.isEnabled(),
  phonePublished: async () => (await phone.status()).tailscale.served === true,
  speakersEnabled: () => speakers.isEnabled(),
  speakersHeard: async () => (await speakers.status()).speakers.some((speaker) => speaker.lastTurnAt !== null),
  robotReachable: async () => (await rover.connectionStatus()).reachable,
  backupState: async () => {
    const state = await backupService!.state();
    return { lastAt: state.lastSuccessAt, ok: state.ok };
  },
  vaultReady: async () => {
    await vault.load();
    return { encryptionAvailable: vault.encryptionAvailable(), unreadable: vault.isUnreadable() };
  },
  broadcast: (report) => {
    const contents = overlay?.browserWindow.webContents;
    if (contents && !contents.isDestroyed()) contents.send(IpcChannel.healthEvent, report);
  },
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    overlay?.show();
    openPlayProject(projectIdFromPlayArgs(argv));
  });
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
  const migrated = await vault.migrate(loaded);
  settings = migrated.memory;
  setSettingsDiskStripsSecrets(vault.encryptionAvailable());
  if (migrated.changed) await writeSettings(migrated.disk);
  tools = buildTools();
  if (settings.machine?.profile === 'modest' && settings.spotifyClientId.trim()) {
    void spotify.status();
  }
  // Pas attendu : la fenêtre ne patiente pas pour lire les jetons Google.
  // Profil modeste et premier lancement : Google n’est chargé qu’à l’ouverture des réglages.
  startGoogleIfAllowed();
  // Coupé par défaut : sans « Accès depuis le téléphone », aucun port n'est ouvert.
  void phone.init().catch((error: unknown) => console.error(error));
  // Coupé par défaut aussi : sans « Enceintes », le port 53131 reste fermé.
  void speakers.init().catch((error: unknown) => console.error(error));
  void speakerChronoFile.readLast().then((samples) => speakerChrono.replace(samples));
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
  // Le gestionnaire unique (micro + port série) est posé dans createOverlayWindow.
  // En développement, garder la fenêtre visible quand le focus part (devtools, éditeur).
  overlay = createOverlayWindow(!settings.stayVisibleOnBlur && !isDev, () => quitting, {
    allowCheck: (permission, mediaType) => {
      const allowed = allowPermissionCheck(permission, mediaType);
      if (!allowed && permission === 'media') {
        voiceCaptureLog.append(`[autorisation] vérification media (${mediaType ?? '?'}) → refusée`);
      }
      return allowed;
    },
    isJarvisOrigin: (origin) => isAppDocumentUrl(origin, devServer),
  });
  overlay.browserWindow.webContents.on('did-finish-load', () => {
    if (speakerWhisperHeld(settings)) {
      overlay?.browserWindow.webContents.send(IpcChannel.speakerHoldWhisper);
    }
  });
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
  // Le bilan attend la première image (0.4.14) : il ne bloque pas l'ouverture.
  void healthMonitor?.run();
  backupService?.start();
  // 5.0.64 : un raccourci déjà pris au démarrage (ou mal écrit) laissait Jarvis sans
  // porte d'entrée ; comme à l'enregistrement, on retombe sur Control+Space.
  if (!registerHotkey(settings.hotkey) && settings.hotkey !== 'Control+Space') {
    console.warn(`[jarvis] raccourci « ${settings.hotkey} » refusé par le système : Control+Space`);
    registerHotkey('Control+Space');
  }
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
  ipcMain.handle(IpcChannel.localLearningSnapshot, () => localLearning.snapshot());
  ipcMain.handle(IpcChannel.localLearningTrain, () => localLearning.trainNow().then(() => localLearning.status()));
  ipcMain.handle(IpcChannel.localLearningRollback, () => localLearning.rollback());
  ipcMain.handle(IpcChannel.localLearningSetStatus, (_event, id: unknown, status: unknown) => {
    if (typeof id !== 'string') return [];
    if (status !== 'candidate' && status !== 'validated' && status !== 'review' && status !== 'stale' && status !== 'rejected') return [];
    return localLearning.setRecordStatus(id, status);
  });
  ipcMain.handle(IpcChannel.localLearningCorrect, (_event, id: unknown, content: unknown) => {
    if (typeof id !== 'string' || typeof content !== 'string') return [];
    return localLearning.correctRecord(id, content);
  });
  ipcMain.handle(IpcChannel.localLearningRestore, (_event, id: unknown) =>
    typeof id === 'string' ? localLearning.restoreRecord(id) : [],
  );
  ipcMain.handle(IpcChannel.localLearningExportSkills, () => localLearning.exportSkillRows());
  ipcMain.handle(IpcChannel.localLearningRemove, (_event, id: unknown) =>
    typeof id === 'string' ? localLearning.removeRecord(id) : [],
  );
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
    status: () => ({ settings: settingsForWindow(), status: session.status() }),
  });

  ipcMain.handle(IpcChannel.chatSend, async (event, input: SendChatInput) => {
    if (input.source === 'voice') {
      voiceCaptureLog.append(`[commande] reçue par l'agent (${input.text.length} caractères)`);
    }
    // Jarvis Développeur (décision 5) : une tâche de code en cours cède la place pendant ce tour.
    chatActivity.begin();
    try {
      await session.send(event.sender, { ...input, attachments: sanitizeAttachments(input.attachments) });
    } finally {
      chatActivity.end();
    }
  });
  // Module images : l'interface ne peut ouvrir que les fichiers du dossier des images de Jarvis.
  ipcMain.handle(IpcChannel.imagesOpen, async (_event, path: unknown) => {
    if (typeof path !== 'string' || path.length > 600) return { ok: false, error: 'Chemin invalide.' };
    if (!images.isInsideOutputRoot(path) || !/\.(png|jpe?g|webp|txt)$/i.test(path)) {
      return { ok: false, error: 'Seuls les fichiers du dossier des images de Jarvis peuvent être ouverts ici.' };
    }
    const error = await shell.openPath(path);
    return error ? { ok: false, error } : { ok: true };
  });
  // Mode direct de Jarvis Imager : panneau « Imager direct » (la demande est validée ici, côté main).
  let directController: AbortController | null = null;
  ipcMain.handle(IpcChannel.imagesDirectCatalog, () => images.directCatalog());
  ipcMain.handle(IpcChannel.imagesDirectGenerate, async (event, raw: unknown): Promise<ImagerDirectResult> => {
    const parsed = normalizeDirectRequest(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const improveRaw = (raw as { improve?: unknown } | null)?.improve;
    const improve = improveRaw === true ? true : improveRaw === false ? false : undefined;
    directController?.abort();
    const controller = new AbortController();
    directController = controller;
    const contents = event.sender;
    const push = (payload: ImagerDirectEvent): void => {
      if (!contents.isDestroyed()) contents.send(IpcChannel.imagesDirectEvent, payload);
    };
    let last = 0;
    chatActivity.begin();
    try {
      const result = await images.generateDirect(
        { ...parsed.request, ...(improve !== undefined ? { improve } : {}) },
        {
          onProgress: (message) => push({ type: 'progress', value: last, message }),
          onProgressValue: (value, eta) => {
            last = Math.max(last, value);
            push({ type: 'progress', value: last, message: `Forge : ${Math.round(last * 100)} %${eta > 0 ? `, encore ${Math.round(eta)} s environ` : ''}` });
          },
          signal: controller.signal,
        },
      );
      push({ type: 'done' });
      return {
        ok: true,
        folder: result.folder,
        files: result.files,
        width: result.width,
        height: result.height,
        durationMs: result.durationMs,
        warnings: result.warnings,
        finalPrompt: result.finalPrompt,
        finalNegative: result.finalNegative,
        improved: result.improved,
        forgeHeld: result.forgeHeld,
        brainReloaded: result.brainReloaded,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      push({ type: 'error', message });
      return { ok: false, error: message };
    } finally {
      if (directController === controller) directController = null;
      chatActivity.end();
    }
  });
  ipcMain.handle(IpcChannel.imagesDirectCancel, () => {
    directController?.abort();
  });
  ipcMain.handle(IpcChannel.imagesDirectPanel, (_event, open: unknown) => images.setDirectPanelOpen(open === true));
  ipcMain.handle(IpcChannel.chatCancel, () => session.cancel());
  ipcMain.handle(IpcChannel.confirmRespond, (_event, requestId: string, approved: boolean) =>
    session.respondConfirmation(requestId, approved),
  );
  ipcMain.handle(IpcChannel.orchestraValidateTeam, (_event, input: TeamValidationInput) =>
    appendTeamValidation(settings, teamValidationPayload(input)),
  );
  ipcMain.handle(IpcChannel.orchestraRouterScore, () => {
    const userData = app.getPath('userData');
    const appPath = app.getAppPath();
    const places = [
      join(userData, 'trieur-dernier-score.json'),
      userData,
      join(appPath, '..', '..', 'rapports'),
      join(appPath, '..', '..', '..', 'rapports'),
      join(process.cwd(), 'rapports'),
      join(process.cwd(), '..', '..', 'rapports'),
    ];
    const dataDir = settings.orchestra?.trieurDataDir?.trim();
    if (dataDir) places.push(dataDir);
    return readRouterScore(places);
  });

  ipcMain.handle(IpcChannel.settingsGet, () => ({ settings: settingsForWindow(), status: session.status() }));
  ipcMain.handle(IpcChannel.settingsSet, async (_event, patch: Partial<Settings>) => {
    const edited = applySecretEdit(settings, patch, await vault.load(), vault.encryptionAvailable());
    const next = edited.settings;
    if (vault.encryptionAvailable()) await vault.save(edited.secrets);
    const hotkeyChanged = next.hotkey !== settings.hotkey;
    settings = next;
    await writeSettings(edited.disk);

    overlay?.setHideOnBlur(!settings.stayVisibleOnBlur && !isDev);
    if (hotkeyChanged && !registerHotkey(settings.hotkey)) {
      registerHotkey('Control+Space');
      settings = parseSettings({ ...settings, hotkey: 'Control+Space' });
      await writeSettings(settings);
    }
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }

    if (speakerWhisperHeld(settings)) overlay?.browserWindow.webContents.send(IpcChannel.speakerHoldWhisper);
    if (speakerStaysAwake(settings) || speakerWarmupEnabled(settings)) void warmSpeakerSide();
    return { settings: settingsForWindow(), status: session.status() };
  });

  const persistSettings = async (next: Settings): Promise<{ settings: Settings; status: RuntimeStatus }> => {
    const hotkeyChanged = next.hotkey !== settings.hotkey;
    settings = parseSettings(next, settings);
    await writeSettings(settings);
    overlay?.setHideOnBlur(!settings.stayVisibleOnBlur && !isDev);
    if (hotkeyChanged && !registerHotkey(settings.hotkey)) {
      registerHotkey('Control+Space');
      settings = parseSettings({ ...settings, hotkey: 'Control+Space' }, settings);
      await writeSettings(settings);
    }
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    }
    return { settings: settingsForWindow(), status: session.status() };
  };

  ipcMain.handle(IpcChannel.healthCurrent, () => healthMonitor?.latest() ?? null);
  ipcMain.handle(IpcChannel.healthRefresh, () => healthMonitor?.run() ?? Promise.reject(new Error('bilan indisponible')));
  ipcMain.handle(IpcChannel.backupState, () => backupService?.state() ?? { lastAt: null, ok: true, file: '', error: '' });
  ipcMain.handle(IpcChannel.backupNow, () => backupService?.backupNow() ?? { ok: false, file: '', error: 'Sauvegarde indisponible.' });
  ipcMain.handle(IpcChannel.backupList, async () => {
    const items = (await backupService?.list()) ?? [];
    return items.map((item) => ({
      name: item.name,
      createdAt: item.manifest?.createdAt ?? '',
      note: item.manifest?.note ?? '',
      entries: item.manifest?.entries.map((entry) => entry.path) ?? [],
      restorable: manifestIsValid(item.manifest),
    }));
  });
  ipcMain.handle(IpcChannel.backupPick, async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle(IpcChannel.backupRestore, (_event, name: string) =>
    backupService?.restore(typeof name === 'string' ? name : '') ?? { ok: false, file: '', error: 'Sauvegarde indisponible.' },
  );
  ipcMain.handle(IpcChannel.knowSummary, () => privacy.summary());
  ipcMain.handle(IpcChannel.knowView, (_event, id: string) => {
    if (!isKnowCategoryId(id)) throw new Error('Catégorie inconnue.');
    return privacy.view(id);
  });
  ipcMain.handle(IpcChannel.knowExport, async () => {
    const picked = await dialog.showSaveDialog({
      defaultPath: 'jarvis-ce-que-je-sais.zip',
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, error: 'Export annulé.' };
    const bytes = await privacy.exportAll();
    await writeFile(picked.filePath, bytes);
    return { ok: true };
  });
  ipcMain.handle(IpcChannel.knowErase, async (_event, id: string, conversationId?: string) => {
    if (!isKnowCategoryId(id)) throw new Error('Catégorie inconnue.');
    await privacy.erase(id, conversationId);
    return privacy.summary();
  });
  ipcMain.handle(IpcChannel.knowEraseAll, async () => {
    await privacy.eraseAll();
    return privacy.summary();
  });

  ipcMain.handle(IpcChannel.questionnaireGet, async () => {
    await questionnaire.load();
    return questionnaire.snapshot();
  });
  ipcMain.handle(IpcChannel.questionnaireSet, async (_event, patch: unknown) =>
    questionnaire.set(sanitizeQuestionnaireSetPatch(patch)),
  );
  ipcMain.handle(IpcChannel.questionnaireApply, async () => {
    const repoPath = settings.developer.repoPath?.trim();
    let developerRepoValid = false;
    if (repoPath) {
      const facts = await gatherRepoFacts(repoPath, runProcess);
      developerRepoValid = validateRepo(facts, app.getVersion(), []).ok;
    }
    const ollama = await checkOllamaStatus(settings.baseUrl || ollamaDescriptor.defaultBaseUrl!);
    const applied = await questionnaire.apply({
      readSettings: () => Promise.resolve(settings),
      writeSettingsPatch: async (patch) => {
        const next = parseSettings({ ...settings, ...patch }, settings);
        const payload = await persistSettings(next);
        return payload.settings;
      },
      mergePersonalization: async (patch) => {
        await personalization.merge(patch);
      },
      replacePersonalization: async (profile) => {
        await personalization.replace(profile);
      },
      environment: {
        ollamaModels: ollama.models.map((model) => model.name),
        developerRepoValid,
        personalization: await personalization.get(),
      },
    });
    if (applied.openDashboard) overlay?.setChrome('dashboard');
    return { state: applied.state, settings: applied.settings, status: session.status() };
  });
  ipcMain.handle(IpcChannel.questionnaireRestore, async () => {
    const restored = await questionnaire.restore({
      readSettings: () => Promise.resolve(settings),
      writeSettings: async (next) => {
        const payload = await persistSettings(next);
        return payload.settings;
      },
      replacePersonalization: async (profile) => {
        await personalization.replace(profile);
      },
    });
    if (!restored.settings) {
      return { state: restored.state, settings: null, status: session.status() };
    }
    return { state: restored.state, settings: restored.settings, status: session.status() };
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
  ipcMain.handle(IpcChannel.settingsSpotifyListDevices, (_event, clientId?: string) =>
    spotify.listDevices(clientId),
  );
  ipcMain.handle(
    IpcChannel.settingsSiteBlockStatus,
    (_event, credentials?: { baseUrl?: string; token?: string }) =>
      siteBlock.connectionStatus(credentials),
  );
  ipcMain.handle(
    IpcChannel.settingsRoverStatus,
    (_event, credentials?: { baseUrl?: string; token?: string }) =>
      rover.connectionStatus(sanitizeRoverCredentials(credentials)),
  );
  ipcMain.handle(IpcChannel.settingsImagesStatus, (_event, draft?: { forgeDir?: string; forgeUrl?: string; outputRoot?: string }) =>
    images.status(sanitizeImagesDraft(draft)),
  );
  ipcMain.handle(IpcChannel.settingsGeocodeSearch, async (_event, query: string) => {
    const q = typeof query === 'string' ? query.trim() : '';
    if (q.length < 2 || q.length > 120) return [];
    return searchOpenMeteoPlaces(q, { count: 6 });
  });
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
  ipcMain.handle(IpcChannel.voicePiperStatus, async () => ({
    ready: await piper.isReady(settings.voice.ttsVoice || undefined),
    benchmarkMs: piper.streamingBenchmarkMs,
  }));
  ipcMain.handle(IpcChannel.voicePiperSpeak, async (_event, input: VoicePiperSpeakInput) => {
    if (settings.voice.ttsProvider !== PIPER_TTS_ID) {
      return { ok: false as const, error: 'Choisissez la voix Piper dans les réglages.' };
    }
    try {
      const wav = input.sentence
        ? await piper.synthesizeSentenceWav(input.text, input.voice)
        : await piper.synthesizeWav({ text: input.text, voiceId: input.voice });
      return { ok: true as const, data: wav, mimeType: 'audio/wav' };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
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

  ipcMain.handle(IpcChannel.phoneStatus, () => phone.status());
  ipcMain.handle(IpcChannel.phoneSetEnabled, (_event, enabled: unknown) => phone.setEnabled(enabled === true));
  ipcMain.handle(IpcChannel.phoneStartPairing, () => phone.startPairing());
  ipcMain.handle(IpcChannel.phoneCancelPairing, () => phone.cancelPairing());
  ipcMain.handle(IpcChannel.speakerStatus, () => speakers.status());
  ipcMain.handle(IpcChannel.speakerSetEnabled, async (_event, enabled: unknown) => {
    const status = await speakers.setEnabled(enabled === true);
    if (status.running) void warmSpeakerSide();
    if (speakerWhisperHeld(settings)) overlay?.browserWindow.webContents.send(IpcChannel.speakerHoldWhisper);
    return status;
  });
  ipcMain.handle(IpcChannel.speakerChrono, () => speakerChrono.view());
  ipcMain.handle(IpcChannel.speakerChronoReset, () => {
    speakerChrono.reset();
    return speakerChrono.view();
  });
  ipcMain.handle(IpcChannel.speakerAdd, (_event, name: unknown) => speakers.add(typeof name === 'string' ? name : ''));
  ipcMain.handle(IpcChannel.speakerBeginInstall, (_event, payload: unknown) => {
    const body = payload as { name?: unknown; mac?: unknown } | null;
    const mac = typeof body?.mac === 'string' ? body.mac : '';
    return speakers.beginInstall(typeof body?.name === 'string' ? body.name : '', mac);
  });
  ipcMain.handle(IpcChannel.speakerCommitInstall, (_event, payload: unknown) => {
    const body = payload as { id?: unknown; fw?: unknown } | null;
    if (typeof body?.id !== 'string') return speakers.status();
    return speakers.commitInstall(body.id, typeof body.fw === 'string' ? body.fw : undefined);
  });
  ipcMain.handle(IpcChannel.speakerAbandonInstall, (_event, id: unknown) =>
    typeof id === 'string' ? speakers.abandonInstall(id) : speakers.status(),
  );
  ipcMain.handle(IpcChannel.speakerPickPort, (_event, portId: unknown) => {
    if (typeof portId === 'string' && portId.length < 200) pickSpeakerPort(portId);
  });
  ipcMain.handle(IpcChannel.speakerFirmware, () => {
    const dir = app.isPackaged ? join(process.resourcesPath, 'speaker-firmware') : join(app.getAppPath(), 'speaker-firmware');
    return loadSpeakerFirmware(dir);
  });
  ipcMain.handle(IpcChannel.speakerRemove, (_event, id: unknown) =>
    typeof id === 'string' && id.length <= 100 ? speakers.remove(id) : speakers.status(),
  );
  const speakerScript = (name: string): string =>
    app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name);
  ipcMain.handle(IpcChannel.speakerNetStatus, async () => {
    const status = await speakers.status();
    const kept = await keptLanAddresses();
    return collectSpeakerNet({
      platform: process.platform,
      read: () => readStatusScript(speakerScript('speaker-net-status.ps1')),
      bridgeRunning: status.running,
      kept,
      speakers: status.speakers.map((speaker) => ({
        name: speaker.name,
        lastHelloAt: speaker.lastHelloAt ?? speaker.lastTurnAt,
      })),
      now: Date.now(),
    });
  });
  ipcMain.handle(IpcChannel.speakerRepair, async () => {
    if (process.platform !== 'win32') return { ok: false, sentence: 'Ce contrôle est prévu pour Windows.' };
    const status = await speakers.status();
    return repairFirewall(status.port, speakerScript('speaker-firewall.ps1'), {
      readStatus: async () => '',
      elevate: elevateScript,
    });
  });
  ipcMain.handle(IpcChannel.speakerSignal, (_event, id: unknown) =>
    typeof id === 'string' && id.length <= 100 ? speakers.signal(id) : speakers.status(),
  );
  ipcMain.handle(IpcChannel.speakerRename, (_event, payload: unknown) => {
    const body = payload as { id?: unknown; name?: unknown } | null;
    if (typeof body?.id !== 'string' || body.id.length > 100 || typeof body.name !== 'string') return speakers.status();
    return speakers.rename(body.id, body.name.slice(0, 40));
  });
  ipcMain.handle(IpcChannel.speakerMakePrivate, async (_event, index: unknown) => {
    if (process.platform !== 'win32') return { ok: false, sentence: 'Ce contrôle est prévu pour Windows.' };
    try {
      const parsed = parseNetStatus(await readStatusScript(speakerScript('speaker-net-status.ps1')));
      const home = parsed ? homeInterface(parsed.profiles, await keptLanAddresses()) : null;
      return await repairPrivate(index, home, speakerScript('speaker-private.ps1'), {
        readStatus: async () => '',
        elevate: elevateScript,
      });
    } catch {
      return { ok: false, sentence: "Je n'arrive pas à lire le réseau." };
    }
  });
  ipcMain.handle(IpcChannel.phoneRevoke, (_event, id: unknown) =>
    typeof id === 'string' && id.length <= 100 ? phone.revoke(id) : phone.status(false),
  );

  ipcMain.handle(IpcChannel.updateGetState, () => updateManager.getState());
  ipcMain.handle(IpcChannel.updateCheck, () => updateManager.checkNow());
  ipcMain.handle(IpcChannel.updateInstall, () => updateManager.quitAndInstall());

  // Jarvis Développeur : session séparée du chat, créée seulement si le mode est activé.
  developerIpc = registerDeveloperIpc(ipcMain, {
    getSettings: () => settings,
    appVersion: () => app.getVersion(),
    platform: process.platform,
    home: app.getPath('home'),
    logsDir: () => join(app.getPath('userData'), 'logs'),
    oneDriveRoots: () => [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter((root): root is string => Boolean(root)),
    auditLog,
    target: () => overlay?.browserWindow.webContents ?? null,
    onDeveloperState: (state) => {
      void chatMissionSync?.onDeveloperState(state);
    },
    registry,
    searchRegistry,
    userDataPath: () => app.getPath('userData'),
    chat: chatActivity,
    learningRecall: async (query) =>
      coderLearningPrompt(await knowledge.relevantLearning(query, 4), {
        query,
        memory: memoryRetrievalEnabled(settings.developer),
        skills: skillLibraryEnabled(settings.developer),
      }),
    learningRecords: async (query) => knowledge.applicableLearning(query, 4),
    ruleLearning: async (query) => knowledge.ruleLearning(query, 4),
    rememberLearning: async (record) => {
      await knowledge.applyLearning(record);
    },
    settleLearning: async (id, outcome) => {
      await knowledge.settleMethod(id, outcome);
    },
  });
  chatMissionHub = new ChatMissionHub({
    getSettings: () => settings,
    developer: () => developerIpc?.current() ?? null,
    realBenches: () => developerIpc?.current()?.state().model.realBenches ?? [],
  });
  chatMissionSync = new ChatMissionSync({
    hub: chatMissionHub,
    store,
    pushEvent: pushChatEvent,
  });
  registerChatMissionIpc(ipcMain, {
    hub: () => chatMissionHub,
    sync: () => chatMissionSync,
    store,
    pushEvent: pushChatEvent,
    openMission: async (missionId, projectId) => {
      await developerIpc?.ensure()?.openMission(missionId, projectId);
    },
    missionWorktree: () => developerIpc?.current()?.state().codeTask?.worktreePath ?? null,
  });
  openPlayProject(pendingPlayProjectId);
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

/** Brouillon du renderer pour le test du robot : deux chaînes bornées, rien d'autre. */
function sanitizeRoverCredentials(credentials: unknown): { baseUrl?: string; token?: string } | undefined {
  if (!credentials || typeof credentials !== 'object') return undefined;
  const value = credentials as Record<string, unknown>;
  return {
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl.slice(0, 300) : undefined,
    token: typeof value.token === 'string' ? value.token.slice(0, 300) : undefined,
  };
}

/** Vrai dès `before-quit` : la fenêtre principale se laisse fermer (voir `window.ts`). */
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // L'assistant vit dans la zone de notification : fermer la fenêtre ne quitte pas.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void phone.stop();
  void speakers.stop();
  void piper.stop();
  // Un Forge lancé par Jarvis ne survit pas à Jarvis (un Forge lancé par l'utilisateur n'est pas touché).
  void images.shutdown();
  updateManager.stop();
});

/** Photos jointes venues de l'interface : 3 au plus, type image, base64 bornée (≈ 20 Mo d'octets). */
function sanitizeAttachments(list: unknown): SendChatInput['attachments'] {
  if (!Array.isArray(list) || !list.length) return undefined;
  const clean: NonNullable<SendChatInput['attachments']> = [];
  for (const item of list.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.slice(0, 120) : '';
    const mime = typeof record.mime === 'string' ? record.mime.slice(0, 60) : '';
    const dataBase64 = typeof record.dataBase64 === 'string' ? record.dataBase64 : '';
    if (!name || !dataBase64 || dataBase64.length > 28_000_000) continue;
    clean.push({ name, mime, dataBase64 });
  }
  return clean.length ? clean : undefined;
}

function sanitizeImagesDraft(draft: unknown): { forgeDir?: string; forgeUrl?: string; outputRoot?: string } | undefined {
  if (!draft || typeof draft !== 'object') return undefined;
  const record = draft as Record<string, unknown>;
  const pick = (key: string) => (typeof record[key] === 'string' ? (record[key] as string).slice(0, 400) : undefined);
  const forgeDir = pick('forgeDir');
  const forgeUrl = pick('forgeUrl');
  const outputRoot = pick('outputRoot');
  return {
    ...(forgeDir !== undefined ? { forgeDir } : {}),
    ...(forgeUrl !== undefined ? { forgeUrl } : {}),
    ...(outputRoot !== undefined ? { outputRoot } : {}),
  };
}
