import { z } from 'zod';
import { normalizeRepoRelative, protectedRepoPath } from '../repoPaths.js';
import { excerptFound, type CitationStatus, type RepoReader } from './ask.js';
import { briefBlock, type MissionBrief } from './missionPrompts.js';
import type { ProjectProfile } from './projectProfile.js';

/**
 * Mission « Améliorer » (0.5.5) : des mesures fixes calculées par Jarvis,
 * puis des propositions du modèle. Une proposition n'est retenue que si une
 * de ses preuves est vérifiée par Jarvis : extrait relu dans le fichier, ou
 * mesure de la liste. Sinon : « avis non retenu ».
 */
export const IMPROVE_MARKER = 'ÉTAPE : AMÉLIORER';

export const PROPOSAL_KINDS = [
  'bug',
  'test',
  'refactor',
  'performance',
  'security',
  'architecture',
  'docs',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_LABELS: Record<ProposalKind, string> = {
  bug: 'Bogue',
  test: 'Test manquant',
  refactor: 'Code à simplifier',
  performance: 'Performance',
  security: 'Sécurité',
  architecture: 'Architecture',
  docs: 'Documentation',
};

export const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|cs|xaml)$/i;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.cs$/;
const SKIPPED = /(^|\/)(node_modules|dist|out|release|bin|obj|coverage|__golden__)\//;
const TODO = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]*(.*)$/;

export interface CodeFileFact {
  path: string;
  content: string;
}

export interface ProjectMetrics {
  files: number;
  lines: number;
  tests: number;
  largest: Array<{ id: string; path: string; lines: number }>;
  todos: Array<{ id: string; path: string; line: number; text: string }>;
  untested: Array<{ id: string; path: string; lines: number }>;
}

function stem(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name
    .replace(/\.(test|spec)(?=\.)/, '')
    .replace(/Tests?(?=\.cs$)/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
}

/** Mesures sans modèle sur les fichiers de code suivis : tailles, TODO, fichiers sans test. */
export function computeMetrics(files: readonly CodeFileFact[]): ProjectMetrics {
  const code = files.filter((f) => CODE_FILE_PATTERN.test(f.path) && !SKIPPED.test(f.path));
  const tests = code.filter((f) => TEST_FILE.test(f.path));
  const sources = code
    .filter((f) => !TEST_FILE.test(f.path))
    .map((f) => ({ path: f.path, content: f.content, lines: f.content.split('\n').length }));
  const tested = new Set(tests.map((f) => stem(f.path)));
  const todos: ProjectMetrics['todos'] = [];
  for (const file of code) {
    file.content.split('\n').forEach((text, i) => {
      const match = TODO.exec(text);
      if (match && todos.length < 20)
        todos.push({
          id: `todo:${file.path}:${i + 1}`,
          path: file.path,
          line: i + 1,
          text: text.trim().slice(0, 160),
        });
    });
  }
  const bySize = [...sources].sort((a, b) => b.lines - a.lines);
  return {
    files: code.length,
    lines: code.reduce((n, f) => n + f.content.split('\n').length, 0),
    tests: tests.length,
    largest: bySize
      .slice(0, 8)
      .map((f) => ({ id: `largest:${f.path}`, path: f.path, lines: f.lines })),
    todos,
    untested: bySize
      .filter((f) => f.lines >= 30 && !tested.has(stem(f.path)))
      .slice(0, 12)
      .map((f) => ({ id: `untested:${f.path}`, path: f.path, lines: f.lines })),
  };
}

export function metricIds(metrics: ProjectMetrics): Set<string> {
  return new Set([
    ...metrics.largest.map((m) => m.id),
    ...metrics.todos.map((m) => m.id),
    ...metrics.untested.map((m) => m.id),
  ]);
}

export function metricsText(metrics: ProjectMetrics): string {
  return [
    `Mesures (calculées par Jarvis) : ${metrics.files} fichiers de code, ${metrics.lines} lignes, ${metrics.tests} fichiers de test.`,
    'Plus gros fichiers :',
    ...metrics.largest.map((m) => `- ${m.id} (${m.lines} lignes)`),
    'TODO / FIXME :',
    ...(metrics.todos.length ? metrics.todos.map((m) => `- ${m.id} : ${m.text}`) : ['- aucun']),
    'Fichiers sans test du même nom :',
    ...(metrics.untested.length
      ? metrics.untested.map((m) => `- ${m.id} (${m.lines} lignes)`)
      : ['- aucun']),
  ].join('\n');
}

const KEYS: Record<string, string> = {
  propositions: 'proposals',
  titre: 'title',
  type: 'kind',
  categorie: 'kind',
  catégorie: 'kind',
  preuves: 'evidence',
  risque: 'risk',
  tests: 'proofTests',
  chemin: 'path',
  extrait: 'excerpt',
  mesure: 'metric',
};

function renameKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [KEYS[k] ?? k, renameKeys(v)]),
  );
}

const KIND_ALIASES: Record<string, ProposalKind> = {
  bogue: 'bug',
  correction: 'bug',
  tests: 'test',
  refactorisation: 'refactor',
  simplification: 'refactor',
  sécurité: 'security',
  securite: 'security',
  documentation: 'docs',
};

const evidenceSchema = z.object({
  path: z.string().max(400).optional(),
  excerpt: z.string().max(600).optional(),
  metric: z.string().max(400).optional(),
});

