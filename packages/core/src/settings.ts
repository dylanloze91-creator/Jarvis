import { z } from 'zod';
import { DEFAULT_SYSTEM_PROMPT } from './agent/agent.js';
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
const voiceSettingsShape = z.object({
  /** Écoute permanente en arrière-plan, avec détection locale du mot de réveil. */
  enabled: z.boolean().default(false),
  wakeWord: z.string().min(1).default('jarvis'),
  /**
   * Un gabarit d'énergie par échantillon enregistré localement (vide = pas
   * encore calibré). Plusieurs prononciations rendent la détection nettement
   * plus tolérante aux variations de voix.
   */
  wakeWordProfiles: z.array(z.array(z.number())).default([]),
  /** Sensibilité de la détection, de 0 (très strict) à 1 (très permissif). */
  wakeWordSensitivity: z.number().min(0).max(1).default(0.5),
  /** Identifiant du périphérique micro choisi ; vide = périphérique par défaut du système. */
  microphoneId: z.string().default(''),
  /** Moteur de reconnaissance vocale : identifiant enregistré dans le registre STT. */
  sttProvider: z.string().min(1).default('browser-local'),
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

/**
 * Les premières versions ne gardaient qu'un seul gabarit, sous la clé
 * `wakeWordProfile`. On le reprend comme premier échantillon plutôt que de
 * faire perdre sa calibration à l'utilisateur.
 */
export const voiceSettingsSchema = z.preprocess((input) => {
  if (typeof input !== 'object' || input === null) return input;
  const record = input as Record<string, unknown>;
  const legacy = record.wakeWordProfile;
  if (!Array.isArray(legacy) || legacy.length === 0 || record.wakeWordProfiles) return record;
  const { wakeWordProfile: _legacy, ...rest } = record;
  return { ...rest, wakeWordProfiles: [legacy] };
}, voiceSettingsShape);

export type VoiceSettings = z.infer<typeof voiceSettingsShape>;

export const settingsSchema = z.object({
  provider: z.string().min(1).default('mock'),
  model: z.string().min(1).default('jarvis-demo'),
  apiKey: z.string().default(''),
  /** Laisser vide pour l'URL officielle du provider. */
  baseUrl: z.string().default(''),
  hotkey: z.string().min(1).default('Control+Space'),
  systemPrompt: z.string().default(DEFAULT_SYSTEM_PROMPT),
  temperature: z.number().min(0).max(2).default(0.4),
  /** Fournisseur utilisé par l'outil `web_search`. */
  searchProvider: z.string().min(1).default('wikipedia'),
  /** Clé optionnelle, requise seulement par certains fournisseurs (ex. Brave Search). */
  searchApiKey: z.string().default(''),
  /** Fournisseur utilisé par l'outil `get_stock_quote`. */
  marketDataProvider: z.string().min(1).default('yahoo-finance'),
  /** Clé optionnelle, requise seulement par certains fournisseurs (ex. Finnhub). */
  marketDataApiKey: z.string().default(''),
  /** Masquer la fenêtre dès qu'elle perd le focus, à la manière d'un lanceur. */
  hideOnBlur: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  /** Politique de confirmation par catégorie d'outils. Voir `packages/core/src/tools/permissions.ts`. */
  toolPolicies: toolPoliciesSchema,
  voice: voiceSettingsSchema.default(voiceSettingsSchema.parse({})),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});

export function parseSettings(input: unknown): Settings {
  const result = settingsSchema.safeParse(input ?? {});
  return result.success ? result.data : defaultSettings;
}
