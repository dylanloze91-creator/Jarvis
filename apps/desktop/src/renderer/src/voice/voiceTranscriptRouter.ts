import { isDeveloperVoiceIntent } from '@jarvis/core';

/** Cible active des transcriptions vocales (discussion classique ou chat projet). */
export type VoiceTranscriptHandler = (text: string) => void;

const target: { current: VoiceTranscriptHandler | null } = { current: null };
const developerRoute: { current: VoiceTranscriptHandler | null } = { current: null };
let pendingDeveloperTranscript: string | null = null;

export function setVoiceTranscriptTarget(handler: VoiceTranscriptHandler | null): void {
  target.current = handler;
}

/** Tableau de bord : bascule vers l’écran projets + chat quand la phrase est « développeur ». */
export function setDeveloperVoiceRoute(handler: VoiceTranscriptHandler | null): void {
  developerRoute.current = handler;
}

/** File après bascule compact → tableau de bord (le Dashboard consomme au montage). */
export function queueDeveloperVoiceTranscript(text: string): void {
  pendingDeveloperTranscript = text.trim();
}

export function takePendingDeveloperVoiceTranscript(): string | null {
  const next = pendingDeveloperTranscript;
  pendingDeveloperTranscript = null;
  return next;
}

export function deliverVoiceTranscript(
  text: string,
  fallback: VoiceTranscriptHandler,
  options?: { developerEnabled?: boolean },
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (target.current) {
    target.current(trimmed);
    return;
  }
  const devOk = options?.developerEnabled !== false;
  if (devOk && isDeveloperVoiceIntent(trimmed) && developerRoute.current) {
    developerRoute.current(trimmed);
    return;
  }
  fallback(trimmed);
}