const proposalSchema = z.object({
  title: z.string().trim().min(3).max(160),
  kind: z
    .preprocess((v) => {
      const key = String(v ?? '')
        .trim()
        .toLowerCase();
      return (PROPOSAL_KINDS as readonly string[]).includes(key) ? key : (KIND_ALIASES[key] ?? key);
    }, z.enum(PROPOSAL_KINDS))
    .catch('refactor'),
  evidence: z.array(evidenceSchema).max(5).default([]),
  gain: z.string().max(300).default(''),
  risk: z.string().max(300).default(''),
  proofTests: z.array(z.string().max(200)).max(5).default([]),
});
export type Proposal = z.infer<typeof proposalSchema>;

/** Sortie de l'ARCHITECTE pour « Améliorer » ; clés françaises acceptées. */
export const improveSchema = z.preprocess(
  renameKeys,
  z.object({ proposals: z.array(proposalSchema).max(8) }),
);
export type ImproveOutput = z.infer<typeof improveSchema>;

export function improveSystem(project: ProjectProfile): string {
  return `Tu es le spécialiste ARCHITECT de Jarvis Développeur. ${IMPROVE_MARKER}.
${project.promptContext}
Tu proposes des améliorations du projet, sans rien modifier. Lis les fichiers utiles avec les outils de lecture, en peu d'appels.
Chaque proposition DOIT avoir une preuve vérifiable : un extrait EXACT d'un fichier que tu as lu, ou l'identifiant d'une mesure de la liste. Sans preuve vérifiée, la proposition sera marquée « avis non retenu ». 8 propositions au plus, les plus utiles d'abord.
Réponds en français. Le format attendu est :
{"proposals": [{"title": "...", "kind": "${PROPOSAL_KINDS.join('|')}", "evidence": [{"path": "chemin/relatif.ts", "excerpt": "texte exact du fichier"}, {"metric": "largest:chemin/relatif.ts"}], "gain": "ce que ça apporte", "risk": "ce que ça peut casser", "proofTests": ["comment on prouvera le gain"]}]}`;
}

export function improvePrompt(brief: MissionBrief, metrics: ProjectMetrics): string {
  return `${briefBlock(brief)}\n\n${metricsText(metrics)}`;
}

export type EvidenceStatus = CitationStatus | 'metric' | 'unknown-metric' | 'empty';

export const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  verified: 'extrait relu dans le fichier',
  'not-found': 'extrait introuvable',
  'missing-file': 'fichier absent',
  refused: 'chemin refusé',
  metric: 'mesure de Jarvis',
  'unknown-metric': 'mesure inconnue',
  empty: 'preuve vide',
};

export interface CheckedProposal extends Proposal {
  evidence: Array<Proposal['evidence'][number] & { status: EvidenceStatus }>;
  /** Au moins une preuve vérifiée par Jarvis. */
  retained: boolean;
  /** Mission lancée depuis cette proposition. */
  missionId?: string | null;
}

/** Relit chaque preuve : le modèle ne décide jamais lui-même qu'une proposition est fondée. */
export async function verifyProposals(
  proposals: readonly Proposal[],
  read: RepoReader,
  metrics: ReadonlySet<string>,
): Promise<CheckedProposal[]> {
  const cache = new Map<string, string | null>();
  const load = async (path: string): Promise<string | null | 'refused'> => {
    const rel = normalizeRepoRelative(path);
    if (!rel || protectedRepoPath(rel)) return 'refused';
    if (!cache.has(rel)) cache.set(rel, await read(rel));
    return cache.get(rel) ?? null;
  };
  const out: CheckedProposal[] = [];
  for (const proposal of proposals) {
    const evidence: CheckedProposal['evidence'] = [];
    for (const item of proposal.evidence) {
      let status: EvidenceStatus;
      if (item.metric?.trim())
        status = metrics.has(item.metric.trim()) ? 'metric' : 'unknown-metric';
      else if (item.path?.trim() && item.excerpt?.trim()) {
        const content = await load(item.path);
        status =
          content === 'refused'
            ? 'refused'
            : content === null
              ? 'missing-file'
              : excerptFound(item.excerpt, content)
                ? 'verified'
                : 'not-found';
      } else status = 'empty';
      evidence.push({ ...item, status });
    }
    out.push({
      ...proposal,
      evidence,
      retained: evidence.some((e) => e.status === 'verified' || e.status === 'metric'),
      missionId: null,
    });
  }
  return out;
}

/** Type de mission d'une proposition retenue. */
export function proposalMissionKind(proposal: Proposal): 'fix' | 'document' | 'modify' {
  return proposal.kind === 'bug' ? 'fix' : proposal.kind === 'docs' ? 'document' : 'modify';
}

/** Demande de la mission née d'une proposition : le titre, ses preuves, le gain et les tests attendus. */
export function proposalRequest(proposal: CheckedProposal): string {
  const proofs = proposal.evidence
    .filter((e) => e.status === 'verified' || e.status === 'metric')
    .map((e) => (e.metric ? `mesure ${e.metric}` : `${e.path} : « ${e.excerpt!.slice(0, 160)} »`));
  return [
    `${proposal.title}.`,
    proofs.length ? `Preuves : ${proofs.join(' ; ')}.` : '',
    proposal.gain ? `Gain attendu : ${proposal.gain}.` : '',
    proposal.risk ? `Risque : ${proposal.risk}.` : '',
    proposal.proofTests.length ? `Tests de preuve : ${proposal.proofTests.join(' ; ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2_000);
}
