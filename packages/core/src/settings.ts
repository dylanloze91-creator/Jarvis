import { z } from 'zod';
import { DEFAULT_SYSTEM_PROMPT } from './agent/agent.js';
import { FIX_ATTEMPTS_MAX, FIX_ATTEMPTS_MIN } from './developer/taskPlan.js';
import { SPECIALIST_ROLES } from './developer/engine/roles.js';
import { DEFAULT_SITEBLOCK_BASE_URL } from './siteblock/url.js';
import { defaultCategoryPolicies } from './tools/permissions.js';

const confirmationPolicySchema = z.enum(['always', 'destructive-only', 'never']);

/**
 * Politique de confirmation par catégorie d'outils. `shell` y figure pour que
 * le schéma reste homogène, mais elle n'a aucun effet : `run_command` est
 * incompressible (voir `ToolDefinition.forceConfirm`) et l'interface ne
 * propose pas de la modifier.
 */
export const toolPoliciesSchema = z
  .object({
    apps: confirmationPolicySchema.default(defaultCategoryPolicies.apps),
    files: confirmationPolicySchema.default(defaultCategoryPolicies.files),
    capture: confirmationPolicySchema.default(defaultCategoryPolicies.capture),
    shell: confirmationPolicySchema.default(defaultCategoryPolicies.shell),
  })
  .default(defaultCategoryPolicies);

/** Réglages de la commande vocale : écoute permanente, mot de réveil, voix. */
export const voiceSettingsSchema = z.object({
  /** Écoute permanente en arrière-plan, avec détection locale du mot de réveil. */
  enabled: z.boolean().default(false),
  wakeWord: z.string().min(1).default('jarvis'),
  /**
   * Gabarits d'énergie du déclencheur « Jarvis » nu, qui tourne à côté
   * d'openWakeWord (modèle « hey jarvis ») et que Whisper confirme. Micro
   * ou import WAV/MP3. L'audio brut n'est jamais conservé.
   */
  wakeWordProfiles: z.array(z.array(z.number())).default([]),
  /** `best` compare au gabarit le plus proche, `average` à leur moyenne. */
  wakeWordMatchStrategy: z.enum(['best', 'average']).default('best'),
  /** 0 (strict, peu de faux positifs) à 1 (très sensible). */
  wakeWordSensitivity: z.number().min(0).max(1).default(0.7),
  /**
   * Variantes orthographiques supplémentaires du mot de réveil, en plus des
   * variantes intégrées — utilisées par la confirmation Whisper. Éditable
   * dans les réglages.
   */
  wakeWordVariants: z.array(z.string()).default([]),
  /**
   * Apprentissage du réveil (opt-in) : courts extraits gardés dans le
   * dossier de données de l'appli, vérificateur personnel entraîné sur ce
   * PC. Coupé = détection exactement comme en 0.4.16.
   */
  wakeLearning: z.boolean().default(false),
  /** Identifiant du périphérique micro choisi ; vide = périphérique par défaut du système. */
  microphoneId: z.string().default(''),
  /**
   * Moteur de reconnaissance vocale : identifiant enregistré dans le
   * registre STT. `local-whisper` (Whisper local, gratuit et hors ligne
   * après le premier téléchargement) est le défaut — la reconnaissance
   * intégrée du navigateur (`browser-local`) est structurellement cassée
   * dans Electron (dépend de serveurs Google absents des builds Electron)
   * et n'est plus proposée.
   */
  sttProvider: z.string().min(1).default('local-whisper'),
  /** Moteur de synthèse vocale : identifiant enregistré dans le registre TTS. */
  ttsProvider: z.string().min(1).default('browser-local'),
  /** Réponse vocale de l'assistant, activable indépendamment de l'écoute permanente. */
  ttsEnabled: z.boolean().default(true),
  /** Identifiant de la voix choisie pour le moteur de synthèse actif. */
  ttsVoice: z.string().default(''),
  /**
   * Clé API OpenAI dédiée à la voix. Laissée vide, elle réutilise la clé du
   * fournisseur de modèle si celui-ci est déjà OpenAI.
   */
  apiKey: z.string().default(''),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

/** Apprentissage local (exemples + adaptateur QLoRA sur ce PC, sans cloud). */
export const localLearningSettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Modèle Ollama à utiliser pour le chat quand l’adaptateur est prêt. */
    activeOllamaModel: z.string().optional(),
    trainBaseModel: z.string().optional(),
    lastTrainedAt: z.number().optional(),
    lastTrainExampleCount: z.number().int().optional(),
    /** Précision affichée une ligne dans la discussion après entraînement. */
    statusHint: z.string().max(240).optional(),
    /** Venv + torch/peft/trl prêts sous userData (installés automatiquement). */
    pythonDepsReady: z.boolean().optional(),
  })
  .default({ enabled: true });

