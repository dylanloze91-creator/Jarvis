import { createHash } from 'node:crypto';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { examContamination } from './similarity.js';
import type { ExamLine } from './extract.js';
import { phraseKey } from './extract.js';
import type { GeneratedTrieurExample } from './generator.js';

export const TRIEUR_PREP_DEFAULTS = {
  maxTokens: 512,
  validationShare: 0.1,
  seed: 5068,
  minKept: 80,
} as const;

export const CHARS_PER_TOKEN = 3;

export interface TrieurPrepOptions {
  maxTokens?: number;
  validationShare?: number;
  seed?: number;
  minKept?: number;
}

export interface TrieurPreparedLine {
  line: string;
  id: string;
  team: OrchestraTeam;
  tokens: number;
}

export interface TrieurSetAside {
  line: number;
  id: string | null;
  reason: string;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function estimateTokens(example: GeneratedTrieurExample): number {
  const text = example.messages.map((m) => m.content).join('');
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function parseTrainingLine(raw: unknown): GeneratedTrieurExample | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'ligne illisible' };
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !Array.isArray(row.messages)) return { error: 'ligne illisible' };
  const messages = row.messages;
  if (messages.length !== 3) return { error: 'ligne illisible' };
  const roles = messages.map((m) => (typeof m === 'object' && m && 'role' in m ? (m as { role: string }).role : null));
  if (roles.join(',') !== 'system,user,assistant') return { error: 'ligne illisible' };
  const assistant = messages[2] as { content?: string };
  const team = String(assistant.content ?? '') as OrchestraTeam;
  if (!ORCHESTRA_TEAMS.includes(team)) return { error: 'équipe inconnue' };
  return raw as GeneratedTrieurExample;
}

export function prepareTrieurTraining(input: {
  lines: readonly string[];
  exam: readonly ExamLine[];
  options?: TrieurPrepOptions;
}): {
  ok: boolean;
  train: TrieurPreparedLine[];
  validation: TrieurPreparedLine[];
  setAside: TrieurSetAside[];
  reason?: string;
} {
  const options = { ...TRIEUR_PREP_DEFAULTS, ...input.options };
  const examLines = input.exam.map((line) => ({ phrase: line.phrase, context: line.context }));
  const kept: TrieurPreparedLine[] = [];
  const setAside: TrieurSetAside[] = [];
  const seen = new Set<string>();

  input.lines.forEach((line, index) => {
    const lineNo = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      setAside.push({ line: lineNo, id: null, reason: 'ligne illisible' });
      return;
    }
    const example = parseTrainingLine(parsed);
    if ('error' in example) {
      setAside.push({ line: lineNo, id: null, reason: example.error });
      return;
    }
    const key = phraseKey(example.phrase, example.context);
    if (seen.has(key)) {
      setAside.push({ line: lineNo, id: example.id, reason: 'doublon exact' });
      return;
    }
    const tokens = estimateTokens(example);
    if (tokens > options.maxTokens) {
      setAside.push({ line: lineNo, id: example.id, reason: 'trop long' });
      return;
    }
    const contam = examContamination(example.phrase, example.context, examLines);
    if (contam) {
      setAside.push({ line: lineNo, id: example.id, reason: contam });
      return;
    }
    seen.add(key);
    kept.push({ line, id: example.id, team: example.team, tokens });
  });

  if (kept.length < options.minKept) {
    return { ok: false, train: [], validation: [], setAside, reason: `trop peu d'exemples (${kept.length}/${options.minKept})` };
  }

  const rng = mulberry32(options.seed);
  const byTeam = new Map<OrchestraTeam, TrieurPreparedLine[]>();
  for (const row of kept) {
    const bucket = byTeam.get(row.team) ?? [];
    bucket.push(row);
    byTeam.set(row.team, bucket);
  }

  const train: TrieurPreparedLine[] = [];
  const validation: TrieurPreparedLine[] = [];
  for (const team of ORCHESTRA_TEAMS) {
    const bucket = [...(byTeam.get(team) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
    bucket.sort(() => rng() - 0.5);
    const valCount = Math.max(0, Math.floor(bucket.length * options.validationShare));
    validation.push(...bucket.slice(0, valCount));
    train.push(...bucket.slice(valCount));
  }

  return { ok: true, train, validation, setAside };
}

export function preparationFingerprint(exam: readonly ExamLine[]): string {
  const payload = exam.map((line) => `${line.phrase}\t${line.team}`).join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

export function trieurPrepFiles(dir: string): { train: string; validation: string; resume: string; setAside: string } {
  const base = `${dir.replace(/\\/g, '/').replace(/\/+$/, '')}/preparation`;
  return {
    train: `${base}/train.jsonl`,
    validation: `${base}/validation.jsonl`,
    resume: `${base}/resume.json`,
    setAside: `${base}/ecartes.jsonl`,
  };
}
