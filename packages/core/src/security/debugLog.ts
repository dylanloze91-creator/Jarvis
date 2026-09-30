import { redactSecrets, redactValue } from './redact.js';

/**
 * Journal technique activable. Même activé, aucun secret n'est écrit :
 * le message et le détail passent par la rédaction avant `console.debug`.
 */
export function debugLog(
  enabled: boolean,
  scope: string,
  message: string,
  detail?: unknown,
): void {
  if (!enabled) return;
  const safe = redactSecrets(message);
  if (detail === undefined) {
    console.debug(`[jarvis:${scope}] ${safe}`);
    return;
  }
  console.debug(`[jarvis:${scope}] ${safe}`, redactValue(detail));
}
