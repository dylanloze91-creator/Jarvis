export const KNOW_CATEGORY_IDS = [
  'personalization',
  'memories',
  'learning',
  'conversations',
  'documents',
  'sorter',
  'questionnaire',
  'wake',
] as const;

export type KnowCategoryId = (typeof KNOW_CATEGORY_IDS)[number];

export function isKnowCategoryId(value: string): value is KnowCategoryId {
  return (KNOW_CATEGORY_IDS as readonly string[]).includes(value);
}

export interface KnowCategory {
  id: KnowCategoryId;
  label: string;
  hint: string;
  count: number;
}

export const KNOW_LABELS: Record<KnowCategoryId, { label: string; hint: string }> = {
  personalization: { label: 'Personnalisation', hint: 'Prénom et règles' },
  memories: { label: 'Souvenirs', hint: 'Mémoire' },
  learning: { label: 'Corrections et préférences', hint: 'Ce que tu as corrigé ou préféré' },
  conversations: { label: 'Conversations', hint: 'Une par une, ou toutes' },
  documents: { label: 'Documents indexés', hint: 'Textes rangés pour la recherche' },
  sorter: { label: 'Phrases du trieur', hint: 'À trier, examen, validées' },
  questionnaire: { label: 'Questionnaire', hint: 'Tes réponses' },
  wake: { label: 'Apprentissage du réveil', hint: 'Extraits de ta voix' },
};

const LEARNING_TYPES = new Set(['correction', 'preference']);

export interface KnowChunk {
  id: string;
  title?: string;
  text?: string;
  kind?: string;
  source?: string;
  learning?: { type?: string; content?: string };
}

export function countPersonalization(profile: { user?: Record<string, string>; rules?: unknown[] } | null): number {
  if (!profile) return 0;
  const user = Object.values(profile.user ?? {}).filter((value) => value.trim()).length;
  const rules = Array.isArray(profile.rules) ? profile.rules.length : 0;
  return user + rules;
}

export function countKnowledge(chunks: readonly KnowChunk[]): { memories: number; documents: number; learning: number } {
  let memories = 0;
  let documents = 0;
  let learning = 0;
  for (const chunk of chunks) {
    if (chunk.learning && LEARNING_TYPES.has(chunk.learning.type ?? '')) learning += 1;
    else if (chunk.kind === 'memory') memories += 1;
    else if (chunk.kind === 'file') documents += 1;
  }
  return { memories, documents, learning };
}

export function eraseKnowledge<T extends KnowChunk>(chunks: readonly T[], category: 'memories' | 'documents' | 'learning'): T[] {
  return chunks.filter((chunk) => {
    if (category === 'learning') return !(chunk.learning && LEARNING_TYPES.has(chunk.learning.type ?? ''));
    if (chunk.learning && LEARNING_TYPES.has(chunk.learning.type ?? '')) return true;
    if (category === 'memories') return chunk.kind !== 'memory';
    return chunk.kind !== 'file';
  });
}

/** « Tout effacer » ne vise jamais les réglages ni les projets. */
export function eraseTouchesSettingsOrProjects(relativePath: string): boolean {
  const path = relativePath.replace(/\\/g, '/');
  if (path === 'settings.json' || path.startsWith('settings.json')) return true;
  if (path === 'developer/projects' || path.startsWith('developer/projects/')) return true;
  return false;
}

export const SORTER_PHRASE_FILES = ['a-trier.jsonl', 'examen.jsonl', 'valide.jsonl'] as const;

export function sorterPhraseCount(lines: Partial<Record<(typeof SORTER_PHRASE_FILES)[number], number>>): number {
  return SORTER_PHRASE_FILES.reduce((sum, file) => sum + (lines[file] ?? 0), 0);
}