export type LocalLearningSettings = z.infer<typeof localLearningSettingsSchema>;

/**
 * Jarvis Développeur. Coupé par défaut : tant qu'il l'est, aucune session
 * développeur n'existe et le chat reste celui de 0.4.22.
 */
export const developerSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Copie de travail Git de Jarvis (vide = pas encore choisie ; `C:\dev\Jarvis` est proposé). */
  repoPath: z.string().max(400).default(''),
  /** Modèle de code choisi après le banc (vide = pas encore choisi). Jamais utilisé par le chat. */
  codeModel: z.string().max(200).default(''),
  /** Dossier des copies isolées (vide = à côté de la copie de travail : `<copie>-taches`). */
  worktreeRoot: z.string().max(400).default(''),
  /**
   * Corrections tentées après un échec de tests. Absent : 3. Pas de défaut
   * Zod : un bloc developer déjà enregistré ne gagne pas de clé.
   */
  maxFixAttempts: z.number().int().min(FIX_ATTEMPTS_MIN).max(FIX_ATTEMPTS_MAX).optional(),
  /**
   * Modèle choisi par l'utilisateur pour un rôle, après le banc réel. Rôle
   * absent : le modèle de code. Jamais rempli par Jarvis ; pas de défaut Zod.
   */
  roleModels: z.partialRecord(z.enum(SPECIALIST_ROLES), z.string().max(200)).optional(),
  /** Dossier des nouveaux projets (absent ou vide : `C:\dev\Projets` sous Windows, décision D2). */
  projectsRoot: z.string().max(400).optional(),
  /**
   * Manuel technique local injecté dans les prompts Codeur (absent : activé).
   * Mettre à `false` pour couper la récupération de passages.
   */
  knowledgeManual: z.boolean().optional(),
  /**
   * Mémoriser une fiche « solution validée » après mission réussie (absent : activé).
   */
  knowledgeLearning: z.boolean().optional(),
});

export type DeveloperSettings = z.infer<typeof developerSettingsSchema>;

