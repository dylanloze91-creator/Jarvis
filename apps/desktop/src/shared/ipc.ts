import type {
  AuditEntry,
  ChatMessage,
  Conversation,
  ConversationSummary,
  MarketDataProviderDescriptor,
  OllamaDiagnosticResult,
  OllamaStatusResult,
  PersonalizationProfile,
  KnowledgeStats,
  ProviderDescriptor,
  RiskLevel,
  SearchProviderDescriptor,
  Settings,
  ToolCategory,
  UpdateFailureKind,
} from '@jarvis/core';

export const IpcChannel = {
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  confirmRespond: 'chat:confirm-respond',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsProviders: 'settings:providers',
  settingsSearchProviders: 'settings:search-providers',
  settingsMarketDataProviders: 'settings:market-data-providers',
  settingsOllamaStatus: 'settings:ollama-status',
  settingsOllamaTest: 'settings:ollama-test',
  settingsSpotifyStatus: 'settings:spotify-status',
  settingsSpotifyConnect: 'settings:spotify-connect',
  settingsSpotifyDisconnect: 'settings:spotify-disconnect',
  settingsSiteBlockStatus: 'settings:siteblock-status',
  settingsPersonalizationGet: 'settings:personalization-get',
  settingsPersonalizationReset: 'settings:personalization-reset',
  settingsKnowledgeStats: 'settings:knowledge-stats',
  settingsKnowledgeClear: 'settings:knowledge-clear',
  historyList: 'history:list',
  historyGet: 'history:get',
  historyRemove: 'history:remove',
  historyClear: 'history:clear',
  toolsList: 'tools:list',
  auditList: 'audit:list',
  auditClear: 'audit:clear',
  windowHide: 'window:hide',
  windowResize: 'window:resize',
  windowSetChrome: 'window:set-chrome',
  windowIsVisible: 'window:is-visible',
  windowShown: 'window:shown',
  systemSnapshot: 'system:snapshot',
  voiceTranscribe: 'voice:transcribe',
  voiceSpeak: 'voice:speak',
  voiceAssetsReport: 'voice:assets-report',
  voiceCopyReport: 'voice:copy-report',
  voiceCaptureLog: 'voice:capture-log',
  voiceOpenMicrophonePrivacy: 'voice:open-microphone-privacy',
  youtubeTranscribe: 'youtube:transcribe-audio',
  youtubeTranscribeProgress: 'youtube:transcribe-progress',
  youtubeTranscribeResult: 'youtube:transcribe-result',
  updateGetState: 'update:get-state',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateEvent: 'update:event',
} as const;

export interface SendChatInput {
  conversationId: string | null;
  text: string;
  /**
   * Origine du message : `voice` pour la reconnaissance vocale, `text` pour
   * le clavier (défaut). Sert uniquement à avertir le modèle, dans le prompt
   * système, que le texte peut contenir des erreurs de transcription — ne
   * touche jamais le contenu affiché ni celui persisté dans l'historique.
   */
  source?: 'voice' | 'text';
}

export interface SpotifyStatus {
  /** Un identifiant client Spotify est renseigné dans les réglages. */
  configured: boolean;
  /** Un jeton local existe (compte connecté au moins une fois). */
  connected: boolean;
}

export type SpotifyConnectResult = { ok: true } | { ok: false; error: string };

export interface SiteBlockStatus {
  /** Un jeton est disponible (réglages ou fichier api.json de SiteBlock). */
  configured: boolean;
  /** L’API loopback a répondu. */
  reachable: boolean;
  blockingActiveNow?: boolean;
  error?: string;
}

export interface SiteBlockCredentials {
  baseUrl?: string;
  token?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: RiskLevel;
  category?: ToolCategory;
  forceConfirm: boolean;
}

