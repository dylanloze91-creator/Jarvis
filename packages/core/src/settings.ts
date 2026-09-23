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
export const voiceSettingsSchema = z.object({
  /** Écoute permanente en arrière-plan, avec détection locale du mot de réveil. */
  enabled: z.boolean().default(false),
  wakeWord: z.string().min(1).default('jarvis'),
  /**
   * Gabarits d'énergie du mot de réveil, capturés localement (plusieurs
   * échantillons possibles, tableau vide = pas encore entraîné).
   */
  wakeWordProfiles: z.array(z.array(z.number())).default([]),
  /** `best` compare au gabarit le plus proche, `average` à leur moyenne. */
  wakeWordMatchStrategy: z.enum(['best', 'average']).default('best'),
  /** 0 (strict, peu de faux positifs) à 1 (très sensible). */
  wakeWordSensitivity: z.number().min(0).max(1).default(0.5),
  /** Moteur de détection du mot de réveil : identifiant enregistré dans le registre dédié. */
  wakeWordEngine: z.string().min(1).default('local-template'),
  /**
   * Clé d'accès Picovoice (Porcupine), optionnelle. Sa présence sélectionne
   * automatiquement Porcupine ; vide, l'application reste sur le gabarit
   * local. Voir le README pour le coût réel de cette clé.
   */
  wakeWordAccessKey: z.string().default(''),
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

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

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
