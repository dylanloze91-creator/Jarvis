import type { z } from 'zod';

/**
 * Niveau de risque déclaré par chaque outil.
 * - `safe`    : lecture seule, exécuté sans interruption.
 * - `confirm` : modifie le système, exige un accord explicite de l'utilisateur
 *               (sauf si la politique de permissions de sa catégorie l'assouplit).
 * - `denied`  : enregistré mais désactivé, jamais exposé au modèle.
 */
export type RiskLevel = 'safe' | 'confirm' | 'denied';

/**
 * Regroupement des outils `confirm` pour la politique de permissions
 * configurable par l'utilisateur. Les outils `safe` et `denied` n'ont pas de
 * catégorie : leur traitement ne dépend jamais des réglages.
 */
export type ToolCategory = 'apps' | 'files' | 'capture' | 'shell';

export const TOOL_CATEGORIES: ToolCategory[] = ['apps', 'files', 'capture', 'shell'];

export interface ConfirmationRequest {
  callId: string;
  toolName: string;
  title: string;
  details: string;
  /**
   * Représentation exacte de l'action à exécuter (commande shell, chemin
   * ciblé…), affichée telle quelle dans la fenêtre de confirmation. Obligatoire
   * pour `run_command` : l'utilisateur doit voir la commande exacte avant de
   * l'autoriser.
   */
  command?: string;
  /** Vrai si la fenêtre de confirmation doit être signalée comme incompressible. */
  forced?: boolean;
}

export interface ToolContext {
  requestConfirmation(request: ConfirmationRequest): Promise<boolean>;
  /** Politique de permissions courante. Absente = comportement le plus prudent (toujours confirmer). */
  policies?: CategoryPolicies;
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
  /** Requis pour les outils `confirm` : catégorie utilisée par la politique de permissions. */
  category?: ToolCategory;
  /**
   * Incompressible : cet outil demande toujours confirmation, quelle que soit
   * la politique choisie par l'utilisateur pour sa catégorie. Réservé à la
   * suppression, l'élévation administrateur et l'exécution de commande
   * arbitraire.
   */
  forceConfirm?: boolean;
  /**
   * Cet appel est-il destructeur ? Statique, ou dépendant des arguments (par
   * exemple `close_application` n'est destructeur que si `forceKill` est
   * demandé). Utilisé par la politique « confirmation seulement pour les
   * actions destructrices ».
   */
  isDestructive?: boolean | ((input: z.infer<S>) => boolean);
  schema: S;
  /** Phrase affichée dans la fenêtre de confirmation avant exécution. */
  summarize?: (input: z.infer<S>) => string;
  /**
   * Représentation exacte de la commande/action, affichée dans la fenêtre de
   * confirmation en plus du résumé (voir `ConfirmationRequest.command`).
   */
  describeCommand?: (input: z.infer<S>) => string;
  execute: (input: z.infer<S>, context: ToolContext) => Promise<ToolResult>;
}

/** Version sans générique, manipulable de façon homogène par le registre. */
export interface RegisteredTool {
  name: string;
  description: string;
  risk: RiskLevel;
  category?: ToolCategory;
  forceConfirm: boolean;
  isDestructive: (input: unknown) => boolean;
  jsonSchema: Record<string, unknown>;
  summarize: (input: unknown) => string;
  describeCommand: (input: unknown) => string | undefined;
  run: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}

/** Politique de confirmation choisie par l'utilisateur pour une catégorie d'outils. */
export type ConfirmationPolicy = 'always' | 'destructive-only' | 'never';

export type CategoryPolicies = Record<ToolCategory, ConfirmationPolicy>;
