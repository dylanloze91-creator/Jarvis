import type { ProjectTemplateId } from '../engine/templates.js';

export const MANUAL_INDEX_VERSION = 1 as const;

/** Métadonnées d’un extrait du manuel technique (frontmatter ou défaut). */
export interface ManualChunkMeta {
  tags: string[];
  templateId?: ProjectTemplateId;
  errorCodes?: string[];
  language?: string;
}

export interface ManualChunk {
  id: string;
  /** Chemin relatif sous `manual/` (ex. `typescript-strict.md`). */
  source: string;
  section: string;
  text: string;
  meta: ManualChunkMeta;
  embedding?: number[];
}

export interface ManualIndex {
  version: typeof MANUAL_INDEX_VERSION;
  chunks: ManualChunk[];
}

export interface ManualPassage {
  id: string;
  source: string;
  section: string;
  text: string;
  score: number;
}

export interface ManualQuery {
  /** Demande, erreurs, contexte libre. */
  text: string;
  templateId?: ProjectTemplateId;
  /** Lignes d’échec de tests ou tsc. */
  failures?: readonly string[];
  maxPassages?: number;
  maxChars?: number;
}

/** Passage affiché dans l’UI (sans le texte complet si trop long). */
export interface ManualPassageView {
  id: string;
  source: string;
  section: string;
  score: number;
  excerpt: string;
}

export type ManualEmbedFn = (text: string) => Promise<number[] | null>;
