import { CodeModelFormatError, extractJson } from './codeSchemas.js';
import { normalizePlan, rawPlanSchema, suiteSetOf, type TaskPlan } from './taskPlan.js';
import type { ReviewedPlan } from './taskPolicy.js';
import type { ProjectProfile } from './engine/projectProfile.js';
import { JARVIS_PROJECT_PROFILE } from './engine/profiles/jarvis.js';

/**
 * Consignes du modèle de code pour une tâche. Indépendantes du modèle :
 * appels d'outils natifs d'Ollama, plan en JSON validé par Zod. Sans profil,
 * celles de Jarvis (figées par `jarvis.test.ts`).
 */
export const PLAN_MARKER = 'ÉTAPE : PLAN';
export const EDIT_MARKER = 'ÉTAPE : MODIFICATION';
export const FIX_MARKER = 'ÉTAPE : CORRECTION';

export function planSystemPrompt(project: ProjectProfile = JARVIS_PROJECT_PROFILE): string {
  const { ids, defaults } = suiteSetOf(project);
  const suites = ids.map((id) => `"${id}" (${project.testSuites[id]!.label})`).join(', ');
  const example = defaults.map((id) => `"${id}"`).join(', ');
  return `Tu es Jarvis Développeur. ${PLAN_MARKER}.
${project.promptContext}
Tu prépares un plan de modification. Tu ne modifies rien à cette étape.
Utilise les outils de lecture (dev_search_files, dev_search_code, dev_read_file) pour trouver les vrais fichiers, en peu d'appels.
Termine par un seul bloc JSON, sans autre texte après :
{"resume": "ce qui va changer", "criteres": ["comment on saura que c'est réussi"], "fichiers": [{"chemin": "chemin/relatif.ts", "action": "creer|modifier|supprimer", "pourquoi": "..."}], "tests": [${example}]}
Tests possibles : ${suites}.
Liste tous les fichiers à créer ou modifier, tests compris. Garde le plan petit.`;
}

export function planPrompt(request: string): string {
  return `Demande de l'utilisateur :\n${request.trim()}`;
}

/** Plan extrait de la réponse ; lève CodeModelFormatError avec un message à renvoyer au modèle. */
export function parsePlanReply(
  text: string,
  project: ProjectProfile = JARVIS_PROJECT_PROFILE,
): TaskPlan {
  const raw = extractJson(text);
  const parsed = rawPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CodeModelFormatError(
      `Plan invalide : ${parsed.error.issues.map((i) => i.message).join(' ; ')}`,
      text,
    );
  }
  return normalizePlan(parsed.data, suiteSetOf(project));
}

function planBlock(plan: ReviewedPlan): string {
  const files = plan.files
    .map(
      (f) =>
        `- ${f.action === 'create' ? 'créer' : f.action === 'delete' ? 'supprimer' : 'modifier'} ${f.path}${f.reason ? ` : ${f.reason}` : ''}`,
    )
    .join('\n');
  return `Plan validé par l'utilisateur :
${plan.summary}
Fichiers :
${files}
Critères : ${plan.criteria.join(' ; ') || '—'}`;
}

const EDIT_RULES = `Règles :
- Modifie seulement les fichiers du plan. Un autre fichier demandera l'accord de l'utilisateur.
- Lis un fichier (dev_read_file) avant de le modifier.
- dev_edit_file remplace un extrait EXACT et UNIQUE du fichier (copie-le tel quel, avec l'indentation) ; préfère plusieurs petits remplacements à un gros.
- dev_create_file pour un nouveau fichier seulement.
- Ne supprime rien sans raison : dev_delete_file demande toujours l'accord.
- Jamais de secret, jamais de réseau, jamais de lancement de processus sans nécessité.
Quand tout est fait, réponds par un court résumé, sans appel d'outil.`;

export function editSystemPrompt(
  plan: ReviewedPlan,
  project: ProjectProfile = JARVIS_PROJECT_PROFILE,
): string {
  return `Tu es Jarvis Développeur. ${EDIT_MARKER}.
${project.promptContext}
Tu travailles dans une copie isolée du dépôt, sur une branche jarvis-dev/*.
${planBlock(plan)}
${EDIT_RULES}`;
}

export function editPrompt(request: string): string {
  return `Fais les modifications du plan pour cette demande :\n${request.trim()}`;
}

export function fixSystemPrompt(
  plan: ReviewedPlan,
  attempt: number,
  max: number,
  project: ProjectProfile = JARVIS_PROJECT_PROFILE,
): string {
  return `Tu es Jarvis Développeur. ${FIX_MARKER} (essai ${attempt} sur ${max}).
${project.promptContext}
Tes modifications ont fait échouer des tests. Corrige-les dans la copie isolée.
${planBlock(plan)}
${EDIT_RULES}`;
}

export function fixPrompt(newFailures: string[], excerpts: string[]): string {
  return `Nouveaux échecs (absents avant la tâche) :
${newFailures
  .slice(0, 20)
  .map((f) => `- ${f}`)
  .join('\n')}

Extraits des sorties :
${excerpts.join('\n---\n').slice(0, 6000)}

Lis les fichiers concernés, puis corrige seulement ce qui est nécessaire.`;
}
