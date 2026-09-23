import type {
  CategoryPolicies,
  ConfirmationPolicy,
  RegisteredTool,
  ToolCategory,
} from './types.js';

/**
 * Politique par défaut : toute action `confirm` demande une confirmation
 * systématique, jusqu'à ce que l'utilisateur l'assouplisse explicitement dans
 * les réglages. C'est le comportement historique de l'application.
 */
export const defaultCategoryPolicies: CategoryPolicies = {
  apps: 'always',
  files: 'always',
  capture: 'always',
  shell: 'always',
};

export const categoryLabels: Record<ToolCategory, string> = {
  apps: 'Applications (ouvrir, fermer)',
  files: 'Fichiers (déplacer, copier, supprimer)',
  capture: "Capture d'écran",
  shell: 'Commandes système',
};

export const policyLabels: Record<ConfirmationPolicy, string> = {
  always: 'Toujours confirmer',
  'destructive-only': 'Confirmer seulement les actions destructrices',
  never: 'Ne jamais confirmer',
};

/**
 * Catégories que l'utilisateur peut assouplir dans les réglages. `shell` en
 * est volontairement absente : `run_command` est incompressible (voir
 * `forceConfirm`), la politique de sa catégorie n'a donc aucun effet et ne
 * doit pas être présentée comme réglable.
 */
export const CONFIGURABLE_CATEGORIES: ToolCategory[] = ['apps', 'files', 'capture'];

/**
 * Cœur de la politique de permissions : décide si un appel d'outil donné doit
 * être soumis à confirmation.
 *
 * Ordre des règles, du plus fort au plus faible :
 * 1. Un outil `safe` ou `denied` n'entre jamais dans ce calcul (traité en amont).
 * 2. `forceConfirm` est incompressible : toujours vrai, quelle que soit la politique.
 * 3. Sans catégorie déclarée, on retombe sur le comportement le plus prudent (toujours confirmer).
 * 4. Sinon, la politique de la catégorie tranche : `always` / `never` / ou le
 *    caractère destructeur de l'appel pour `destructive-only`.
 */
export function requiresConfirmation(
  tool: RegisteredTool,
  input: unknown,
  policies: CategoryPolicies = defaultCategoryPolicies,
): boolean {
  if (tool.forceConfirm) return true;
  if (!tool.category) return true;

  const policy = policies[tool.category] ?? 'always';
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  return tool.isDestructive(input);
}

export function parseCategoryPolicies(input: unknown): CategoryPolicies {
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const result = { ...defaultCategoryPolicies };
  for (const category of Object.keys(result) as ToolCategory[]) {
    const value = record[category];
    if (value === 'always' || value === 'destructive-only' || value === 'never') {
      result[category] = value;
    }
  }
  return result;
}
