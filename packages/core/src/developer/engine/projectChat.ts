import {
  graphicsEngineChatPromptLine,
  hasGraphicsEngineGrant,
} from '../graphicsEngineAccess.js';
import type { ProjectProfile } from './projectProfile.js';

export const PROJECT_CHAT_MARKER = 'ÉTAPE : DISCUSSION PROJET';

export interface ProjectChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProjectChatCodingPick {
  model: string;
  reason: string;
  at: number;
}

/** Décisions mémorisées pour le projet (ex. « vitesse max 600 », « pas de tests en plus »). */
export function formatProjectDecisions(decisions: readonly string[]): string {
  if (!decisions.length) return '—';
  return decisions.map((d) => `- ${d}`).join('\n');
}

/** Transcription complète pour une mission Modifier. */
export function projectChatTranscript(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
): string {
  return messages
    .map((m) => (m.role === 'user' ? `Utilisateur : ${m.content}` : `Jarvis : ${m.content}`))
    .join('\n\n');
}

/** Demande courte + fil de discussion pour la mission (le plan s’appuie sur tout le fil). */
export function missionRequestFromProjectChat(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  decisions: readonly string[],
): { summary: string; discussionContext: string } {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const summary = (lastUser?.content ?? 'Modification demandée dans la discussion projet.').slice(
    0,
    500,
  );
  const lines = [
    'Contexte : discussion projet en cours. Respecte les décisions mémorisées ci-dessous.',
    decisions.length ? `Décisions mémorisées :\n${formatProjectDecisions(decisions)}` : '',
    '--- Fil de discussion (complet) ---',
    projectChatTranscript(messages),
    '--- Fin du fil ---',
    `Synthèse à réaliser : ${summary}`,
  ].filter(Boolean);
  return { summary, discussionContext: lines.join('\n\n').slice(0, 24_000) };
}

export function projectChatSystemPrompt(
  project: ProjectProfile,
  memoryNotes: string,
  decisions: readonly string[],
  installedModels: readonly string[],
  webSearchAvailable: boolean,
  graphicsEngineGranted = false,
): string {
  const memory = memoryNotes.trim() || '—';
  const models =
    installedModels.length > 0
      ? installedModels.join(', ')
      : '(aucun modèle listé — demande un rafraîchissement Ollama)';
  const searchLine = webSearchAvailable
    ? 'Tu peux faire UNE recherche web (outil dev_project_chat_web_search, confirmation requise) pour signaler un modèle de code local récent ; indique s’il tient sur une RTX 2060 6 Go et 64 Go de RAM. Ne propose jamais de télécharger sans confirmation.'
    : 'La recherche web a déjà été utilisée dans cette discussion : ne la relance pas.';
  const modelsHint =
    installedModels.length > 0
      ? `Modèles locaux installés (référence interne, ne demande jamais à l'utilisateur d'en choisir un) : ${models}`
      : '';
  const engineLine = graphicsEngineChatPromptLine(
    hasGraphicsEngineGrant(graphicsEngineGranted, decisions),
    decisions,
  );
  return `Tu es Jarvis développeur. Tu aides à construire sur le PC de l'utilisateur : applications, jeux, outils — ce qu'il demande. Ce n'est pas un laboratoire de démo ni une parade de spécialistes.
Écris le programme demandé dans le style qui convient (fichiers, pile, architecture) : Snake, page, outil bureau ou CLI n'ont pas la même forme — ne force pas un canevas unique.

Projet : « ${project.label} ».
${project.promptContext}
Mémoire du projet (notes hors dépôt) :
${memory}

Décisions mémorisées (à respecter pour toute modification) :
${formatProjectDecisions(decisions)}
${modelsHint ? `\n${modelsHint}\n` : ''}
${PROJECT_CHAT_MARKER}.
Tu discutes en français : idées, faisabilité, compromis. Tu peux lire le dépôt (dev_read_file, dev_search_code, dev_search_files, dev_git_status, dev_git_diff) mais tu n'écris pas les fichiers dans ce fil.
Quand l'utilisateur formule clairement une création ou une modification, Jarvis enchaîne tout seul (gabarit adapté, tests, application au projet si les tests passent) — ne lui demande pas de lancer une mission, un onglet ou un choix de modèle.
Pour graver une règle durable (« vitesse max 600 », « pas de tests en plus »), utilise dev_project_chat_remember_decision.
${engineLine}
${searchLine}
Si l'utilisateur joint une capture du jeu ou de la page, décris ce que tu vois et relie-le à sa remarque.
Réponds en français, texte libre.`;
}

export function projectChatPrompt(
  history: ProjectChatTurn[],
  userText: string,
  hasScreenshot: boolean,
): string {
  const lines: string[] = [];
  for (const turn of history.slice(-40)) {
    lines.push(turn.role === 'user' ? `Utilisateur :\n${turn.content}` : `Jarvis :\n${turn.content}`);
  }
  const prefix = hasScreenshot
    ? '[L’utilisateur joint une capture d’écran de l’aperçu à côté du chat.]\n\n'
    : '';
  lines.push(`${prefix}Utilisateur :\n${userText.trim()}`);
  return lines.join('\n\n');
}
