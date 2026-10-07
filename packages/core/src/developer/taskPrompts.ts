import { CodeModelFormatError, extractJson } from './codeSchemas.js';
import { normalizePlan, rawPlanSchema, suiteSetOf, type TaskPlan } from './taskPlan.js';
import type { ReviewedPlan } from './taskPolicy.js';
import type { ProjectProfile } from './engine/projectProfile.js';
import { JARVIS_PROJECT_PROFILE } from './engine/profiles/jarvis.js';
import { CODE_MODEL_CODER_KNOWLEDGE } from './codeModelKnowledge.js';
import { tscErrors } from './testOutput.js';

const CODER_KNOWLEDGE_BLOCK = `\nSavoir métier (Codeur) :\n${CODE_MODEL_CODER_KNOWLEDGE}`;

function userProjectStyleHint(project: ProjectProfile): string {
  if (project.id === 'jarvis') return '';
  return `\nÉcris le programme demandé dans le style qui convient (fichiers, pile, architecture) : ne force pas un canevas unique imposé par le gabarit si la demande demande autre chose.`;
}

function appendManual(system: string, manual?: string): string {
  const block = manual?.trim();
  return block ? `${system}\n\n${block}` : system;
}

/**
 * Consignes du modèle de code pour une tâche. Indépendantes du modèle :
 * appels d'outils natifs d'Ollama, plan en JSON validé par Zod. Sans profil,
 * celles de Jarvis (figées par `jarvis.test.ts`).
 */
export const PLAN_MARKER = 'ÉTAPE : PLAN';
export const EDIT_MARKER = 'ÉTAPE : MODIFICATION';
export const FIX_MARKER = 'ÉTAPE : CORRECTION';

export function planSystemPrompt(
  project: ProjectProfile = JARVIS_PROJECT_PROFILE,
  manual?: string,
): string {
  const { ids, defaults } = suiteSetOf(project);
  const suites = ids.map((id) => `"${id}" (${project.testSuites[id]!.label})`).join(', ');
  const example = defaults.map((id) => `"${id}"`).join(', ');
  const base = `Tu es Jarvis Développeur. ${PLAN_MARKER}.
${project.promptContext}
Tu prépares un plan de modification. Tu ne modifies rien à cette étape.
Utilise les outils de lecture (dev_search_files, dev_search_code, dev_read_file) pour trouver les vrais fichiers, en peu d'appels.
Termine par un seul bloc JSON, sans autre texte après :
{"resume": "ce qui va changer", "criteres": ["comment on saura que c'est réussi"], "fichiers": [{"chemin": "chemin/relatif.ts", "action": "creer|modifier|supprimer", "pourquoi": "..."}], "tests": [${example}]}
Tests possibles : ${suites}.
Liste tous les fichiers à créer ou modifier, tests compris. Garde le plan petit.
Ne prévois pas de nouveau fichier de tests sauf si l'utilisateur le demande explicitement : sur un gabarit, les tests existants suffisent pour valider un changement ciblé.${userProjectStyleHint(project)}${CODER_KNOWLEDGE_BLOCK}`;
  return appendManual(base, manual);
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
  manual?: string,
): string {
  const base = `Tu es Jarvis Développeur. ${EDIT_MARKER}.
${project.promptContext}
Tu travailles dans une copie isolée du dépôt, sur une branche jarvis-dev/*.
${planBlock(plan)}
${project.editHints ? `${project.editHints}\n` : ''}${EDIT_RULES}${userProjectStyleHint(project)}${CODER_KNOWLEDGE_BLOCK}`;
  return appendManual(base, manual);
}

export function editPrompt(request: string): string {
  return `Fais les modifications du plan pour cette demande :\n${request.trim()}`;
}

export function fixSystemPrompt(
  plan: ReviewedPlan,
  attempt: number,
  max: number,
  project: ProjectProfile = JARVIS_PROJECT_PROFILE,
  manual?: string,
): string {
  const base = `Tu es Jarvis Développeur. ${FIX_MARKER} (essai ${attempt} sur ${max}).
${project.promptContext}
Tes modifications ont fait échouer des tests. Corrige-les dans la copie isolée.
${planBlock(plan)}
${project.editHints ? `${project.editHints}\n` : ''}${EDIT_RULES}${userProjectStyleHint(project)}${CODER_KNOWLEDGE_BLOCK}`;
  return appendManual(base, manual);
}

