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
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = settingsSchema.parse({});

export function parseSettings(input: unknown): Settings {
  const result = settingsSchema.safeParse(input ?? {});
  return result.success ? result.data : defaultSettings;
}
