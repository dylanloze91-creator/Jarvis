import { z } from 'zod';

/** Formats échangés avec le modèle de code. Une réponse hors format est refusée, jamais devinée. */
export const sourceFileSchema = z.object({ path: z.string().min(1), content: z.string() });
export type SourceFile = z.infer<typeof sourceFileSchema>;

export const codeEditSchema = z.object({
  path: z.string().min(1),
  search: z.string(),
  replace: z.string(),
});
export type CodeEdit = z.infer<typeof codeEditSchema>;

export const devPlanSchema = z.object({
  summary: z.string().min(1),
  files: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  tests: z.array(z.string()).default([]),
  touchesCore: z.boolean().default(false),
});
export type DevPlan = z.infer<typeof devPlanSchema>;

export const reviewReportSchema = z.object({
  verdict: z.enum(['ok', 'à revoir', 'refusé']),
  findings: z
    .array(
      z.object({
        severity: z.enum(['info', 'avertissement', 'bloquant']),
        file: z.string().optional(),
        message: z.string(),
      }),
    )
    .default([]),
});
export type ReviewReport = z.infer<typeof reviewReportSchema>;

export const codeAnalysisSchema = z.object({
  answer: z.string().min(1),
  files: z.array(z.string()).default([]),
});
export type CodeAnalysis = z.infer<typeof codeAnalysisSchema>;

export const repoUnderstandingSchema = z.object({
  summary: z.string().min(1),
  layers: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});
export type RepoUnderstanding = z.infer<typeof repoUnderstandingSchema>;

export const debugHypothesisSchema = z.object({
  cause: z.string().min(1),
  file: z.string().optional(),
  fix: z.string().min(1),
});
export type DebugHypothesis = z.infer<typeof debugHypothesisSchema>;

export class CodeModelFormatError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'CodeModelFormatError';
  }
}

/** Premier bloc JSON (objet ou tableau) d'une réponse, balises ```json comprises. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const source = (fenced ?? text).trim();
  const start = source.search(/[[{]/);
  if (start < 0) throw new CodeModelFormatError('Réponse sans JSON.', text);
  const open = source[start]!;
  const close = open === '{' ? '}' : ']';
  const end = source.lastIndexOf(close);
  if (end <= start) throw new CodeModelFormatError('JSON incomplet.', text);
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    throw new CodeModelFormatError('JSON illisible.', text);
  }
}
