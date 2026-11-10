import type {
  AuditEntry,
  ChatMessage,
  ChatMissionEnvelope,
  Conversation,
  ConversationSummary,
  GoogleAccessMode,
  GoogleServiceAccess,
  MarketDataProviderDescriptor,
  OllamaDiagnosticResult,
  OllamaStatusResult,
  PersonalizationProfile,
  KnowledgeStats,
  LearningMetrics,
  LearningRecord,
  SkillTrainRow,
  ProviderDescriptor,
  RiskLevel,
  SearchProviderDescriptor,
  Settings,
  QuestionnaireState,
  GeocodingPlace,
  ToolCategory,
  UpdateFailureKind,
  WakeSampleSource,
  WakeStatKind,
  WakeStatsSummary,
  WakeVerifierModel,
} from '@jarvis/core';
import type { LocalLearningRuntimeStatus } from '@jarvis/core';
import type { DeveloperApi } from './developerIpc.js';

/** Exemple étiqueté envoyé au main : caractéristiques + extrait de 2 s (aucun extrait pour un fond sonore). */
export interface WakeLearningSampleInput {
  id: string;
  label: 'positive' | 'negative';
  source: WakeSampleSource;
  features: number[];
  clip?: Float32Array;
}

export interface WakeLearningStatus {
  positives: number;
  negatives: number;
  clips: number;
  clipBytes: number;
  enrollment: number;
  maxClips: number;
  maxClipBytes: number;
  stats: WakeStatsSummary;
  model: {
    trainedAt: number;
    positives: number;
    negatives: number;
    vetoEnabled: boolean;
    vetoThreshold: number;
    rescueThreshold: number | null;
    cvRecall: number;
    cvRejection: number;
  } | null;
}

/** Captation de la commande après un réveil : pour l'orbe et le petit indicateur hors fenêtre. */
export interface ListeningIndicatorState {
  active: boolean;
}

export const IpcChannel = {
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event',
  confirmRespond: 'chat:confirm-respond',
  chatMissionLaunch: 'chat:mission-launch',
  chatMissionDecline: 'chat:mission-decline',
  chatMissionSetProject: 'chat:mission-set-project',
  chatMissionPatchProposal: 'chat:mission-patch-proposal',
  chatMissionOpenFolder: 'chat:mission-open-folder',
  chatMissionReload: 'chat:mission-reload',
  orchestraValidateTeam: 'orchestra:validate-team',
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
  settingsSpotifyListDevices: 'settings:spotify-list-devices',
  settingsSiteBlockStatus: 'settings:siteblock-status',
  settingsRoverStatus: 'settings:rover-status',
  settingsImagesStatus: 'settings:images-status',
  imagesOpen: 'images:open',
  settingsGeocodeSearch: 'settings:geocode-search',
  settingsGoogleStatus: 'settings:google-status',
  settingsGoogleConnect: 'settings:google-connect',
  settingsGoogleCancel: 'settings:google-cancel',
  settingsGoogleDisconnect: 'settings:google-disconnect',
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
  voicePiperSpeak: 'voice:piper-speak',
  voicePiperStatus: 'voice:piper-status',
  voiceAssetsReport: 'voice:assets-report',
  voiceCopyReport: 'voice:copy-report',
  voiceCaptureLog: 'voice:capture-log',
  voiceOpenMicrophonePrivacy: 'voice:open-microphone-privacy',
  wakeLearningStatus: 'wake-learning:status',
  wakeLearningAddSample: 'wake-learning:add-sample',
  wakeLearningStats: 'wake-learning:stats',
  wakeLearningModel: 'wake-learning:model',
  wakeLearningRetrain: 'wake-learning:retrain',
  wakeLearningClear: 'wake-learning:clear',
  wakeLearningReset: 'wake-learning:reset',
  localLearningStatus: 'local-learning:status',
  localLearningEvent: 'local-learning:event',
  localLearningSnapshot: 'local-learning:snapshot',
  localLearningTrain: 'local-learning:train',
  localLearningRollback: 'local-learning:rollback',
  localLearningSetStatus: 'local-learning:set-status',
  localLearningCorrect: 'local-learning:correct',
  localLearningRestore: 'local-learning:restore',
  localLearningExportSkills: 'local-learning:export-skills',
  localLearningRemove: 'local-learning:remove',
  listeningIndicator: 'listening:indicator',
  listeningLevel: 'listening:level',
  youtubeTranscribe: 'youtube:transcribe-audio',
  youtubeTranscribeProgress: 'youtube:transcribe-progress',
  youtubeTranscribeResult: 'youtube:transcribe-result',
  updateGetState: 'update:get-state',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  updateEvent: 'update:event',
  machineStatus: 'machine:status',
  machineAnalyze: 'machine:analyze',
  machinePull: 'machine:pull',
  machinePullCancel: 'machine:pull-cancel',
  machinePullEvent: 'machine:pull-event',
  machineApply: 'machine:apply',
  questionnaireGet: 'questionnaire:get',
  questionnaireSet: 'questionnaire:set',
  questionnaireApply: 'questionnaire:apply',
  questionnaireRestore: 'questionnaire:restore',
  phoneStatus: 'phone:status',
  phoneSetEnabled: 'phone:set-enabled',
  phoneStartPairing: 'phone:start-pairing',
  phoneCancelPairing: 'phone:cancel-pairing',
  phoneRevoke: 'phone:revoke',
  phoneEvent: 'phone:event',
  speakerStatus: 'speaker:status',
  speakerSetEnabled: 'speaker:set-enabled',
  speakerAdd: 'speaker:add',
  speakerRemove: 'speaker:remove',
  speakerEvent: 'speaker:event',
  speakerTranscribeRequest: 'speaker:transcribe-request',
  speakerTranscribeResult: 'speaker:transcribe-result',
  speakerShowConversation: 'speaker:show-conversation',
} as const;

