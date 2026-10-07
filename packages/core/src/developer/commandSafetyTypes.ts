/**
 * Tri de sécurité des commandes de Jarvis Développeur. Quatre classes :
 * - `auto` : liste fixe de tests / lint / vérification des types, seulement
 *   dans la copie isolée (bac à sable) et sous leur forme exacte ;
 * - `confirm` : commande reconnue, effet limité, à confirmer ;
 * - `always-confirm` : toujours confirmée, jamais assouplie ;
 * - `denied` : jamais exécutée (publication, destruction, système, secrets…).
 */
export type CommandSafetyLevel = 'auto' | 'confirm' | 'always-confirm' | 'denied';

export interface CommandSafetyContext {
  /** La commande tourne dans une copie isolée `jarvis-dev/*`, jamais dans la copie de l'utilisateur. */
  insideSandbox?: boolean;
  /** Branche courante de cette copie. */
  branch?: string | null;
  /** Scripts du package.json, pour vérifier ce que lance `npm run <script>`. */
  packageScripts?: Record<string, string>;
  /** Accord explicite dans le chat projet (moteur graphique). */
  graphicsEngineGranted?: boolean;
}

export interface CommandClassification {
  command: string;
  level: CommandSafetyLevel;
  label: string;
  /** Raisons en français, la plus grave d'abord. */
  reasons: string[];
  runsWithoutAsking: boolean;
}

export interface Finding {
  level: CommandSafetyLevel;
  reason: string;
}

export interface SegmentContext extends CommandSafetyContext {
  /** Aucune variable, guillemet, redirection, échappement ni enchaînement. */
  plain: boolean;
  /** Une seule commande simple (condition des exceptions `jarvis-dev/*`). */
  single: boolean;
  /** Classe une commande imbriquée (`cmd /c "…"`, script npm…). */
  recurse(command: string, overrides?: Partial<CommandSafetyContext>): Finding[];
}

export const LEVEL_RANK: Record<CommandSafetyLevel, number> = {
  auto: 0,
  confirm: 1,
  'always-confirm': 2,
  denied: 3,
};

export const SAFETY_LABELS: Record<CommandSafetyLevel, string> = {
  auto: 'Automatique (bac à sable)',
  confirm: 'À confirmer',
  'always-confirm': 'Toujours à confirmer',
  denied: 'Refusée',
};

export function finding(level: CommandSafetyLevel, reason: string): Finding {
  return { level, reason };
}

export function maxLevel(findings: Finding[]): CommandSafetyLevel {
  let level: CommandSafetyLevel = 'auto';
  for (const item of findings) if (LEVEL_RANK[item.level] > LEVEL_RANK[level]) level = item.level;
  return level;
}

/** Chemin relatif sûr : pas absolu, pas de lecteur, pas de `..`, caractères simples. */
export const SAFE_RELATIVE_PATH = /^(?![\\/])(?![a-z]:)(?!.*\.\.)[\w@./\\-]+$/i;

export function isSafeRelativePath(value: string): boolean {
  return SAFE_RELATIVE_PATH.test(value) && !value.startsWith('-');
}