export const settingsSchema = z.object({
  provider: z.string().min(1).default('mock'),
  model: z.string().min(1).default('jarvis-demo'),
  apiKey: z.string().default(''),
  /** Laisser vide pour l'URL officielle du provider. */
  baseUrl: z.string().default(''),
  hotkey: z.string().min(1).default('Control+Space'),
  systemPrompt: z.string().default(DEFAULT_SYSTEM_PROMPT),
  temperature: z.number().min(0).max(2).default(0.4),
  /**
   * Modèle utilisé si le modèle choisi n'est pas disponible. Le défaut
   * reste `qwen2.5:3b` : `qwen3.5:4b` est recommandé, mais l'appel d'outils
   * sur une RTX 2060 6 Go n'est pas encore vérifié.
   */
  fallbackModel: z.string().min(1).default('qwen2.5:3b'),
  /** Journal technique. Les secrets restent masqués même quand il est actif. */
  debugLogging: z.boolean().default(false),
  /** Fournisseur utilisé par l'outil `web_search`. Google HTML sans clé par défaut. */
  searchProvider: z.string().min(1).default('google'),
  /** Clé optionnelle, requise seulement par certains fournisseurs (ex. Brave Search). */
  searchApiKey: z.string().default(''),
  /** Fournisseur utilisé par l'outil `get_stock_quote`. */
  marketDataProvider: z.string().min(1).default('yahoo-finance'),
  /** Clé optionnelle, requise seulement par certains fournisseurs (ex. Finnhub). */
  marketDataApiKey: z.string().default(''),
  /**
   * Identifiant client (« Client ID ») de l'application Spotify for
   * Developers, utilisé par les outils `spotify_*`. Volontairement pas une
   * variable d'environnement : une application Windows installée n'a pas de
   * shell pour la définir. Comme les autres clés, elle vit uniquement dans
   * `settings.json`, sur la machine de l'utilisateur. Il n'y a pas de Client
   * Secret : l'authentification utilise PKCE, conçu pour ne jamais en avoir
   * besoin côté application desktop/mobile.
   */
  spotifyClientId: z.string().default(''),
  /**
   * Identifiant client OAuth Google (type « Application de bureau ») de
   * l'utilisateur, pour Gmail, Agenda, Drive, Docs et Sheets. Comme
   * Spotify : dans `settings.json`, jamais une variable d'environnement.
   * Vide = Google absent du catalogue d'outils.
   */
  googleClientId: z.string().default(''),
  /**
   * Secret du client « Application de bureau ». Google le délivre une seule
   * fois à la création et l'exige encore à l'échange du code PKCE. Il n'est
   * envoyé qu'à `oauth2.googleapis.com`. Les jetons, eux, sont chiffrés à
   * part (`safeStorage`), jamais dans ce fichier.
   */
  googleClientSecret: z.string().default(''),
  /** `readonly` : seules les autorisations de lecture sont demandées, les outils d'écriture disparaissent. */
  googleAccess: z.enum(['full', 'readonly']).default('full'),
  /**
   * URL loopback de l'API locale SiteBlock. Pas une variable
   * d'environnement : comme Spotify, elle vit dans `settings.json`.
   * Défaut : `http://127.0.0.1:18741`. Seules les adresses locales
   * (127.0.0.1 / localhost / ::1) sont acceptées par le pont.
   */
  siteBlockBaseUrl: z.string().default(DEFAULT_SITEBLOCK_BASE_URL),
  /**
   * Jeton Bearer de l'API ControlApi de SiteBlock. Secret local, jamais
   * une variable d'environnement. Laissé vide, Jarvis tente de le lire
   * dans `%APPDATA%\\SiteBlock\\api.json` si SiteBlock tourne.
   */
  siteBlockToken: z.string().default(''),
  /**
   * Garder la fenêtre visible quand une autre application prend le focus.
   * Masquage uniquement via Ctrl+Espace, Échap, ou le bouton fermer.
   * Remplace l'ancien `hideOnBlur` (défaut true) : la clé historique est
   * ignorée pour que les installations 0.4.0 passent au nouveau défaut.
   */
  stayVisibleOnBlur: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  /** Politique de confirmation par catégorie d'outils. Voir `packages/core/src/tools/permissions.ts`. */
  toolPolicies: toolPoliciesSchema,
  voice: voiceSettingsSchema.default(voiceSettingsSchema.parse({})),
  developer: developerSettingsSchema.default(developerSettingsSchema.parse({})),
  localLearning: localLearningSettingsSchema,
  /**
   * Analyse vidéo (YouTube, mémoire vidéo). Absente : comme en 0.4.25, activée.
   * Seul `false` (profil modeste) la coupe. Pas de défaut Zod : un ancien
   * `settings.json` relu ne gagne pas de clé.
   */
  videoAnalysis: z.boolean().optional(),
  /**
   * Fenêtre de contexte du chat Ollama. Absente : 8192, comme en 0.4.25.
   * Le profil modeste enregistre 4096.
   */
  ollamaNumCtx: z.number().int().min(512).max(32768).optional(),
  /**
   * Profil matériel enregistré au premier lancement. Absent : installation
   * déjà configurée, le comportement reste celui d’avant ce réglage.
   */
  machine: z
    .object({
      profile: z.enum(['modest', 'standard', 'full']),
      cpuOnly: z.boolean(),
      measureFailed: z.boolean(),
      detected: z.string().max(500),
      chosen: z.string().max(500),
    })
    .optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});

/**
 * Un champ invalide (modèle vidé, raccourci effacé…) ne doit jamais faire
 * perdre le reste de la configuration, clés API comprises : seul ce champ
 * reprend la valeur de `fallback` (les réglages précédents lors d'un
 * enregistrement, les défauts à la lecture du disque).
 */
export function parseSettings(input: unknown, fallback: Settings = defaultSettings): Settings {
  const result = settingsSchema.safeParse(input ?? {});
  if (result.success) return result.data;
  if (!isRecord(input)) return fallback;

  let candidate: Record<string, unknown> = { ...input };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const retry = settingsSchema.safeParse(candidate);
    if (retry.success) return retry.data;
    const repaired = replaceInvalidFields(candidate, retry.error.issues, fallback);
    if (!repaired) break;
    candidate = repaired;
  }
  return fallback;
}

function replaceInvalidFields(
  value: Record<string, unknown>,
  issues: z.core.$ZodIssue[],
  fallback: Settings,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...value };
  const defaults = fallback as unknown as Record<string, unknown>;
  for (const issue of issues) {
    const [top, nested] = issue.path;
    if (typeof top !== 'string') return null;
    const child = next[top];
    const fallbackChild = defaults[top];
    if (typeof nested === 'string' && isRecord(child) && isRecord(fallbackChild)) {
      next[top] = { ...child, [nested]: fallbackChild[nested] };
    } else {
      next[top] = fallbackChild;
    }
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
