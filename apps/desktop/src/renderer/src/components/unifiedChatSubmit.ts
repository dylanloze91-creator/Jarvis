import type { AtelierEtat, Settings } from '@jarvis/core';
import { pourAtelier, shouldOpenDeveloperPanelForChatInput } from '@jarvis/core';

/** Ce que la discussion affiche, réduit à ce que l'atelier relit (qui parle, pièce à l'écran). */
export type MessagesAtelier = readonly { role: string; atelier?: AtelierEtat }[];

/**
 * Décision d’envoi depuis la discussion unifiée (5.0.69 point 5).
 * `atelier` (Jarvis Test seulement) : la discussion vue par l'atelier. Une demande de pièce ou un
 * changement de la pièce à l'écran (« fais une fenêtre pour l'écran sur le dessus ») part à la
 * discussion, jamais au panneau Développeur. Absent (Jarvis Live) : la décision d'avant.
 */
export function unifiedChatSubmitTarget(
  text: string,
  settings: Settings | null,
  atelier?: MessagesAtelier | null,
): 'developer' | 'chat' {
  if (!settings) return 'chat';
  if (atelier && pourAtelier(text, atelier)) return 'chat';
  if (shouldOpenDeveloperPanelForChatInput(text, settings)) return 'developer';
  return 'chat';
}

/** Les éléments de la discussion affichée → messages pour l'atelier (la pièce suit la réponse). */
export function messagesPourAtelier(items: readonly { kind: string; etat?: AtelierEtat }[]): MessagesAtelier {
  const messages: { role: string; atelier?: AtelierEtat }[] = [];
  for (const item of items) {
    if (item.kind === 'user') messages.push({ role: 'user' });
    else if (item.kind === 'assistant') messages.push({ role: 'assistant' });
    else if (item.kind === 'atelier' && item.etat) messages.push({ role: 'assistant', atelier: item.etat });
  }
  return messages;
}