/** Événements poussés du processus principal vers l'interface pendant un tour. */
export type ChatEvent =
  | { type: 'started'; conversationId: string; message: ChatMessage }
  | { type: 'delta'; text: string }
  | {
      type: 'confirm';
      requestId: string;
      toolName: string;
      details: string;
      /** Commande ou action exacte à afficher telle quelle (obligatoire pour `run_command`). */
      command?: string;
      /** Confirmation incompressible : l'interface le signale distinctement. */
      forced?: boolean;
    }
  | { type: 'tool_start'; callId: string; toolName: string }
  | { type: 'tool_progress'; callId: string; message: string }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      status: 'ok' | 'error' | 'denied';
      content: string;
    }
  | { type: 'error'; message: string }
  | { type: 'done'; conversationId: string; messages: ChatMessage[] };

export type WindowChrome = 'compact' | 'dashboard';

/** CPU, RAM et version lus sur la machine. `null` = pas encore connu. */
export interface MachineSnapshot {
  cpuPercent: number | null;
  logicalCores: number | null;
  ramUsedBytes: number | null;
  ramTotalBytes: number | null;
  version: string | null;
}

export interface RuntimeStatus {
  providerId: string;
  providerLabel: string;
  model: string;
  usingFallback: boolean;
  /** Vrai si une clé OpenAI est configurée pour la voix (jamais transmise elle-même au renderer). */
  voiceKeyConfigured: boolean;
}

/**
 * Requêtes vocales qui doivent obligatoirement passer par le processus
 * principal : ce sont les seules à impliquer une clé API, qui ne doit
 * jamais atteindre le renderer. Tout le reste de la voix (capture micro,
 * détection du mot de réveil, reconnaissance et synthèse locales) se passe
 * entièrement dans le renderer, sans IPC.
 */
export interface YoutubeTranscribeRequest {
  requestId: string;
  bytes: Uint8Array;
}

export interface YoutubeTranscribeProgress {
  requestId: string;
  message: string;
}

export interface YoutubeTranscribeResult {
  requestId: string;
  ok: boolean;
  text?: string;
  error?: string;
}

export interface VoiceTranscribeInput {
  /** PCM mono, amplitude normalisée [-1, 1]. */
  pcm: Float32Array;
  sampleRate: number;
  language?: string;
}

export type VoiceTranscribeResult = { ok: true; text: string } | { ok: false; error: string };

export interface VoiceSpeakInput {
  text: string;
  voice?: string;
}

export type VoiceSpeakResult =
  { ok: true; data: Uint8Array; mimeType: string } | { ok: false; error: string };

/** Vue du processus principal sur les fichiers voix, pour « Tester la voix ». */
export interface VoiceAssetsReport {
  appVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
  electron: string;
  chrome: string;
  /** Dossier qui contient `ort/`, `whisper/`, `openwakeword/`. */
  root: string;
  files: Array<{ host: string; path: string; exists: boolean; size: number; minBytes: number }>;
}

/**
 * Étapes de la mise à jour automatique. `unsupported` couvre le mode
 * développement (aucun `app-update.yml` empaqueté : la vérification n'a
 * jamais de sens hors application packagée) — l'interface l'affiche comme
 * une simple absence de fonctionnalité, jamais comme une erreur.
 */
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error';

export interface UpdateProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}

export interface UpdateState {
  currentVersion: string;
  phase: UpdatePhase;
  /** Version disponible ou en cours de téléchargement/déjà téléchargée. */
  availableVersion?: string;
  progress?: UpdateProgress;
  lastCheckedAt?: number;
  /** Message d'erreur en français, prêt à afficher — présent seulement si `phase === 'error'`. */
  errorMessage?: string;
  errorKind?: UpdateFailureKind;
  /**
   * `empty` : le dépôt GitHub n'a aucune Release (vérifié, pas une panne).
   * `ok` : un latest.yml a été lu.
   */
  feedStatus?: 'ok' | 'empty';
  /** Faux en mode développement : on peut vérifier, pas télécharger/installer. */
  canInstall: boolean;
}

