/** Cible active des transcriptions vocales (discussion classique ou chat projet). */
export type VoiceTranscriptHandler = (text: string) => void;

const target: { current: VoiceTranscriptHandler | null } = { current: null };

export function setVoiceTranscriptTarget(handler: VoiceTranscriptHandler | null): void {
  target.current = handler;
}

export function deliverVoiceTranscript(text: string, fallback: VoiceTranscriptHandler): void {
  if (target.current) target.current(text);
  else fallback(text);
}
