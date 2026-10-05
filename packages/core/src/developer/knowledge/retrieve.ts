import type {
  ManualChunk,
  ManualEmbedFn,
  ManualIndex,
  ManualPassage,
  ManualQuery,
  ManualPassageView,
} from './types.js';

export const DEFAULT_MANUAL_MAX_PASSAGES = 6;
export const DEFAULT_MANUAL_MAX_CHARS = 2_500;

const TS_CODE = /\bTS\d{4}\b/g;

export function extractErrorCodes(...parts: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const match of part.matchAll(TS_CODE)) seen.add(match[0]!);
  }
  return [...seen];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

export function keywordScore(queryTokens: readonly string[], chunk: ManualChunk): number {
  if (!queryTokens.length) return 0;
  const hay = `${chunk.section}\n${chunk.text}`.toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function chunkMatchesTemplate(chunk: ManualChunk, templateId?: string): boolean {
  if (!templateId) return true;
  if (!chunk.meta.templateId) return true;
  return (
    chunk.meta.templateId === templateId ||
    chunk.meta.tags.includes(templateId) ||
    chunk.meta.tags.includes('all')
  );
}

function chunkMatchesErrors(chunk: ManualChunk, codes: readonly string[]): boolean {
  if (!codes.length) return true;
  if (!chunk.meta.errorCodes?.length) return true;
  return codes.some((c) => chunk.meta.errorCodes!.includes(c));
}

export function scoreChunk(
  chunk: ManualChunk,
  queryTokens: readonly string[],
  queryVector: number[] | null,
): number {
  const kw = keywordScore(queryTokens, chunk);
  if (queryVector && chunk.embedding?.length === queryVector.length) {
    const sim = cosineSimilarity(queryVector, chunk.embedding);
    return sim * 0.7 + kw * 0.3;
  }
  return kw;
}

export function retrieveManualPassages(
  index: ManualIndex,
  query: ManualQuery,
): ManualPassage[] {
  const maxPassages = query.maxPassages ?? DEFAULT_MANUAL_MAX_PASSAGES;
  const maxChars = query.maxChars ?? DEFAULT_MANUAL_MAX_CHARS;
  const failureText = query.failures?.join('\n') ?? '';
  const codes = extractErrorCodes(query.text, failureText);
  const queryText = [query.text, failureText].filter(Boolean).join('\n');
  const tokens = tokenize(queryText);

  let candidates = index.chunks.filter(
    (c) => chunkMatchesTemplate(c, query.templateId) && chunkMatchesErrors(c, codes),
  );
  if (!candidates.length) candidates = index.chunks;

  return rankPassages(candidates, tokens, null, maxPassages, maxChars);
}

/** Version async : embedding de la requête si des chunks en ont. */
export async function retrieveManualPassagesAsync(
  index: ManualIndex,
  query: ManualQuery,
  embed?: ManualEmbedFn,
): Promise<ManualPassage[]> {
  const maxPassages = query.maxPassages ?? DEFAULT_MANUAL_MAX_PASSAGES;
  const maxChars = query.maxChars ?? DEFAULT_MANUAL_MAX_CHARS;
  const failureText = query.failures?.join('\n') ?? '';
  const codes = extractErrorCodes(query.text, failureText);
  const queryText = [query.text, failureText].filter(Boolean).join('\n');
  const tokens = tokenize(queryText);

  let candidates = index.chunks.filter(
    (c) => chunkMatchesTemplate(c, query.templateId) && chunkMatchesErrors(c, codes),
  );
  if (!candidates.length) candidates = index.chunks;

  let queryVector: number[] | null = null;
  if (embed && candidates.some((c) => c.embedding?.length)) {
    queryVector = await embed(queryText.slice(0, 4_000)).catch(() => null);
  }

  return rankPassages(candidates, tokens, queryVector, maxPassages, maxChars);
}

function rankPassages(
  candidates: ManualChunk[],
  tokens: string[],
  queryVector: number[] | null,
  maxPassages: number,
  maxChars: number,
): ManualPassage[] {
  const scored = candidates
    .map((chunk) => ({
      id: chunk.id,
      source: chunk.source,
      section: chunk.section,
      text: chunk.text,
      score: scoreChunk(chunk, tokens, queryVector),
    }))
    .filter((p) => p.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score);

  const picked: ManualPassage[] = [];
  let chars = 0;
  for (const item of scored) {
    if (picked.length >= maxPassages) break;
    const add = item.text.length + item.section.length + 40;
    if (picked.length > 0 && chars + add > maxChars) break;
    picked.push(item);
    chars += add;
  }

  if (!picked.length && scored.length) {
    const first = scored[0]!;
    picked.push(first);
  }

  return picked;
}

/** Bloc injecté dans les prompts du modèle de code. */
export function formatManualBlock(passages: readonly ManualPassage[]): string {
  if (!passages.length) return '';
  const lines = ['Manuel pertinent :'];
  let chars = lines[0]!.length;
  const max = DEFAULT_MANUAL_MAX_CHARS;
  for (const p of passages) {
    const block = `### ${p.section} (${p.source})\n${p.text.trim()}`;
    if (chars + block.length + 2 > max && lines.length > 1) break;
    lines.push(block);
    chars += block.length + 2;
  }
  return lines.join('\n\n').slice(0, max);
}

export function toManualPassageViews(passages: readonly ManualPassage[]): ManualPassageView[] {
  return passages.map((p) => ({
    id: p.id,
    source: p.source,
    section: p.section,
    score: Math.round(p.score * 1000) / 1000,
    excerpt: p.text.trim().slice(0, 220).replace(/\s+/g, ' '),
  }));
}
