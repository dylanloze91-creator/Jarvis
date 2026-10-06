import type { ProjectProfile } from './projectProfile.js';

export const PROJECT_CHAT_MARKER = 'ÉTAPE : DISCUSSION PROJET';

export interface ProjectChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Discussion sur un projet : conseils et lecture du code, sans écriture directe. */
export function projectChatSystemPrompt(project: ProjectProfile, memoryNotes: string): string {
  const memory = memoryNotes.trim() || '—';
  return `Tu es Jarvis Développeur en discussion sur le projet « ${project.label} ».
${project.promptContext}
Mémoire du projet (notes de l'utilisateur, hors dépôt) :
${memory}

${PROJECT_CHAT_MARKER}.
Tu réponds en français, de façon claire et concrète. Tu peux lire le code avec les outils de lecture (dev_read_file, dev_search_code, dev_search_files, dev_git_status, dev_git_diff).
Tu ne modifies jamais les fichiers et tu ne lances pas de commandes destructrices : pour appliquer des changements, l'utilisateur doit lancer une mission « Modifier » (plan validé, cartes de confirmation) depuis l'interface.
Si l'utilisateur demande de changer le code, explique ce que tu ferais et invite-le à utiliser le bouton « Lancer mission Modifier » avec sa demande.
Réponds en texte libre (pas de bloc JSON obligatoire).`;
}

export function projectChatPrompt(history: ProjectChatTurn[], userText: string): string {
  const lines: string[] = [];
  for (const turn of history.slice(-14)) {
    lines.push(turn.role === 'user' ? `Utilisateur :\n${turn.content}` : `Jarvis :\n${turn.content}`);
  }
  lines.push(`Utilisateur :\n${userText.trim()}`);
  return lines.join('\n\n');
}
