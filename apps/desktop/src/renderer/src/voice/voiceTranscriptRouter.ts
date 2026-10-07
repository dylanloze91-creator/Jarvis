/** Cible active des transcriptions vocales (chat unifié). */
export type VoiceTranscriptHandler = (text: string) => void;

const target: { current: VoiceTranscriptHandler | null } = { current: null };

export function setVoiceTranscriptTarget(handler: VoiceTranscriptHandler | null): void {
  target.current = handler;
}

export function deliverVoiceTranscript(text: string, fallback: VoiceTranscriptHandler): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (target.current) target.current(trimmed);
  else fallback(trimmed);
}