export interface JarvisApi {
  chat: {
    send(input: SendChatInput): Promise<void>;
    cancel(): Promise<void>;
    onEvent(listener: (event: ChatEvent) => void): () => void;
    respondConfirmation(requestId: string, approved: boolean): Promise<void>;
  };
  settings: {
    get(): Promise<{ settings: Settings; status: RuntimeStatus }>;
    set(patch: Partial<Settings>): Promise<{ settings: Settings; status: RuntimeStatus }>;
    providers(): Promise<ProviderDescriptor[]>;
    searchProviders(): Promise<SearchProviderDescriptor[]>;
    marketDataProviders(): Promise<MarketDataProviderDescriptor[]>;
    /** Sonde le serveur Ollama local (détecté / absent / injoignable) et liste ses modèles installés. */
    ollamaStatus(baseUrl?: string): Promise<OllamaStatusResult>;
    /** Test de connexion complet : serveur, modèle installé, puis appel d'outil réel. */
    ollamaTest(input: { baseUrl?: string; model: string }): Promise<OllamaDiagnosticResult>;
    /** État de connexion Spotify. `clientId` optionnel = valeur non encore enregistrée, pour la tester avant « Enregistrer ». */
    spotifyStatus(clientId?: string): Promise<SpotifyStatus>;
    /** Lance le flux d'autorisation Spotify (ouvre le navigateur, attend le retour avec expiration). */
    spotifyConnect(clientId?: string): Promise<SpotifyConnectResult>;
    /** Supprime le jeton Spotify local. */
    spotifyDisconnect(clientId?: string): Promise<void>;
    /** Sonde l’API locale SiteBlock. Les champs optionnels testent un brouillon non encore enregistré. */
    siteBlockStatus(credentials?: SiteBlockCredentials): Promise<SiteBlockStatus>;
    /** Lit la mémoire de personnalisation persistante (fichier local). */
    personalizationGet(): Promise<PersonalizationProfile>;
    /** Efface toute la mémoire de personnalisation persistante. */
    personalizationReset(): Promise<PersonalizationProfile>;
    /** Statistiques de l’index documentaire local. */
    knowledgeStats(): Promise<KnowledgeStats>;
    /** Efface l’index documentaire local. */
    knowledgeClear(): Promise<KnowledgeStats>;
  };
  history: {
    list(): Promise<ConversationSummary[]>;
    get(id: string): Promise<Conversation | null>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
  };
  tools: {
    list(): Promise<ToolInfo[]>;
  };
  audit: {
    list(limit?: number): Promise<AuditEntry[]>;
    clear(): Promise<void>;
  };
  window: {
    hide(): Promise<void>;
    resize(height: number): Promise<void>;
    /** Étroit = overlay actuel. Large = tableau de bord. */
    setChrome(mode: WindowChrome): Promise<void>;
    /** Vrai une fois la fenêtre affichée. Le mot de réveil attend ça. */
    isVisible(): Promise<boolean>;
    /** Émis à chaque affichage. Ne pas rater un événement déjà parti : combiner avec `isVisible`. */
    onShown(listener: () => void): () => void;
  };
  system: {
    /** Relevé réel. Les champs inconnus restent `null`. */
    snapshot(): Promise<MachineSnapshot>;
  };
  voice: {
    transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult>;
    speak(input: VoiceSpeakInput): Promise<VoiceSpeakResult>;
    assetsReport(): Promise<VoiceAssetsReport>;
    /** Copie le détail du diagnostic dans le presse-papiers (texte seul). */
    copyReport(text: string): Promise<void>;
    /** Une ligne du journal de capture (durées, erreurs) : console du main + `logs/voice-capture.log`. */
    log(line: string): void;
    /** Ouvre Paramètres Windows > Confidentialité > Microphone. Faux hors Windows. */
    openMicrophonePrivacy(): Promise<boolean>;
  };
  /** Écoute YouTube : le processus principal envoie l'audio, Whisper tourne ici. */
  youtube: {
    onTranscribe(listener: (request: YoutubeTranscribeRequest) => void): () => void;
    reportProgress(payload: YoutubeTranscribeProgress): void;
    reportResult(payload: YoutubeTranscribeResult): void;
  };
  update: {
    getState(): Promise<UpdateState>;
    /** Vérification manuelle (bouton des réglages). Ne rejette jamais : l'état d'erreur passe par l'événement. */
    check(): Promise<void>;
    /** Redémarre l'application et installe la mise à jour déjà téléchargée. */
    install(): Promise<void>;
    onEvent(listener: (state: UpdateState) => void): () => void;
  };
}
