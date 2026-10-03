import { z } from 'zod';
import { slugify } from '../taskPolicy.js';
import type { MissionSummary } from './mission.js';
import { MISSION_LABELS } from './router.js';
import { PROJECT_TEMPLATE_IDS } from './templates.js';

/**
 * Registre des projets de Jarvis Développeur (décision D3) : dans les données
 * de Jarvis, jamais dans les dépôts. Jarvis lui-même vient des réglages
 * (`developer.repoPath`) ; les autres projets sont importés ou créés.
 */
export const JARVIS_PROJECT_ID = 'jarvis';
/** Missions « Nouveau projet » avant que le projet existe. */
export const NEW_PROJECT_SCOPE = 'nouveau';
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED_IDS = new Set([JARVIS_PROJECT_ID, NEW_PROJECT_SCOPE]);

export const projectEntrySchema = z.object({
  id: z
    .string()
    .regex(PROJECT_ID_PATTERN)
    .refine((id) => !RESERVED_IDS.has(id), 'identifiant réservé'),
  name: z.string().trim().min(1).max(80),
  path: z.string().min(1).max(400),
  kind: z.literal('node'),
  origin: z.enum(['imported', 'created']),
  template: z.enum(PROJECT_TEMPLATE_IDS).optional(),
  description: z.string().max(400).default(''),
  createdAt: z.number(),
});
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

export const projectRegistrySchema = z.object({
  version: z.literal(1),
  projects: z.array(projectEntrySchema).max(200),
});
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;

export function emptyRegistry(): ProjectRegistry {
  return { version: 1, projects: [] };
}

/** Identifiant libre tiré du nom : `photos-par-date`, puis `photos-par-date-2`… */
export function projectIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name, 36).replace(/^-+/, '') || 'projet';
  for (let n = 1; n < 100; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(id) && !RESERVED_IDS.has(id) && PROJECT_ID_PATTERN.test(id)) return id;
  }
  throw new Error('Trop de projets du même nom.');
}

export const PROJECT_MEMORY_MAX = 4_000;

export const projectMemorySchema = z.object({
  notes: z.string().max(PROJECT_MEMORY_MAX).default(''),
  updatedAt: z.number().nullable().default(null),
});
export type ProjectMemory = z.infer<typeof projectMemorySchema>;

/** Mémoire de Jarvis tant que l'utilisateur ne l'a pas changée. */
export const JARVIS_DEFAULT_MEMORY = `Lis CLAUDE.md à la racine avant de modifier : architecture, conventions et « ce qu'il ne faut pas casser ».
Code, messages et documentation en français.
Les tests figés (chat-unchanged, ollama-unchanged, catalog-current) ne sont jamais régénérés ; le catalogue d'outils du chat ne change pas sans l'accord de l'utilisateur.
Le mode Développeur reste coupé par défaut ; aucune publication (push, release) par Jarvis.`;

const VERDICTS: Record<string, string> = {
  success: 'réussie',
  failed: 'pas réussie',
  stopped: 'arrêtée',
};

/** Mémoire et historique donnés aux spécialistes d'une mission (courts : 2 000 caractères au plus). */
export function memoryBlock(notes: string, history: readonly MissionSummary[], max = 5): string {
  const lines: string[] = [];
  if (notes.trim()) lines.push(notes.trim());
  const past = history.slice(0, max);
  if (past.length) {
    lines.push('Missions récentes :');
    for (const m of past)
      lines.push(
        `- ${MISSION_LABELS[m.kind]} « ${m.request.slice(0, 120)} » : ${m.verdict ? (VERDICTS[m.verdict] ?? m.verdict) : m.status}`,
      );
  }
  return lines.join('\n').slice(0, 2_000);
}
