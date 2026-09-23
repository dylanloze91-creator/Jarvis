import type { z } from 'zod';

/**
 * Niveau de risque déclaré par chaque outil.
 * - `safe`    : lecture seule, exécuté sans interruption.
 * - `confirm` : modifie le système, exige un accord explicite de l'utilisateur.
 * - `denied`  : enregistré mais désactivé, jamais exposé au modèle.
 */
export type RiskLevel = 'safe' | 'confirm' | 'denied';

export interface ConfirmationRequest {
  callId: string;
  toolName: string;
  title: string;
  details: string;
}

export interface ToolContext {
  requestConfirmation(request: ConfirmationRequest): Promise<boolean>;
  signal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Texte renvoyé au modèle. */
  content: string;
  /** Charge utile structurée, exploitable par l'interface. */
  data?: unknown;
}

export interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  risk: RiskLevel;
  schema: S;
  /** Phrase affichée dans la fenêtre de confirmation avant exécution. */
  summarize?: (input: z.infer<S>) => string;
  execute: (input: z.infer<S>, context: ToolContext) => Promise<ToolResult>;
}

/** Version sans générique, manipulable de façon homogène par le registre. */
export interface RegisteredTool {
  name: string;
  description: string;
  risk: RiskLevel;
  jsonSchema: Record<string, unknown>;
  summarize: (input: unknown) => string;
  run: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}
