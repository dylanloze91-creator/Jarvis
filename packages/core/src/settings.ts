import { z } from 'zod';
import { DEFAULT_SYSTEM_PROMPT } from './agent/agent.js';

/** Réglages de la commande vocale : écoute permanente, mot de réveil, voix. */
export const voiceSettingsSchema = z.object({
  /** Écoute permanente en arrière-plan, avec détection locale du mot de réveil. */
  enabled: z.boolean().default(false),
  wakeWord: z.string().min(1).default('jarvis'),
  /** Gabarit d'énergie du mot de réveil, capturé localement (vide = pas encore entraîné). */
  wakeWordProfile: z.array(z.number()).default([]),
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
  /** Masquer la fenêtre dès qu'elle perd le focus, à la manière d'un lanceur. */
  hideOnBlur: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  voice: voiceSettingsSchema.default(voiceSettingsSchema.parse({})),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});

export function parseSettings(input: unknown): Settings {
  const result = settingsSchema.safeParse(input ?? {});
  return result.success ? result.data : defaultSettings;
}
