import type { ProjectProfile } from './projectProfile.js';
import type { SpecialistRole } from './roles.js';
import { CODE_MODEL_DEBUGGER_KNOWLEDGE } from '../codeModelKnowledge.js';
import {
  ROLE_FORMATS,
  type ArchitectOutput,
  type DebuggerOutput,
  type DocumentationOutput,
  type GoalOutput,
  type ReviewerOutput,
} from './specialistSchemas.js';

export const GOAL_MARKER = 'ÉTAPE : OBJECTIF';
export const DESIGN_MARKER = 'ÉTAPE : CONCEPTION';
export const REVIEW_MARKER = 'ÉTAPE : REVUE';
export const DIAGNOSE_MARKER = 'ÉTAPE : DIAGNOSTIC';

/** Questions avant de coder : 5 au plus (recommandation D10), aucune si rien ne manque. */
export const MAX_GOAL_QUESTIONS = 5;

/**
 * Contexte du REASONER quand la mission crée un projet (5.0.1) : le projet
 * n'existe pas encore, il ne faut pas lui donner le dépôt de Jarvis.
 */
export const NEW_PROJECT_CONTEXT = {
  promptContext:
    'Nouveau projet, pas encore créé, indépendant de Jarvis : l’ARCHITECTE choisira ensuite son gabarit (jeu dans le navigateur, outil en ligne de commande, application web, bibliothèque, appli Windows). Décris le résultat attendu, sans chemin de fichier, sans parler de Jarvis, d’Electron ni de leurs dossiers.',
} as const satisfies Pick<ProjectProfile, 'promptContext'>;

function head(
  role: SpecialistRole | 'GOAL',
  marker: string,
  project: Pick<ProjectProfile, 'promptContext'>,
): string {
  return `Tu es le spécialiste ${role === 'GOAL' ? 'REASONER' : role} de Jarvis Développeur. ${marker}.
${project.promptContext}
Réponds en français. Le format attendu est :
${ROLE_FORMATS[role]}`;
}

export function goalSystem(
  project: Pick<ProjectProfile, 'promptContext'>,
  maxQuestions = MAX_GOAL_QUESTIONS,
): string {
  return `${head('GOAL', GOAL_MARKER, project)}
Tu reformules la demande en un objectif vérifiable, avec des critères d'acceptation que l'on peut contrôler (fichier, test, commande).
Pose au plus ${maxQuestions} questions, et seulement si une information indispensable manque. Sinon, "questions" est vide.`;
}

export function goalPrompt(request: string): string {
  return `Demande de l'utilisateur :\n${request.trim()}`;
}

export interface MissionBrief {
  request: string;
  goal: GoalOutput | null;
  answers: Array<{ question: string; answer: string }>;
  memory?: string;
}

export function briefBlock(brief: MissionBrief): string {
  const lines = [`Demande : ${brief.request.trim()}`];
  if (brief.goal) {
    lines.push(`Objectif : ${brief.goal.goal}`);
    if (brief.goal.criteria.length) lines.push(`Critères : ${brief.goal.criteria.join(' ; ')}`);
    if (brief.goal.constraints.length)
      lines.push(`Contraintes : ${brief.goal.constraints.join(' ; ')}`);
  }
  for (const { question, answer } of brief.answers)
    if (answer.trim())
      lines.push(`Question : ${question}\nRéponse de l'utilisateur : ${answer.trim()}`);
  if (brief.memory?.trim())
    lines.push(`Mémoire du projet :\n${brief.memory.trim().slice(0, 2_000)}`);
  return lines.join('\n');
}

const READ_ONLY =
  'Tu ne modifies rien : lis seulement les fichiers utiles avec les outils de lecture, en peu d’appels.';

