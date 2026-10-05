import { z } from 'zod';
import { MISSION_KINDS, type MissionKind } from '../engine/router.js';
import { PROJECT_TEMPLATE_IDS, type ProjectTemplateId } from '../engine/templates.js';
import { randomId } from '../../types.js';
import type { ManualChunk } from './types.js';
import { extractErrorCodes } from './retrieve.js';

export const validatedFixSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  templateId: z.enum(PROJECT_TEMPLATE_IDS).optional(),
  errorSignature: z.string(),
  symptom: z.string().min(1),
  rootCause: z.string().min(1),
  fixSummary: z.string().min(1),
  filesTouched: z.array(z.string()),
  missionKind: z.enum(MISSION_KINDS),
  model: z.string(),
  proof: z.object({
    suites: z.array(z.string()),
    checkpoint: z.string().optional(),
  }),
});
export type ValidatedFix = z.infer<typeof validatedFixSchema>;

export interface MissionLearning {
  saved: boolean;
  reason?: string;
  fixId?: string;
}

/** Entrée minimale pour décider si une fiche peut être enregistrée (testable sans Electron). */
export interface LearningGateInput {
  learningEnabled: boolean;
  reportVerdict: 'success' | 'failed' | 'stopped' | null;
  repeatedFailure: boolean;
  reviewBlockingCount: number;
  /** Au moins une série de tests a signalé de nouveaux échecs avant le succès. */
  hadNewFailures: boolean;
}

export function canSaveValidatedFix(input: LearningGateInput): { ok: true } | { ok: false; reason: string } {
  if (!input.learningEnabled) {
    return { ok: false, reason: 'apprentissage désactivé dans les réglages' };
  }
  if (input.repeatedFailure) {
    return { ok: false, reason: 'arrêt net : le même échec est revenu, rien n’est mémorisé' };
  }
  if (input.reportVerdict !== 'success') {
    return { ok: false, reason: 'tests ou revue non réussis : rien n’est mémorisé' };
  }
  if (input.reviewBlockingCount > 0) {
    return { ok: false, reason: 'revue avec points bloquants : rien n’est mémorisé' };
  }
  if (!input.hadNewFailures) {
    return {
      ok: false,
      reason: 'aucun échec corrigé pendant la mission : rien à mémoriser',
    };
  }
  return { ok: true };
}

export function missionLearningOutcome(
  gate: ReturnType<typeof canSaveValidatedFix>,
  fixId?: string,
): MissionLearning {
  if (gate.ok) return { saved: true, fixId };
  return { saved: false, reason: gate.reason };
}

export interface BuildValidatedFixInput {
  missionKind: MissionKind;
  request: string;
  model: string;
  templateId?: ProjectTemplateId;
  planSummary: string;
  filesTouched: readonly string[];
  testSuites: readonly string[];
  runs: ReadonlyArray<{ newFailures: readonly string[] }>;
  checkpoint?: string;
  now: number;
}

/** Signature des échecs rencontrés avant la réussite (pour retrouver la fiche). */
export function learningErrorSignature(runs: ReadonlyArray<{ newFailures: readonly string[] }>): string {
  const all = runs.flatMap((r) => r.newFailures);
  return [...new Set(all)].sort().join('\n');
}

export function buildValidatedFix(input: BuildValidatedFixInput): ValidatedFix {
  const signature = learningErrorSignature(input.runs);
  const symptom =
    input.runs.find((r) => r.newFailures.length)?.newFailures[0]?.slice(0, 500) ??
    input.request.slice(0, 200);
  return validatedFixSchema.parse({
    id: randomId(),
    createdAt: input.now,
    templateId: input.templateId,
    errorSignature: signature.slice(0, 4_000),
    symptom,
    rootCause: `Échecs liés à : ${extractErrorCodes(signature, symptom).join(', ') || 'tests ou compilation'}`.slice(
      0,
      500,
    ),
    fixSummary: input.planSummary.slice(0, 800),
    filesTouched: [...input.filesTouched],
    missionKind: input.missionKind,
    model: input.model,
    proof: {
      suites: [...input.testSuites],
      ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
    },
  });
}

/** Convertit une fiche en extrait indexé pour la récupération du manuel. */
export function validatedFixToChunk(fix: ValidatedFix): ManualChunk {
  const text = [
    `Symptôme : ${fix.symptom}`,
    `Cause probable : ${fix.rootCause}`,
    `Correction validée : ${fix.fixSummary}`,
    `Fichiers : ${fix.filesTouched.join(', ') || '—'}`,
    `Signature d’erreur :\n${fix.errorSignature.slice(0, 1_200)}`,
  ].join('\n');
  return {
    id: `vf-${fix.id}`,
    source: `validated/${fix.id}.json`,
    section: `Solution validée · ${fix.symptom.slice(0, 72)}`,
    text,
    meta: {
      tags: ['validated-fix', 'all', ...(fix.templateId ? [fix.templateId] : [])],
      templateId: fix.templateId,
      errorCodes: extractErrorCodes(fix.symptom, fix.errorSignature),
      language: 'fr',
    },
  };
}
