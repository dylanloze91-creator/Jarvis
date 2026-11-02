import { createHash } from 'node:crypto';
import { randomId } from '../types.js';
import { expressTeam, routerSystemPrompt, routerUserPrompt } from '../agent/orchestra.js';
import { ORCHESTRA_TEAMS, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { availableTeams } from '../agent/orchestra.js';
import { examContamination, trieurTextSimilarity } from './similarity.js';
import type { ExamLine } from './extract.js';
import { normalizePhrase, phraseKey } from './extract.js';

export interface TrieurSeed {
  team: OrchestraTeam;
  style: 'short' | 'question' | 'spoken' | 'jarvis' | 'followup' | 'trap';
  length: 'short' | 'medium';
  followup?: boolean;
  trapPair?: [OrchestraTeam, OrchestraTeam];
}

export interface GeneratedTrieurExample {
  id: string;
  team: OrchestraTeam;
  phrase: string;
  context: string;
  messages: [
    { role: 'system'; content: string },
    { role: 'user'; content: string },
    { role: 'assistant'; content: string },
  ];
  meta: { team: OrchestraTeam; seed: TrieurSeed; model?: string };
}

export interface TeacherReply {
  phrase: string;
  context?: string;
  team: string;
}

export interface GenerateContext {
  exam: readonly ExamLine[];
  accepted: GeneratedTrieurExample[];
  examLines: readonly { phrase: string; context: string }[];
  teams: OrchestraTeam[];
  systemPrompt: string;
}

const ALL_TOOLS = [
  'get_system_info',
  'search_files',
  'web_search',
  'play_spotify',
  'siteblock_set_blocking',
  'search_jarvis_memory',
  'google_gmail_list',
  'write_file',
];

const TRAP_PAIRS: [OrchestraTeam, OrchestraTeam][] = [
  ['musique', 'web'],
  ['memoire', 'conversation'],
  ['fichiers', 'pc'],
  ['google', 'web'],
  ['code', 'conversation'],
];

export function seedFor(index: number, salt = ''): TrieurSeed {
  const teams = ORCHESTRA_TEAMS;
  const styles: TrieurSeed['style'][] = ['short', 'question', 'spoken', 'jarvis', 'followup', 'trap'];
  const team = teams[index % teams.length]!;
  const style = styles[(index + salt.length) % styles.length]!;
  const trapPair = TRAP_PAIRS[index % TRAP_PAIRS.length];
  return {
    team,
    style,
    length: index % 2 ? 'medium' : 'short',
    followup: style === 'followup',
    trapPair: style === 'trap' ? trapPair : undefined,
  };
}

export function buildTrainingLine(
  team: OrchestraTeam,
  phrase: string,
  historyContext: string,
  teams: OrchestraTeam[],
  seed: TrieurSeed,
): GeneratedTrieurExample {
  const systemPrompt = routerSystemPrompt(teams);
  const userContent = historyContext.trim()
    ? historyContext
    : routerUserPrompt(phrase, []);
  const id = `trieur-${phraseKey(phrase, userContent)}-${randomId().slice(0, 8)}`;
  return {
    id,
    team,
    phrase: normalizePhrase(phrase),
    context: userContent,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
      { role: 'assistant', content: team },
    ],
    meta: { team, seed },
  };
}

export function validateGenerated(
  raw: TeacherReply,
  seed: TrieurSeed,
  ctx: GenerateContext,
): { ok: true; example: GeneratedTrieurExample; seed: TrieurSeed } | { ok: false; reason: string } {
  const phrase = normalizePhrase(raw.phrase ?? '');
  if (!phrase) return { ok: false, reason: 'phrase vide' };
  const team = String(raw.team ?? '').trim() as OrchestraTeam;
  if (!ORCHESTRA_TEAMS.includes(team)) return { ok: false, reason: 'équipe inconnue' };
  const userContext = raw.context?.trim() ? raw.context.trim() : routerUserPrompt(phrase, []);
  const example = buildTrainingLine(team, phrase, userContext, ctx.teams, seed);

  const available = new Set(ctx.teams);
  const express = expressTeam({ text: phrase, history: [], available });
  if (express && express !== team) return { ok: false, reason: `express désigne ${express}, pas ${team}` };

  const contam = examContamination(phrase, userContext, ctx.examLines);
  if (contam) return { ok: false, reason: contam };

  for (const other of ctx.accepted) {
    const sim = trieurTextSimilarity(`${phrase}\n${userContext}`, `${other.phrase}\n${other.context}`);
    if (sim >= 0.4) return { ok: false, reason: `doublon (${sim.toFixed(2)})` };
    if (other.phrase === phrase && other.context === userContext) return { ok: false, reason: 'doublon exact' };
  }

  return { ok: true, example, seed };
}

export function teacherPrompt(seed: TrieurSeed): string {
  const trap =
    seed.trapPair && seed.style === 'trap'
      ? `Piège : phrase ambiguë entre ${seed.trapPair[0]} et ${seed.trapPair[1]}.`
      : '';
  return [
    'Tu inventes UNE phrase que dirait un utilisateur français à son assistant Jarvis sur son PC.',
    `L'équipe correcte est : ${seed.team}.`,
    `Style : ${seed.style}. ${trap}`,
    seed.followup ? 'C\'est une suite (« et ferme-le », « et demain ? ») : fournis aussi le contexte (conversation récente + demande) comme dans l\'exemple.' : '',
    'Réponds en JSON strict : {"phrase":"...","context":"... optionnel","team":"..."}',
    'Le contexte, s\'il est présent, doit reprendre le format « Conversation récente » puis « Demande » puis « Équipe : ».',
    'N\'invente pas de données personnelles réelles.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseTeacherJson(raw: string): TeacherReply | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as TeacherReply;
    if (typeof parsed.phrase !== 'string' || typeof parsed.team !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createGenerateContext(exam: ExamLine[]): GenerateContext {
  const teams = availableTeams(ALL_TOOLS);
  return {
    exam,
    accepted: [],
    examLines: exam.map((line) => ({ phrase: line.phrase, context: line.context })),
    teams,
    systemPrompt: routerSystemPrompt(teams),
  };
}

export function teamBalanceWarning(accepted: readonly GeneratedTrieurExample[]): string | null {
  const counts = Object.fromEntries(ORCHESTRA_TEAMS.map((team) => [team, 0])) as Record<OrchestraTeam, number>;
  for (const row of accepted) counts[row.team] += 1;
  const min = Math.min(...ORCHESTRA_TEAMS.map((team) => counts[team]));
  const max = Math.max(...ORCHESTRA_TEAMS.map((team) => counts[team]));
  if (max - min > 50) return 'déséquilibre fort entre équipes';
  return null;
}

export function exactKey(example: GeneratedTrieurExample): string {
  return createHash('sha256').update(`${example.phrase}\n${example.context}`).digest('hex');
}
