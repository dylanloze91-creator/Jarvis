import type { Settings } from '@jarvis/core';
import { shouldOpenDeveloperPanelForChatInput } from '@jarvis/core';

/** Décision d’envoi depuis la discussion unifiée (5.0.69 point 5). */
export function unifiedChatSubmitTarget(
  text: string,
  settings: Settings | null,
): 'developer' | 'chat' {
  if (!settings) return 'chat';
  if (shouldOpenDeveloperPanelForChatInput(text, settings)) return 'developer';
  return 'chat';
}