/** 5.0.64 — Enceinte Jarvis : état montré dans Réglages → Enceintes. */
export interface SpeakerStatus {
  /** Interrupteur « Enceintes Jarvis » (coupé par défaut). */
  enabled: boolean;
  /** Le pont écoute sur le port (adresses privées seulement). */
  running: boolean;
  port: number;
  /** Raison d'un démarrage raté (port pris…), sinon `null`. */
  error: string | null;
  /** Adresses IPv4 locales du PC, la plus utile d'abord. */
  addresses: string[];
  /** Nom `<pc>.local` du PC. */
  hostName: string;
  speakers: Array<{
    id: string;
    name: string;
    createdAt: number;
    /** Dernière phrase reçue (en mémoire seulement ; `null` depuis le démarrage). */
    lastTurnAt: number | null;
  }>;
}

/** Réponse de « Ajouter une enceinte » : le jeton et le bloc `secrets.h` ne sont montrés qu'ici. */
export interface SpeakerAdded {
  status: SpeakerStatus;
  speaker: { id: string; name: string };
  /** Bloc à coller dans `include/secrets.h` du programme de la carte. */
  secrets: string;
}

/** Main → renderer : afficher la discussion de l'enceinte sur l'écran du PC. */
export interface SpeakerShowConversation {
  conversationId: string;
}

/** Main → renderer : une phrase de l'enceinte à transcrire par le Whisper local. */
export interface SpeakerTranscribeRequest {
  requestId: string;
  /** PCM mono 16 kHz, amplitude [-1, 1]. */
  pcm: Float32Array;
}

/** Renderer → main : la transcription, ou l'erreur. */
export interface SpeakerTranscribeResult {
  requestId: string;
  text?: string;
  error?: string;
}

/** 5.0.63 — Jarvis sur le téléphone : état montré dans Réglages → Téléphone. */
export interface PhoneStatus {
  /** Interrupteur « Accès depuis le téléphone » (coupé par défaut). */
  enabled: boolean;
  /** Le serveur local (127.0.0.1) tourne. */
  running: boolean;
  port: number;
  /** Raison d'un démarrage raté (port pris…), sinon `null`. */
  error: string | null;
  tailscale: {
    installed: boolean;
    online: boolean;
    /** Nom du PC sur le réseau Tailscale (ex. `pc-de-dylan.tail1a2b.ts.net`). */
    dnsName: string | null;
    /** Jarvis est publié en HTTPS par `tailscale serve` ; `null` = inconnu. */
    served: boolean | null;
  };
  /** Adresse à ouvrir sur le téléphone. */
  url: string | null;
  /** Commande à taper une fois dans PowerShell. */
  serveCommand: string;
  devices: Array<{ id: string; name: string; createdAt: number }>;
  /** Code de jumelage en cours (6 chiffres, 10 minutes) et adresse du QR code. */
  pairing: { code: string; expiresAt: number; url: string | null } | null;
}