export function fixPrompt(
  newFailures: string[],
  excerpts: string[],
  manual?: string,
): string {
  const base = `Nouveaux échecs (absents avant la tâche) :
${newFailures
  .slice(0, 20)
  .map((f) => `- ${f}`)
  .join('\n')}

Extraits des sorties :
${excerpts.join('\n---\n').slice(0, 6000)}

Lis les fichiers concernés, puis corrige seulement ce qui est nécessaire.
Si la même erreur (même test ou même code TS à la même ligne) apparaît encore après une correction, change d’approche : ne refais pas la modification déjà tentée.`;
  return appendManual(base, manual);
}

/**
 * Écriture fichier par fichier (5.0.1) pour les projets nés d'un gabarit : au
 * lieu d'enchaîner des appels d'outils, le modèle rend le contenu complet d'un
 * seul fichier ; Jarvis l'écrit par l'outil de la tâche (plan, journal). Plus
 * sûr pour un petit modèle.
 */
export const WRITE_MARKER = 'ÉTAPE : ÉCRITURE';

export function fileWriteSystem(
  plan: ReviewedPlan,
  project: ProjectProfile,
  manual?: string,
): string {
  const base = `Tu es Jarvis Développeur. ${WRITE_MARKER}.
${project.promptContext}
${planBlock(plan)}
Tu écris UN fichier à la fois, en entier. Réponds seulement par le contenu complet du fichier, dans un seul bloc de code, sans explication avant ni après.
Le code doit compiler en TypeScript strict et rester simple. Jamais de secret, jamais de réseau, jamais de lancement de processus.${userProjectStyleHint(project)}${CODER_KNOWLEDGE_BLOCK}`;
  return appendManual(base, manual);
}

export interface FileWriteInput {
  request: string;
  path: string;
  /** Contenu actuel, ou null pour un nouveau fichier. */
  current: string | null;
  /** Consignes de la mission et du gabarit. */
  context?: string;
  /** Autres fichiers, pour référence (à ne pas réécrire). */
  related: ReadonlyArray<{ path: string; content: string }>;
  /** Correction : échecs, extraits des sorties, diagnostic. */
  failures?: readonly string[];
  excerpts?: readonly string[];
  diagnosis?: string;
  /** Fichiers protégés cités par les échecs (tests du gabarit) : justes, à ne pas accuser. */
  fixedFiles?: readonly string[];
}

const fence = (path: string, content: string): string =>
  `\`\`\`${path.split('.').pop() ?? ''}\n${content.slice(0, 6_000)}\n\`\`\``;

/** Conseils courts pour les erreurs TypeScript qu'un petit modèle ne relie pas à sa ligne. */
const TSC_HINTS: Record<string, string> = {
  TS2588:
    'déclarée avec const (y compris `const { … } = …`) : déclare-la avec let, ou modifie une copie (`const next = { ...state }`, puis `next.x = …`)',
  TS2683: 'pas de this hors d’une classe : passe l’état en paramètre',
  TS2684: 'pas de this hors d’une classe : passe l’état en paramètre',
  TS2339:
    'ce champ n’existe pas sur ce type : ajoute-le à l’interface et à la création, ou garde le nom existant',
  TS2551:
    'ce champ n’existe pas sur ce type : ajoute-le à l’interface et à la création, ou garde le nom existant',
  TS2741: 'champ obligatoire absent : ajoute-le à l’objet',
  TS2739: 'champs obligatoires absents : ajoute-les à l’objet',
  TS2304: 'nom inconnu : déclare-le ou importe-le',
  TS2552: 'nom inconnu : déclare-le ou importe-le',
  TS2307: 'module introuvable : n’importe que des fichiers du projet ou des paquets installés',
  TS7006: 'donne un type au paramètre',
  TS7031: 'donne un type au paramètre',
  TS2322: 'types incompatibles : ajuste le type ou la valeur',
  TS2345: 'types incompatibles : ajuste le type ou la valeur',
  TS2532: 'valeur peut-être undefined : vérifie-la avant',
  TS18048: 'valeur peut-être undefined : vérifie-la avant',
  TS6133: 'déclaré mais jamais utilisé : supprime-le',
  TS1005: 'syntaxe : vérifie parenthèses, accolades et virgules',
  TS1128: 'syntaxe : vérifie parenthèses, accolades et virgules',
};

