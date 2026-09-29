import { splitTranscript } from './chunk.js';
import { detectVideoDomain, FINANCE_DISCLAIMER, type VideoDomain } from './domain.js';
import { dropSentencesWithInventedNumbers } from './numbers.js';
import { IMPORTANCE_RUBRIC, chunkPrompt, mergePrompt } from './rubric.js';
import {
  importanceScore,
  proseFromModelAnalysis,
  rankNotesByImportance,
  stripImportanceLabels,
} from './structured.js';

export type TextComplete = (system: string, user: string) => Promise<string>;

const MERGE_BATCH_CHARS = 6_000;
const MERGE_BATCH_COUNT = 6;

/**
 * Découpe la transcription, tire les points importants de chaque partie,
 * puis fusionne en un seul condensé. Les chiffres absents de la source
 * sont retirés après coup.
 */
export async function condenseTranscript(input: {
  transcript: string;
  complete: TextComplete;
  onProgress?: (message: string) => void;
  chunkChars?: number;
}): Promise<string> {
  const chunks = splitTranscript(input.transcript, input.chunkChars);
  if (chunks.length === 0) {
    throw new Error('transcription vide');
  }

  const domain = detectVideoDomain(input.transcript);
  const system = systemFor(domain);
  const notes: { text: string; score: number | null }[] = [];
  let failed = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    input.onProgress?.(
      `Repérage des points importants, partie ${index + 1} sur ${chunks.length}…`,
    );
    try {
      const raw = (await input.complete(system, chunkPrompt(chunks[index]!, index, chunks.length))).trim();
      const note = proseFromModelAnalysis(raw).trim();
      if (note) notes.push({ text: note, score: importanceScore(raw) });
    } catch {
      failed += 1;
    }
  }

  if (notes.length === 0) {
    throw new Error('modèle local indisponible');
  }

  input.onProgress?.('Rédaction du condensé…');
  const ranked = rankNotesByImportance(notes);
  const merged = proseFromModelAnalysis((await mergeAll(ranked, input.complete, system, domain)).trim());
  let checked = dropSentencesWithInventedNumbers(stripImportanceLabels(merged), input.transcript);
  if (domain === 'finance' && checked && !checked.includes(FINANCE_DISCLAIMER)) {
    checked = `${checked}\n\n${FINANCE_DISCLAIMER}`.trim();
  }
  if (failed === 0) return checked;
  return `${checked}\n\nCertaines parties n'ont pas pu être lues par le modèle local.`.trim();
}

function systemFor(domain: VideoDomain): string {
  if (domain !== 'finance') return IMPORTANCE_RUBRIC;
  return `${IMPORTANCE_RUBRIC} Cette vidéo parle de finance : sépare les faits des opinions et des prévisions, et ne donne pas de conseil d'investissement.`;
}

async function mergeAll(
  notes: string[],
  complete: TextComplete,
  system: string,
  domain: VideoDomain,
): Promise<string> {
  let current = notes;
  while (current.length > 1 && current.join('\n\n').length > MERGE_BATCH_CHARS) {
    const next: string[] = [];
    for (let index = 0; index < current.length; index += MERGE_BATCH_COUNT) {
      const group = current.slice(index, index + MERGE_BATCH_COUNT);
      const merged = proseFromModelAnalysis((await complete(system, mergePrompt(group, domain))).trim());
      if (merged) next.push(merged);
    }
    if (next.length === 0) break;
    current = next;
  }
  return complete(system, mergePrompt(current, domain));
}