export interface MachineSetupStatus {
  /** Vrai seulement au premier lancement, tant que le profil n’est pas enregistré. */
  setupRequired: boolean;
  /** Faux si un fichier de réglages existait déjà : aucun téléchargement. */
  downloadAllowed: boolean;
}

export interface MachineAnalysis {
  detected: string;
  chosen: string;
  profile: 'modest' | 'standard' | 'full';
  chatModel: string;
  cpuOnly: boolean;
  measureFailed: boolean;
  download: {
    allowed: boolean;
    alreadyInstalled: boolean;
    ollamaPresent: boolean;
  };
}

export interface MachinePullProgress {
  status: string;
  completed: number;
  total: number;
}

export interface MachinePullResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

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
  /**
   * 5.0.62 — phrase vocale dite **sans** « Jarvis », pendant la discussion. La session vérifie
   * d'abord qu'elle lui est adressée ; sinon `not_addressed` et rien n'est enregistré.
   */
  followUp?: boolean;
  /** Module images : photos jointes (3 au plus, 20 Mo chacune), enregistrées par le processus principal. */
  attachments?: ChatAttachmentInput[];
}

/** Photo jointe telle que l'interface l'envoie (octets en base64, sans préfixe `data:`). */
export interface ChatAttachmentInput {
  name: string;
  mime: string;
  dataBase64: string;
}

export interface SpotifyStatus {
  /** Un identifiant client Spotify est renseigné dans les réglages. */
  configured: boolean;
  /** Un jeton local existe (compte connecté au moins une fois). */
  connected: boolean;
}

export type SpotifyConnectResult = { ok: true } | { ok: false; error: string };

