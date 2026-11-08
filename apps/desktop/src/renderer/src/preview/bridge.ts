import {
  GOOGLE_REDIRECT_URI,
  defaultSettings,
  describeGoogleAccess,
  emptyPersonalization,
  emptyQuestionnaireState,
  formatMailForConfirmation,
  googleScopesFor,
  summarizeMailSend,
  type Settings,
} from '@jarvis/core';
import type {
  ChatEvent,
  GoogleStatus,
  JarvisApi,
  MachineSnapshot,
  PhoneStatus,
  SpeakerStatus,
  ToolInfo,
  WakeLearningStatus,
  WindowChrome,
} from '../../../shared/ipc';
import desktopPackage from '../../../../package.json' with { type: 'json' };
import { createPreviewDeveloperApi } from './developerBridge';

/**
 * Pont de prévisualisation : utilisé uniquement quand le preload Electron
 * n'est pas présent (Vite seul, captures d'écran). L'application packagée
 * continue d'utiliser le vrai IPC.
 */
export function installPreviewBridge(): void {
  if (window.jarvis) return;

  document.documentElement.classList.add('preview-capture');

  let settings: Settings = {
    ...defaultSettings,
    stayVisibleOnBlur: true,
  };
  const listeners = new Set<(event: ChatEvent) => void>();
  let phone: PhoneStatus = {
    enabled: false,
    running: false,
    port: 53130,
    error: null,
    tailscale: { installed: true, online: true, dnsName: 'pc-de-dylan.tail1a2b.ts.net', served: true },
    url: 'https://pc-de-dylan.tail1a2b.ts.net/',
    serveCommand: 'tailscale serve --bg 53130',
    devices: [],
    pairing: null,
  };
  let speakers: SpeakerStatus = {
    enabled: false,
    running: false,
    port: 53131,
    error: null,
    addresses: ['192.168.1.20'],
    hostName: 'pc-de-dylan.local',
    speakers: [],
  };

  const status = () => ({
    providerId: settings.provider,
    providerLabel: 'Démo hors ligne (sans clé API)',
    model: settings.model,
    usingFallback: true,
    voiceKeyConfigured: false,
  });

  // Aperçu Google : `?google=connected` ou la scène de confirmation simulent un compte connecté.
  const search = new URLSearchParams(window.location.search);
  let googleConnected = search.get('google') === 'connected' || search.get('scene') === 'google-confirm';
  if (googleConnected) {
    settings = {
      ...settings,
      googleClientId: '123456789012-jarvisdesktop.apps.googleusercontent.com',
      googleClientSecret: 'GOCSPX-apercu',
    };
  }
  if (search.get('scene') === 'backup') {
    settings = { ...settings, backup: { directory: 'Disque de sauvegarde', frequency: 'weekly', keep: 4 } };
  }
  if (search.get('scene')?.startsWith('developer')) {
    const codeModel = search.get('scene')?.startsWith('developer-task') ? 'qwen3.6:35b-a3b-coding' : '';
    settings = {
      ...settings,
      developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', codeModel, chatModel: '', worktreeRoot: '' },
    };
  }
  if (search.get('scene')?.startsWith('chat-mission')) {
    settings = {
      ...settings,
      orchestra: { enabled: true, brain: 'qwen2.5:7b' },
      developer: {
        enabled: true,
        repoPath: 'C:\\dev\\Jarvis',
        codeModel: 'qwen2.5-coder:7b',
        chatModel: '',
        worktreeRoot: '',
        chatMissions: true,
      },
    };
  }
  const googleStatus = (): GoogleStatus => ({
    configured: Boolean(settings.googleClientId),
    connected: googleConnected,
    needsReconsent: false,
    connecting: false,
    account: googleConnected ? 'thedexios@gmail.com' : null,
    access: googleConnected ? settings.googleAccess : null,
    requestedAccess: settings.googleAccess,
    services: describeGoogleAccess(googleConnected ? googleScopesFor(settings.googleAccess) : [], settings.googleAccess).map(
      (service) => (googleConnected ? service : { ...service, read: false, write: false, readMissing: false, writeMissing: false }),
    ),
    persistent: true,
    redirectUri: GOOGLE_REDIRECT_URI,
    clientMismatch: false,
    connectedAt: googleConnected ? Date.now() : null,
  });
  let pendingConfirmation: ((approved: boolean) => void) | null = null;

  const tools: ToolInfo[] = [
    { name: 'web_search', description: 'Recherche Internet', risk: 'safe', forceConfirm: false },
    { name: 'web_research', description: 'Recherche approfondie', risk: 'safe', forceConfirm: false },
    { name: 'get_system_info', description: 'État de la machine', risk: 'safe', forceConfirm: false },
    { name: 'run_command', description: 'Commande', risk: 'confirm', category: 'shell', forceConfirm: true },
  ];

  const api: JarvisApi = {
    chat: {
      send: async (input) => {
        const conversationId = input.conversationId ?? 'preview';
        if (googleConnected && /^Envoie à Marie/.test(input.text)) {
          const mail = {
            to: 'marie.dupont@example.com',
            subject: 'Réunion de jeudi',
            body: 'Bonjour Marie,\n\nJe confirme la réunion de jeudi à 10 h au bureau.\n\nBonne journée,\nThedexios',
          };
          const emit = (event: ChatEvent): void => {
            for (const listener of listeners) listener(event);
          };
          emit({
            type: 'started',
            conversationId,
            message: { id: `u-${Date.now()}`, role: 'user', content: input.text, createdAt: Date.now() },
          });
          emit({ type: 'tool_start', callId: 'preview-send', toolName: 'google_gmail_send' });
          emit({
            type: 'confirm',
            requestId: 'preview-confirm',
            toolName: 'google_gmail_send',
            details: summarizeMailSend(mail.to),
            command: formatMailForConfirmation(mail),
            forced: true,
          });
          pendingConfirmation = (approved) => {
            const text = approved
              ? `Mail envoyé et vérifié (présent dans « Messages envoyés ») : à ${mail.to} — « ${mail.subject} ».`
              : "D'accord, je n'ai rien fait : tu as refusé « google_gmail_send ». Rien n'a été modifié.";
            emit({ type: 'tool_result', callId: 'preview-send', toolName: 'google_gmail_send', status: approved ? 'ok' : 'denied', content: text });
            emit({ type: 'delta', text });
            emit({ type: 'done', conversationId, messages: [] });
          };
          return;
        }
        for (const listener of listeners) {
          listener({
            type: 'started',
            conversationId,
            message: {
              id: `u-${Date.now()}`,
              role: 'user',
              content: input.text,
              createdAt: Date.now(),
            },
          });
          listener({ type: 'delta', text: 'Réponse de démonstration pour l’aperçu de l’interface.' });
          listener({
            type: 'done',
            conversationId,
            messages: [],
          });
        }
      },
      cancel: async () => undefined,
      respondConfirmation: async (_requestId, approved) => {
        const resolve = pendingConfirmation;
        pendingConfirmation = null;
        resolve?.(approved);
      },
      launchMissionProposal: async () => undefined,
      declineMissionProposal: async () => undefined,
      setMissionProposalProject: async () => undefined,
      patchMissionProposal: async () => undefined,
      openMissionFolder: async () => undefined,
      reloadConversationMissions: async () => undefined,
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    orchestra: {
      validateTeam: async () => ({ ok: true }),
    },
    settings: {
      get: async () => ({ settings, status: status() }),
      set: async (patch) => {
        settings = { ...settings, ...patch };
        return { settings, status: status() };
      },
      providers: async () => [
        {
          id: 'mock',
          label: 'Démo hors ligne (sans clé API)',
          requiresApiKey: false,
          defaultModel: 'jarvis-demo',
          suggestedModels: ['jarvis-demo'],
        },
        {
          id: 'ollama',
          label: 'Ollama (local, gratuit)',
          requiresApiKey: false,
          defaultModel: 'qwen2.5:3b',
          suggestedModels: ['qwen2.5:3b', 'qwen3.5:4b'],
          defaultBaseUrl: 'http://127.0.0.1:11434',
        },
      ],
      searchProviders: async () => [
        { id: 'google', label: 'Google (sans clé)', requiresApiKey: false },
        { id: 'wikipedia', label: 'Wikipédia', requiresApiKey: false },
        { id: 'brave', label: 'Brave Search', requiresApiKey: true },
        { id: 'duckduckgo', label: 'DuckDuckGo (sans clé)', requiresApiKey: false },
        { id: 'bing', label: 'Bing (sans clé)', requiresApiKey: false },
        { id: 'google-news', label: 'Google Actualités (RSS, sans clé)', requiresApiKey: false },
        { id: 'bing-news', label: 'Bing Actualités (RSS, sans clé)', requiresApiKey: false },
        { id: 'tavily', label: 'Tavily (clé gratuite, sans carte)', requiresApiKey: true },
      ],
      marketDataProviders: async () => [
        { id: 'yahoo-finance', label: 'Yahoo Finance', requiresApiKey: false },
      ],
      ollamaStatus: async () => ({
        status: 'absent',
        baseUrl: 'http://127.0.0.1:11434',
        models: [],
        message: 'Ollama n’est pas détecté sur cette machine d’aperçu.',
      }),
      ollamaTest: async ({ model, baseUrl }) => ({
        ok: false,
        baseUrl: baseUrl || 'http://127.0.0.1:11434',
        model,
        steps: [],
      }),
      spotifyStatus: async () => ({ configured: false, connected: false }),
      spotifyConnect: async () => ({ ok: false, error: 'Aperçu hors Electron.' }),
      spotifyDisconnect: async () => undefined,
      spotifyListDevices: async () => [],
      siteBlockStatus: async () => ({ configured: false, reachable: false }),
      roverStatus: async () => ({ configured: false, reachable: false, authorized: false }),
      geocodeSearch: async () => [],
      googleStatus: async () => googleStatus(),
      googleConnect: async () => {
        googleConnected = Boolean(settings.googleClientId);
        return googleConnected
          ? { ok: true as const, status: googleStatus() }
          : { ok: false as const, error: 'Aperçu hors Electron.', status: googleStatus() };
      },
      googleCancel: async () => undefined,
      googleDisconnect: async () => {
        googleConnected = false;
        return { revoked: true, message: 'Accès révoqué chez Google et jetons effacés de ce PC.', status: googleStatus() };
      },
      personalizationGet: async () => emptyPersonalization(),
      personalizationReset: async () => emptyPersonalization(),
      knowledgeStats: async () => ({ chunks: 0, sources: 0, embedded: 0 }),
      knowledgeClear: async () => ({ chunks: 0, sources: 0, embedded: 0 }),
    },
    history: {
      list: async () => [],
      get: async () => null,
      remove: async () => undefined,
      clear: async () => undefined,
    },
    tools: {
      list: async () => tools,
    },
    audit: {
      list: async () => [],
      clear: async () => undefined,
    },
    window: {
      hide: async () => undefined,
      resize: async () => undefined,
      setChrome: async (mode: WindowChrome) => {
        document.documentElement.dataset.jarvisChrome = mode;
        window.dispatchEvent(new Event('resize'));
      },
      isVisible: async () => true,
      onShown: (listener: () => void) => {
        const onShow = (): void => listener();
        window.addEventListener('jarvis-window-shown', onShow);
        return () => window.removeEventListener('jarvis-window-shown', onShow);
      },
    },
    system: {
      snapshot: previewSnapshot,
    },
    voice: {
      transcribe: async () => ({ ok: false, error: 'Aperçu hors micro.' }),
      speak: async () => ({ ok: false, error: 'Aperçu hors synthèse.' }),
      piperSpeak: async () => ({ ok: false, error: 'Aperçu hors Piper.' }),
      piperStatus: async () => ({ ready: false, benchmarkMs: null }),
      assetsReport: async () => ({
        appVersion: desktopPackage.version,
        platform: 'aperçu',
        arch: '',
        packaged: false,
        electron: '',
        chrome: '',
        root: '(aperçu sans Electron)',
        files: [],
      }),
      copyReport: async (text: string) => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
      },
      log: (line: string) => console.debug(line),
      openMicrophonePrivacy: async () => false,
      setListening: () => undefined,
      sendLevel: () => undefined,
    },
    localLearning: {
      status: async () => ({ running: false, line: null }),
      onEvent: () => () => undefined,
      snapshot: async () => ({
        records: [],
        metrics: {
          missionSuccessRate: null,
          testSuccessRate: null,
          errorsSeen: 0,
          repeatResolved: 0,
          reused: 0,
          webOfficialShare: null,
          trainBefore: null,
          trainAfter: null,
          waiting: 0,
        },
        line: null,
        running: false,
      }),
      train: async () => ({ running: false, line: null }),
      rollback: async () => ({ running: false, line: null }),
      setStatus: async () => [],
      correct: async () => [],
      restore: async () => [],
      exportSkills: async () => [],
      remove: async () => [],
    },
    wakeLearning: {
      status: async () => previewWakeLearningStatus,
      addSample: async () => null,
      recordStats: async () => undefined,
      model: async () => null,
      retrain: async () => null,
      clear: async () => previewWakeLearningStatus,
      reset: async () => previewWakeLearningStatus,
    },
    youtube: {
      onTranscribe: () => () => undefined,
      reportProgress: () => undefined,
      reportResult: () => undefined,
    },
    phone: {
      status: async () => phone,
      setEnabled: async (enabled: boolean) => (phone = { ...phone, enabled, running: enabled, pairing: enabled ? phone.pairing : null }),
      startPairing: async () =>
        (phone = {
          ...phone,
          pairing: { code: '482913', expiresAt: Date.now() + 600_000, url: 'https://pc-de-dylan.tail1a2b.ts.net/#code=482913' },
        }),
      cancelPairing: async () => (phone = { ...phone, pairing: null }),
      revoke: async (id: string) => (phone = { ...phone, devices: phone.devices.filter((device) => device.id !== id) }),
      onEvent: () => () => undefined,
    },
    speaker: {
      status: async () => speakers,
      setEnabled: async (enabled: boolean) => (speakers = { ...speakers, enabled, running: enabled }),
      add: async (name: string) => {
        const speaker = { id: `spk-${speakers.speakers.length + 1}`, name, createdAt: Date.now(), lastTurnAt: null };
        speakers = { ...speakers, speakers: [...speakers.speakers, speaker] };
        return {
          status: speakers,
          speaker: { id: speaker.id, name },
          secrets: `#define JARVIS_HOST "192.168.1.20"\n#define JARVIS_PORT 53131\n#define JARVIS_TOKEN "aperçu-seulement"\n`,
        };
      },
      remove: async (id: string) => (speakers = { ...speakers, speakers: speakers.speakers.filter((item) => item.id !== id) }),
      onEvent: () => () => undefined,
      onTranscribe: () => () => undefined,
      reportTranscript: () => undefined,
    },
    update: {
      getState: async () => ({
        currentVersion: desktopPackage.version,
        phase: 'unsupported',
        canInstall: false,
      }),
      check: async () => undefined,
      install: async () => undefined,
      onEvent: () => () => undefined,
    },
    developer: createPreviewDeveloperApi(search.get('scene'), () => settings.developer.enabled),
    health: {
      current: async () => previewHealth(search.get('scene')),
      refresh: async () => previewHealth(search.get('scene')),
      onReport: () => () => undefined,
    },
    backup: {
      state: async () => ({ lastAt: Date.parse('2026-11-07T10:00:00Z'), ok: true, file: 'jarvis-sauvegarde-20261107T100000Z.zip', error: '' }),
      now: async () => ({ ok: true, file: 'jarvis-sauvegarde-20261108T100000Z.zip', error: '' }),
      list: async () => [
        {
          name: 'jarvis-sauvegarde-20261107T100000Z.zip',
          createdAt: '2026-11-07T10:00:00.000Z',
          note: 'Après une restauration, reconnecte Spotify, Google et les clés.',
          entries: ['settings.json', 'conversations/une.json', 'personalization.json'],
          restorable: true,
        },
      ],
      pickDirectory: async () => 'Disque de sauvegarde',
      restore: async () => ({ ok: true, file: 'jarvis-sauvegarde-20261107T100000Z.zip', error: '' }),
    },
    know: {
      summary: async () => [
        { id: 'personalization', label: 'Personnalisation', hint: 'Prénom et règles', count: 2, included: true },
        { id: 'memories', label: 'Souvenirs', hint: 'Mémoire', count: 3, included: true },
        { id: 'learning', label: 'Corrections et préférences', hint: 'Ce que tu as corrigé', count: 1, included: true },
        { id: 'conversations', label: 'Conversations', hint: 'Une par une, ou toutes', count: 4, included: true },
        { id: 'documents', label: 'Documents indexés', hint: 'Textes rangés', count: 2, included: true },
        { id: 'sorter', label: 'Phrases du trieur', hint: 'À trier, examen, validées', count: 0, included: false },
        { id: 'questionnaire', label: 'Questionnaire', hint: 'Tes réponses', count: 6, included: true },
        { id: 'wake', label: 'Apprentissage du réveil', hint: 'Extraits', count: 12, included: true },
      ],
      view: async () => [
        { id: 'prenom', text: 'prenom : Camarade' },
        { id: 'regle', text: 'Phrases courtes' },
      ],
      exportAll: async () => ({ ok: true }),
      erase: async () => [],
      eraseAll: async () => [],
    },
    questionnaire: {
      get: async () => emptyQuestionnaireState(),
      set: async (patch) => ({ ...emptyQuestionnaireState(), ...patch }),
      apply: async () => ({ state: emptyQuestionnaireState(), settings, status: status() }),
      restore: async () => ({ state: emptyQuestionnaireState(), settings: null, status: status() }),
    },
    machine: {
      status: async () => ({ setupRequired: false, downloadAllowed: false }),
      analyze: async () => ({
        detected: 'Aperçu.',
        chosen: 'Aperçu.',
        profile: 'full' as const,
        chatModel: 'qwen2.5:3b',
        cpuOnly: false,
        measureFailed: false,
        download: { allowed: false, alreadyInstalled: true, ollamaPresent: true },
      }),
      pull: async () => ({ ok: true }),
      cancelPull: async () => undefined,
      apply: async () => ({ settings, status: status() }),
      onPull: () => () => undefined,
    },
  };

  window.jarvis = api;
}