export function designSystem(
  role: 'ARCHITECT' | 'DEBUGGER' | 'DOCUMENTATION',
  project: ProjectProfile,
): string {
  const task =
    role === 'ARCHITECT'
      ? 'Tu conçois la modification : modules et vrais fichiers concernés, technologies (locales d’abord), risques.'
      : role === 'DEBUGGER'
        ? 'Tu diagnostiques le bug : causes possibles avec le fichier concerné et la correction proposée, la plus probable en premier.'
        : 'Tu prépares la documentation : ce qu’il faut expliquer, et les seuls fichiers Markdown (.md) à créer ou modifier.';
  return `${head(role, DESIGN_MARKER, project)}
${task}
${READ_ONLY}`;
}

export function designPrompt(brief: MissionBrief): string {
  return briefBlock(brief);
}

/** Texte donné au plan de modification, à partir de la conception. */
export function designContext(
  role: 'ARCHITECT' | 'DEBUGGER' | 'DOCUMENTATION',
  output: ArchitectOutput | DebuggerOutput | DocumentationOutput,
  brief: MissionBrief,
): string {
  const lines = [
    'Contexte de la mission (préparé par les spécialistes, à respecter) :',
    briefBlock(brief),
  ];
  if (role === 'ARCHITECT') {
    const a = output as ArchitectOutput;
    lines.push(`Conception : ${a.architecture}`);
    for (const m of a.modules)
      lines.push(
        `- ${m.name}${m.responsibility ? ` : ${m.responsibility}` : ''}${m.files.length ? ` (${m.files.join(', ')})` : ''}`,
      );
    if (a.risks.length) lines.push(`Risques : ${a.risks.map((r) => r.risk).join(' ; ')}`);
  } else if (role === 'DEBUGGER') {
    const d = output as DebuggerOutput;
    lines.push('Diagnostic :');
    for (const h of d.hypotheses)
      lines.push(`- ${h.cause}${h.file ? ` (${h.file})` : ''} → ${h.fix}`);
  } else {
    const doc = output as DocumentationOutput;
    lines.push(`Documentation : ${doc.summary}`);
    if (doc.filesChanged.length) lines.push(`Fichiers : ${doc.filesChanged.join(', ')}`);
    lines.push('Mission de documentation : ne crée ou ne modifie que des fichiers Markdown (.md).');
  }
  return lines.join('\n');
}

export function reviewSystem(project: ProjectProfile): string {
  return `${head('REVIEWER', REVIEW_MARKER, project)}
Tu relis un diff déjà testé. Est « bloquant » : une confirmation retirée ou affaiblie, un secret en clair, une suppression de fichiers ou un lancement de processus non demandé, un envoi réseau non local, un critère de la mission non tenu. Le reste est « avertissement » ou « info ».`;
}

export function reviewPrompt(diff: string, brief: MissionBrief): string {
  return `${briefBlock(brief)}\n\nDiff à relire :\n${diff.slice(0, 24_000)}`;
}

export function blockingIssues(review: ReviewerOutput): string[] {
  return review.issues
    .filter((issue) => issue.severity === 'bloquant')
    .map(
      (issue) =>
        `${issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''} — ` : ''}${issue.message}`,
    );
}

export function diagnoseSystem(project: ProjectProfile): string {
  return `${head('DEBUGGER', DIAGNOSE_MARKER, project)}
Des tests échouent après une modification. Explique les causes probables et la correction, sans rien modifier. ${READ_ONLY}
Savoir métier (Débogueur) :
${CODE_MODEL_DEBUGGER_KNOWLEDGE}`;
}

export function diagnosePrompt(failures: string[], excerpts: string[]): string {
  return `Échecs :\n${failures
    .slice(0, 20)
    .map((f) => `- ${f}`)
    .join('\n')}\n\nExtraits des sorties :\n${excerpts.join('\n---\n').slice(0, 6_000)}`;
}

export function diagnosisText(output: DebuggerOutput): string {
  return output.hypotheses
    .map(
      (h, i) =>
        `${i === output.chosen ? '→ ' : '- '}${h.cause}${h.file ? ` (${h.file})` : ''} : ${h.fix}`,
    )
    .join('\n');
}