export interface SpotifyConnectDeviceSummary {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

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

/** Robot Jarvis Rover : réponse du test de connexion des réglages. */
export interface RoverConnectionStatus {
  /** Une adresse est renseignée. */
  configured: boolean;
  /** Le service du robot a répondu (`/api/sante`). */
  reachable: boolean;
  /** Le jeton est accepté (`/api/verifier`). */
  authorized: boolean;
  /** `simulation` ou `materiel`. */
  mode?: string;
  version?: string;
  error?: string;
}

export interface RoverCredentials {
  baseUrl?: string;
  token?: string;
}

/** Module images : valeurs du formulaire pas encore enregistrées, pour « Tester Forge ». */
export interface ImagesConfigDraft {
  forgeDir?: string;
  forgeUrl?: string;
  outputRoot?: string;
}

/** Module images : état de Forge et des fichiers, pour les réglages et l'outil `images_etat`. */
export interface ImagesStatusInfo {
  enabled: boolean;
  forgeDir: string;
  forgeUrl: string;
  outputRoot: string;
  presetsPath: string;
  launcherFound: boolean;
  checkpointFound: boolean;
  vaeFound: boolean;
  forgeRunning: boolean;
  loras: string[];
  /** Jarvis Imager : modèles connus et présents, modèle actif, ADetailer installé, fichier des règles. */
  checkpoints: { id: string; label: string; file: string }[];
  activeCheckpoint: string | null;
  adetailerInstalled: boolean;
  rulesPath: string;
  error?: string;
}

/** Valeurs du formulaire Google pas encore enregistrées, pour se connecter avant « Enregistrer ». */
export interface GoogleConfigDraft {
  clientId?: string;
  clientSecret?: string;
  access?: GoogleAccessMode;
}

/** État Google vu par l'interface. Aucun jeton ne quitte le processus principal. */
export interface GoogleStatus {
  /** Un identifiant client est renseigné (réglages, brouillon ou connexion existante). */
  configured: boolean;
  /** Un compte a donné son accord et ses jetons sont sur ce PC. */
  connected: boolean;
  /** Google a retiré l'accès (7 jours en mode Test, révocation, mot de passe changé). */
  needsReconsent: boolean;
  /** Le navigateur est ouvert, Jarvis attend le retour de Google. */
  connecting: boolean;
  account: string | null;
  /** Mode réellement appliqué : le plus prudent entre les réglages et le consentement. */
  access: GoogleAccessMode | null;
  requestedAccess: GoogleAccessMode;
  services: GoogleServiceAccess[];
  /** Jetons chiffrés sur le disque (faux : mémoire seulement, chiffrement Windows indisponible). */
  persistent: boolean;
  redirectUri: string;
  /** L'identifiant client des réglages n'est pas celui qui a reçu le consentement. */
  clientMismatch: boolean;
  connectedAt: number | null;
}

export type GoogleConnectResult =
  | { ok: true; status: GoogleStatus }
  | { ok: false; error: string; status: GoogleStatus };

export interface GoogleDisconnectResult {
  revoked: boolean;
  message: string;
  status: GoogleStatus;
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
  /**
   * 5.0.60 — chef d'orchestre : l'équipe qui traite la demande et son modèle, avant la réponse.
   * `how` : calcul exact sans modèle, règle express, ou choix du cerveau. Jamais envoyé sans orchestre.
   */
  | {
      type: 'route';
      team: string;
      label: string;
      model: string;
      how: 'calcul' | 'express' | 'cerveau' | 'trieur' | 'mission-directe';
      /** Validation en direct : pastilles ✓ / Changer (seulement si réglages actifs). */
      validation?: {
        phrase: string;
        context: string;
        proposedTeam: string;
        path: 'express' | 'cerveau' | 'trieur';
        teams: { id: string; label: string }[];
      };
    }
  | {
      type: 'tool_start';
      callId: string;
      toolName: string;
      /** 5.0.64 — phrase française de l'outil (`summarize`), affichée à la place du nom technique. */
      summary?: string;
    }
  | { type: 'tool_progress'; callId: string; message: string }
  | {
      type: 'tool_result';
      callId: string;
      toolName: string;
      status: 'ok' | 'error' | 'denied';
      content: string;
    }
  | { type: 'error'; message: string }
  /**
   * 5.0.62 — la phrase de suivi ne s'adressait pas à Jarvis (conversation dans la pièce) :
   * pas de tour, pas d'historique, et la discussion vocale se ferme. Seul événement envoyé.
   */
  | { type: 'not_addressed'; text: string }
  /** 5.0.68 — mission proposée dans la discussion (carte, pas une confirmation d'outil). */
  | { type: 'mission_proposal'; message: ChatMessage; voiceHint: string }
  /** Mise à jour du bloc mission (suivi, rapport) dans un message existant. */
  | {
      type: 'mission_update';
      conversationId: string;
      messageId: string;
      envelope: ChatMissionEnvelope;
    }
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
  /** 5.0.64 — `wav` pour l'enceinte ; absent = format habituel du moteur (mp3). */
  format?: 'mp3' | 'wav';
}

export type VoiceSpeakResult =
  { ok: true; data: Uint8Array; mimeType: string } | { ok: false; error: string };

export interface VoicePiperSpeakInput {
  text: string;
  voice?: string;
  /** Une seule phrase (découpage côté renderer pour lire pendant la suite). */
  sentence?: boolean;
}

export type VoicePiperSpeakResult = VoiceSpeakResult;

export interface VoicePiperStatus {
  ready: boolean;
  benchmarkMs: number | null;
}

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

export interface TeamValidationInput {
  phrase: string;
  context: string;
  proposedTeam: string;
  chosenTeam: string;
  path: 'express' | 'cerveau' | 'trieur';
}

export interface JarvisApi {
  chat: {
    send(input: SendChatInput): Promise<void>;
    cancel(): Promise<void>;
    onEvent(listener: (event: ChatEvent) => void): () => void;
    respondConfirmation(requestId: string, approved: boolean): Promise<void>;
    launchMissionProposal(input: {
      messageId: string;
      proposalId: string;
      projectId: string;
      request: string;
    }): Promise<void>;
    declineMissionProposal(input: { messageId: string; proposalId: string }): Promise<void>;
    setMissionProposalProject(input: {
      messageId: string;
      proposalId: string;
      projectId: string;
    }): Promise<void>;
    patchMissionProposal(input: {
      messageId: string;
      proposalId: string;
      objectif: string;
    }): Promise<void>;
    openMissionFolder(input: { messageId: string; missionId: string }): Promise<void>;
    reloadConversationMissions(conversationId: string): Promise<void>;
  };
  orchestra: {
    validateTeam(input: TeamValidationInput): Promise<{ ok: true } | { ok: false; error: string }>;
  };
  images: {
    /** Ouvre dans la visionneuse une image ou un fichier du dossier des images de Jarvis (rien d'autre). */
    open(path: string): Promise<{ ok: true } | { ok: false; error: string }>;
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
    /** Liste les enceintes Spotify Connect visibles pour le compte connecté. */
    spotifyListDevices(clientId?: string): Promise<SpotifyConnectDeviceSummary[]>;
    /** Sonde l’API locale SiteBlock. Les champs optionnels testent un brouillon non encore enregistré. */
    siteBlockStatus(credentials?: SiteBlockCredentials): Promise<SiteBlockStatus>;
    /** Teste le robot (adresse puis jeton). Les champs optionnels testent un brouillon non encore enregistré. */
    roverStatus(credentials?: RoverCredentials): Promise<RoverConnectionStatus>;
    /** Module images : Forge installé, allumé, modèle SDXL présent. Le brouillon teste des valeurs pas encore enregistrées. */
    imagesStatus(draft?: ImagesConfigDraft): Promise<ImagesStatusInfo>;
    /** Propositions Open-Meteo pour le lieu « Chez moi » (sans clé). */
    geocodeSearch(query: string): Promise<GeocodingPlace[]>;
    /** État de la connexion Google. Le brouillon teste des valeurs pas encore enregistrées. */
    googleStatus(draft?: GoogleConfigDraft): Promise<GoogleStatus>;
    /** Consentement Google dans le navigateur système (PKCE, retour sur 127.0.0.1:53125). */
    googleConnect(draft?: GoogleConfigDraft): Promise<GoogleConnectResult>;
    /** Abandonne l'attente du retour de Google. */
    googleCancel(): Promise<void>;
    /** Révoque l'accès chez Google et efface les jetons de ce PC. */
    googleDisconnect(): Promise<GoogleDisconnectResult>;
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
    piperSpeak(input: VoicePiperSpeakInput): Promise<VoicePiperSpeakResult>;
    piperStatus(): Promise<VoicePiperStatus>;
    assetsReport(): Promise<VoiceAssetsReport>;
    /** Copie le détail du diagnostic dans le presse-papiers (texte seul). */
    copyReport(text: string): Promise<void>;
    /** Une ligne du journal de capture (durées, erreurs) : console du main + `logs/voice-capture.log`. */
    log(line: string): void;
    /** Ouvre Paramètres Windows > Confidentialité > Microphone. Faux hors Windows. */
    openMicrophonePrivacy(): Promise<boolean>;
    /** Début / fin de la captation d'une commande (indicateur hors fenêtre). */
    setListening(active: boolean): void;
    /** Niveau du micro (0–1) pendant la captation, pour l'indicateur. */
    sendLevel(level: number): void;
  };
  /** Apprentissage du réveil : tout reste dans le dossier de données de l'appli. */
  localLearning: {
    status(): Promise<LocalLearningRuntimeStatus>;
    onEvent(listener: (status: LocalLearningRuntimeStatus) => void): () => void;
    snapshot(): Promise<{
      records: LearningRecord[];
      metrics: LearningMetrics;
      line: string | null;
      running: boolean;
    }>;
    train(): Promise<LocalLearningRuntimeStatus>;
    rollback(): Promise<LocalLearningRuntimeStatus>;
    setStatus(id: string, status: LearningRecord['status']): Promise<LearningRecord[]>;
    correct(id: string, content: string): Promise<LearningRecord[]>;
    restore(id: string): Promise<LearningRecord[]>;
    exportSkills(): Promise<SkillTrainRow[]>;
    remove(id: string): Promise<LearningRecord[]>;
  };
  wakeLearning: {
    status(): Promise<WakeLearningStatus>;
    addSample(input: WakeLearningSampleInput): Promise<{ model: WakeVerifierModel | null; retrained: boolean } | null>;
    recordStats(kinds: WakeStatKind[]): Promise<void>;
    model(): Promise<WakeVerifierModel | null>;
    retrain(): Promise<WakeVerifierModel | null>;
    clear(): Promise<WakeLearningStatus>;
    reset(): Promise<WakeLearningStatus>;
  };
  /** Écoute YouTube : le processus principal envoie l'audio, Whisper tourne ici. */
  youtube: {
    onTranscribe(listener: (request: YoutubeTranscribeRequest) => void): () => void;
    reportProgress(payload: YoutubeTranscribeProgress): void;
    reportResult(payload: YoutubeTranscribeResult): void;
  };
  /** 5.0.63 — accès depuis le téléphone (Tailscale). */
  phone: {
    status(): Promise<PhoneStatus>;
    setEnabled(enabled: boolean): Promise<PhoneStatus>;
    startPairing(): Promise<PhoneStatus>;
    cancelPairing(): Promise<PhoneStatus>;
    revoke(deviceId: string): Promise<PhoneStatus>;
    /** Appareil relié depuis le téléphone pendant que les réglages sont ouverts. */
    onEvent(listener: (status: PhoneStatus) => void): () => void;
  };
  /** 5.0.64 — enceintes Jarvis (ESP32-S3 sur le Wi-Fi local). */
  speaker: {
    status(): Promise<SpeakerStatus>;
    setEnabled(enabled: boolean): Promise<SpeakerStatus>;
    /** Crée une enceinte et rend, une seule fois, le bloc `secrets.h` avec son jeton. */
    add(name: string): Promise<SpeakerAdded>;
    remove(speakerId: string): Promise<SpeakerStatus>;
    /** Phrase reçue d'une enceinte pendant que les réglages sont ouverts. */
    onEvent(listener: (status: SpeakerStatus) => void): () => void;
    /** Le processus principal demande une transcription Whisper (la fenêtre a Whisper, pas lui). */
    onTranscribe(listener: (request: SpeakerTranscribeRequest) => void): () => void;
    reportTranscript(payload: SpeakerTranscribeResult): void;
    /** La discussion de l'enceinte a quelque chose à montrer. */
    onShow(listener: (event: SpeakerShowConversation) => void): () => void;
  };
  update: {
    getState(): Promise<UpdateState>;
    /** Vérification manuelle (bouton des réglages). Ne rejette jamais : l'état d'erreur passe par l'événement. */
    check(): Promise<void>;
    /** Redémarre l'application et installe la mise à jour déjà téléchargée. */
    install(): Promise<void>;
    onEvent(listener: (state: UpdateState) => void): () => void;
  };
  /** Jarvis Développeur (voir `developerIpc.ts`) : refusé tant que le mode est coupé. */
  developer: DeveloperApi;
  /** Premier lancement : mesure de la machine, puis profil. Aucun téléchargement si des réglages existent déjà. */
  machine: {
    status(): Promise<MachineSetupStatus>;
    analyze(): Promise<MachineAnalysis>;
    pull(): Promise<MachinePullResult>;
    cancelPull(): Promise<void>;
    apply(): Promise<{ settings: Settings; status: RuntimeStatus }>;
    onPull(listener: (progress: MachinePullProgress) => void): () => void;
  };
  /** Questionnaire d’accueil 5.0.70 (`userData/questionnaire.json`). */
  questionnaire: {
    get(): Promise<QuestionnaireState>;
    set(patch: Partial<QuestionnaireState>): Promise<QuestionnaireState>;
    apply(): Promise<{ state: QuestionnaireState; settings: Settings; status: RuntimeStatus }>;
    restore(): Promise<{ state: QuestionnaireState; settings: Settings | null; status: RuntimeStatus }>;
  };
}