/** Erreurs de typage du fichier, avec la ligne fautive et un conseil, tirées des sorties de test. */
export function typeErrorLines(
  path: string,
  content: string,
  excerpts: readonly string[],
  max = 15,
): string[] {
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const error of excerpts.flatMap((e) => tscErrors(e))) {
    if (error.path !== path) continue;
    const key = `${error.line}:${error.code}:${error.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const code = lines[error.line - 1]?.trim().slice(0, 160) ?? '';
    const hint = TSC_HINTS[error.code];
    out.push(
      `- ligne ${error.line}${code ? ` \`${code}\`` : ''} : ${error.code} ${error.message.slice(0, 160)}${hint ? ` → ${hint}` : ''}`,
    );
    if (out.length >= max) break;
  }
  return out;
}

export function fileWritePrompt(input: FileWriteInput): string {
  const parts = [`Demande de l'utilisateur :\n${input.request.trim()}`];
  if (input.context?.trim()) parts.push(input.context.trim());
  for (const file of input.related)
    parts.push(
      `Fichier ${file.path} (référence, ne le réécris pas) :\n${fence(file.path, file.content)}`,
    );
  parts.push(
    input.current === null
      ? `${input.path} n’existe pas encore.`
      : `Contenu actuel de ${input.path} :\n${fence(input.path, input.current)}`,
  );
  if (input.failures?.length) {
    parts.push(
      `Ces erreurs sont à corriger :\n${input.failures
        .slice(0, 20)
        .map((f) => `- ${f}`)
        .join('\n')}`,
    );
    const typed =
      input.current === null ? [] : typeErrorLines(input.path, input.current, input.excerpts ?? []);
    if (typed.length)
      parts.push(
        `Lignes de ${input.path} refusées par TypeScript (corrige chacune) :\n${typed.join('\n')}`,
      );
    if (input.excerpts?.length)
      parts.push(`Extraits des sorties :\n${input.excerpts.join('\n---\n').slice(0, 3_000)}`);
    if (input.fixedFiles?.length)
      parts.push(
        `Les tests de ${input.fixedFiles.join(', ')} sont justes et ne changent pas : corrige ${input.path} pour qu’ils passent. Le nom de chaque test dit ce qu’il attend.`,
      );
    if (input.diagnosis?.trim())
      parts.push(
        `Piste du débogueur (à vérifier, elle peut se tromper) :\n${input.diagnosis.trim()}`,
      );
  }
  if (input.current !== null)
    parts.push(
      `${input.path} fonctionne déjà : garde tel quel tout ce que la demande ne change pas (noms, exports, réglages, autres fonctions).`,
    );
  parts.push(
    `Écris maintenant le contenu complet de ${input.path}${input.failures?.length ? ', corrigé' : ''}, dans un seul bloc de code.`,
  );
  return parts.join('\n\n');
}

/** Contenu du fichier dans la réponse : le plus long bloc de code, sinon la réponse si c'est du code. */
export function extractFileContent(text: string): string | null {
  const blocks = [...text.matchAll(/```[\w.+-]*[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const open = /```[\w.+-]*[ \t]*\r?\n([\s\S]*)$/.exec(text);
  if (!blocks.length && open) blocks.push(open[1]!);
  const best = blocks.sort((a, b) => b.length - a.length)[0];
  const content = (best ?? text).replace(/\s+$/, '');
  if (!content.trim()) return null;
  if (
    !best &&
    !/^\s*(import|export|const|let|function|class|interface|type|\/\/|\/\*|<|\{)/m.test(content)
  )
    return null;
  return `${content}\n`;
}
