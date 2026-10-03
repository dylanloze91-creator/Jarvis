import { z } from 'zod';
import type { SpecialistRole } from './roles.js';

/**
 * Sorties JSON des spécialistes. Une réponse hors format est refusée (une
 * relance au plus), jamais devinée. Les listes absentes valent [].
 */
const list = <T extends z.ZodType>(item: T) => z.array(item).default([]);

export const goalSchema = z.object({
  goal: z.string().min(1),
  questions: list(z.string()),
  criteria: list(z.string()),
  constraints: list(z.string()),
});
export type GoalOutput = z.infer<typeof goalSchema>;

export const architectSchema = z.object({
  architecture: z.string().min(1),
  modules: list(
    z.object({
      name: z.string(),
      responsibility: z.string().default(''),
      files: list(z.string()),
    }),
  ),
  technologies: list(
    z.object({
      name: z.string(),
      reason: z.string().default(''),
      local: z.boolean().default(true),
    }),
  ),
  risks: list(z.object({ risk: z.string(), mitigation: z.string().default('') })),
  questions: list(z.string()),
});
export type ArchitectOutput = z.infer<typeof architectSchema>;

export const reasonerSchema = z.object({
  conclusion: z.string().min(1),
  steps: list(z.string()),
  assumptions: list(z.string()),
  alternatives: list(z.string()),
  confidence: z.enum(['faible', 'moyenne', 'haute']).default('moyenne'),
});
export type ReasonerOutput = z.infer<typeof reasonerSchema>;

export const coderSchema = z.object({
  filesChanged: list(
    z.object({ path: z.string(), action: z.enum(['create', 'edit', 'delete']).default('edit') }),
  ),
  implementation: z.string().default(''),
  testsAdded: list(z.string()),
  notes: list(z.string()),
});
export type CoderOutput = z.infer<typeof coderSchema>;

const issueSchema = z.object({
  severity: z.enum(['info', 'avertissement', 'bloquant']),
  file: z.string().optional(),
  line: z.number().int().optional(),
  message: z.string(),
});

/** `findings` (forme de la 0.4.24) est accepté comme alias de `issues`. */
export const reviewerSchema = z.preprocess(
  (value) =>
    value && typeof value === 'object' && !('issues' in value) && 'findings' in value
      ? { ...(value as Record<string, unknown>), issues: (value as { findings: unknown }).findings }
      : value,
  z.object({
    verdict: z.enum(['ok', 'à revoir', 'refusé']),
    issues: list(issueSchema),
    recommendations: list(z.string()),
  }),
);
export type ReviewerOutput = z.infer<typeof reviewerSchema>;

export const debuggerSchema = z.object({
  hypotheses: z
    .array(
      z.object({ cause: z.string().min(1), file: z.string().optional(), fix: z.string().min(1) }),
    )
    .min(1),
  chosen: z.number().int().min(0).default(0),
  filesToRead: list(z.string()),
});
export type DebuggerOutput = z.infer<typeof debuggerSchema>;

export const testerSchema = z.object({
  suites: list(z.string()),
  testsToWrite: list(z.object({ path: z.string(), cases: list(z.string()) })),
});
export type TesterOutput = z.infer<typeof testerSchema>;

export const researcherSchema = z.object({
  findings: list(z.object({ fact: z.string(), source: z.string(), date: z.string().optional() })),
  uncertainties: list(z.string()),
  recommendation: z.string().default(''),
});
export type ResearcherOutput = z.infer<typeof researcherSchema>;

export const documentationSchema = z.object({
  summary: z.string().min(1),
  sections: list(z.string()),
  filesChanged: list(z.string()),
});
export type DocumentationOutput = z.infer<typeof documentationSchema>;

export const ROLE_SCHEMAS: Record<SpecialistRole, z.ZodType> = {
  ARCHITECT: architectSchema,
  CODER: coderSchema,
  REASONER: reasonerSchema,
  REVIEWER: reviewerSchema,
  DEBUGGER: debuggerSchema,
  TESTER: testerSchema,
  RESEARCHER: researcherSchema,
  DOCUMENTATION: documentationSchema,
};

/** Format montré au modèle dans la consigne de chaque rôle. */
export const ROLE_FORMATS: Record<SpecialistRole | 'GOAL', string> = {
  GOAL: '{"goal": "objectif vérifiable", "questions": ["question indispensable"], "criteria": ["comment on vérifiera"], "constraints": ["contrainte"]}',
  ARCHITECT:
    '{"architecture": "en deux phrases", "modules": [{"name": "...", "responsibility": "...", "files": ["chemin/relatif.ts"]}], "technologies": [{"name": "...", "reason": "...", "local": true}], "risks": [{"risk": "...", "mitigation": "..."}], "questions": []}',
  CODER:
    '{"filesChanged": [{"path": "chemin/relatif.ts", "action": "create|edit|delete"}], "implementation": "...", "testsAdded": ["chemin.test.ts"], "notes": []}',
  REASONER:
    '{"conclusion": "...", "steps": ["..."], "assumptions": ["..."], "alternatives": ["..."], "confidence": "faible|moyenne|haute"}',
  REVIEWER:
    '{"verdict": "ok|à revoir|refusé", "issues": [{"severity": "info|avertissement|bloquant", "file": "...", "line": 1, "message": "..."}], "recommendations": ["..."]}',
  DEBUGGER:
    '{"hypotheses": [{"cause": "...", "file": "chemin/relatif.ts", "fix": "..."}], "chosen": 0, "filesToRead": ["..."]}',
  TESTER: '{"suites": ["test"], "testsToWrite": [{"path": "chemin.test.ts", "cases": ["..."]}]}',
  RESEARCHER:
    '{"findings": [{"fact": "...", "source": "chemin ou adresse", "date": "..."}], "uncertainties": ["..."], "recommendation": "..."}',
  DOCUMENTATION: '{"summary": "...", "sections": ["..."], "filesChanged": ["docs/fichier.md"]}',
};