function previewHealth(scene: string | null) {
  const base = {
    at: Date.parse('2026-11-08T10:00:00Z'),
    items: [
      { id: 'ollama' as const, level: 'red' as const, sentence: 'Ollama ne répond pas : les modèles de ce PC sont injoignables.', short: 'Ollama', open: 'model' },
      { id: 'disk' as const, level: 'orange' as const, sentence: 'Il reste moins de 10 Go sur le disque.', short: 'le disque', open: 'machine.profile' },
      { id: 'vault' as const, level: 'green' as const, sentence: 'Les clés sont dans le coffre.', short: 'le coffre', open: 'apiKey' },
    ],
  };
  if (scene === 'health-ok') {
    return { ...base, items: base.items.map((item) => ({ ...item, level: 'green' as const, sentence: 'Tout va bien.' })), issues: 0, banner: null, text: 'Tout va bien.', voice: 'Tout va bien.' };
  }
  return { ...base, issues: 2, banner: '2 choses à régler', text: base.items.map((item) => item.sentence).join('\n'), voice: 'Deux soucis : Ollama, le disque.' };
}

const previewWakeLearningStatus: WakeLearningStatus = {
  positives: 0,
  negatives: 0,
  clips: 0,
  clipBytes: 0,
  enrollment: 0,
  maxClips: 300,
  maxClipBytes: 20 * 1024 * 1024,
  stats: { successes: 0, misses: 0, falseWakes: 0, days: 7 },
  model: null,
};

const emptySnapshot = (): MachineSnapshot => ({
  cpuPercent: null,
  logicalCores: null,
  ramUsedBytes: null,
  ramTotalBytes: null,
  version: null,
});

async function previewSnapshot(): Promise<MachineSnapshot> {
  try {
    const response = await fetch('/__jarvis/machine');
    if (!response.ok) return emptySnapshot();
    const data = (await response.json()) as Partial<MachineSnapshot>;
    return {
      cpuPercent: typeof data.cpuPercent === 'number' ? data.cpuPercent : null,
      logicalCores: typeof data.logicalCores === 'number' ? data.logicalCores : null,
      ramUsedBytes: typeof data.ramUsedBytes === 'number' ? data.ramUsedBytes : null,
      ramTotalBytes: typeof data.ramTotalBytes === 'number' ? data.ramTotalBytes : null,
      version: typeof data.version === 'string' && data.version.trim() ? data.version.trim() : null,
    };
  } catch {
    return emptySnapshot();
  }
}
