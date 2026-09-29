/** Taille visée d'une partie envoyée au modèle local. Assez courte pour qwen2.5:3b. */
export const DEFAULT_CHUNK_CHARS = 2_800;

/**
 * Découpe une transcription longue sur les phrases, sans rien jeter.
 * Une phrase plus longue que la cible est coupée sur les espaces.
 */
const TIMED_MARK = /\[\d{1,2}:\d{2}(?::\d{2})?\s*→\s*\d{1,2}:\d{2}(?::\d{2})?\]/g;
const TIMED_HEADER = /^(\[\d{1,2}:\d{2}(?::\d{2})?\s*→\s*\d{1,2}:\d{2}(?::\d{2})?\])\s*([\s\S]*)$/;

export function splitTranscript(text: string, targetChars = DEFAULT_CHUNK_CHARS): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= targetChars) return [normalized];

  const timed = timedPieces(normalized);
  if (timed) {
    return packPieces(
      timed.flatMap((piece) => expandTimedPiece(piece, targetChars)),
      targetChars,
    );
  }
  return packPieces(splitSentences(normalized, targetChars), targetChars);
}

function splitSentences(normalized: string, targetChars: number): string[] {
  return normalized
    .split(/(?<=[.!?…])\s+/u)
    .flatMap((sentence) => (sentence.length > targetChars ? hardSplit(sentence, targetChars) : [sentence.trim()]))
    .filter(Boolean);
}

function packPieces(pieces: string[], targetChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const text = piece.trim();
    if (!text) continue;
    if (!current) {
      current = text;
      continue;
    }
    if (current.length + 1 + text.length > targetChars) {
      chunks.push(current);
      current = text;
    } else {
      current = `${current} ${text}`;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function timedPieces(normalized: string): string[] | null {
  const marks = [...normalized.matchAll(TIMED_MARK)];
  if (marks.length === 0) return null;
  const pieces: string[] = [];
  const first = marks[0]?.index ?? 0;
  const head = normalized.slice(0, first).trim();
  if (head) pieces.push(head);
  for (let index = 0; index < marks.length; index += 1) {
    const start = marks[index]?.index ?? 0;
    const end = index + 1 < marks.length ? (marks[index + 1]?.index ?? normalized.length) : normalized.length;
    const piece = normalized.slice(start, end).trim();
    if (piece) pieces.push(piece);
  }
  return pieces;
}

function expandTimedPiece(piece: string, targetChars: number): string[] {
  if (piece.length <= targetChars) return [piece];
  const header = piece.match(TIMED_HEADER);
  if (!header?.[1]) return splitSentences(piece, targetChars);
  const label = header[1];
  const body = (header[2] ?? '').trim();
  if (!body) return [label];
  const room = Math.max(1, targetChars - label.length - 1);
  const parts = packPieces(splitSentences(body, room), room);
  return parts.map((part, index) => (index === 0 ? `${label} ${part}` : part));
}

function hardSplit(sentence: string, targetChars: number): string[] {
  const words = sentence.split(/\s+/u).filter(Boolean);
  const parts: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length > targetChars) {
      parts.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current) parts.push(current);
  return parts.length > 0 ? parts : [sentence.slice(0, targetChars)];
}
