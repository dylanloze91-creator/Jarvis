export interface TimedTranscriptPart {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

/** Horodatage court, identique pour l'écoute (tranches de 30 s) et le condensé. */
export function formatMediaTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** Assemble les tranches Whisper sans perdre le moment où elles ont été dites. */
export function joinTimedParts(parts: TimedTranscriptPart[]): string {
  return parts
    .map((part) => {
      const text = part.text.replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const start = formatMediaTimestamp(part.startSeconds);
      const end = formatMediaTimestamp(part.endSeconds);
      return `[${start} → ${end}] ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}
