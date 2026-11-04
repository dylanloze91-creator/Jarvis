import type { OrchestraTeam } from '../agent/orchestraTeams.js';
import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';
import { availableTeams } from '../agent/orchestra.js';
import type { ExamLine } from './extract.js';
import { normalizePhrase, phraseKey } from './extract.js';
import { buildTrainingLine, type GeneratedTrieurExample } from './generator.js';
import { TRIEUR_PREP_DEFAULTS } from './trainPrep.js';
import type { ValidationPath } from './validationSettings.js';
export {
  teamValidationEnabled,
  validationPathForHow,
  type ValidationPath,
} from './validationSettings.js';

export type ValidationStatut = 'confirme' | 'corrige';

/** Ligne écrite dans `valide.jsonl` (données utilisateur, jamais commitée). */
export interface ValidationLine {
  phrase: string;
  context: string;
  equipe: OrchestraTeam;
  equipeProposee: OrchestraTeam;
  chemin: ValidationPath;
  statut: ValidationStatut;
  date: string;
}

export const VALIDATION_FILE = 'valide.jsonl';
export const TRIEUR_MIN_EXAM_PER_TEAM = 20;

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

export function parseValidationLine(raw: unknown): ValidationLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.phrase !== 'string' || typeof row.context !== 'string') return null;
  const phrase = row.phrase;
  if (!phrase.trim()) return null;
  const equipe = row.equipe;
  const equipeProposee = row.equipeProposee;
  if (typeof equipe !== 'string' || !ORCHESTRA_TEAMS.includes(equipe as OrchestraTeam)) return null;
  if (typeof equipeProposee !== 'string' || !ORCHESTRA_TEAMS.includes(equipeProposee as OrchestraTeam)) {
    return null;
  }
  const chemin = row.chemin;
  if (chemin !== 'express' && chemin !== 'cerveau' && chemin !== 'trieur') return null;
  const statut = row.statut;
  if (statut !== 'confirme' && statut !== 'corrige') return null;
  if (typeof row.date !== 'string' || !row.date) return null;
  return {
    phrase,
    context: String(row.context),
    equipe: equipe as OrchestraTeam,
    equipeProposee: equipeProposee as OrchestraTeam,
    chemin,
    statut,
    date: row.date,
  };
}

export function serializeValidationLine(line: ValidationLine): string {
  return `${JSON.stringify(line)}\n`;
}

function hashBucket(key: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Examen manuel (`examen.jsonl`) : compte par équipe pour la règle des corrections. */
export function examTeamCounts(exam: readonly ExamLine[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of exam) {
    if (!ORCHESTRA_TEAMS.includes(line.team as OrchestraTeam)) continue;
    const team = line.team as string;
    counts[team] = (counts[team] ?? 0) + 1;
  }
  return counts;
}

/**
 * Découpe une ligne validée en direct : les corrections vont à l'examen tant qu'une équipe
 * a moins de 20 phrases d'examen (manuel + validé déjà affecté) ; sinon partage déterministe
 * (hash, même graine que `trieur:preparer`).
 */
export function validationSplitTarget(
  line: ValidationLine,
  examCountsByTeam: Record<string, number>,
  validationShare: number = TRIEUR_PREP_DEFAULTS.validationShare,
  seed: number = TRIEUR_PREP_DEFAULTS.seed,
): 'exam' | 'train' {
  const key = phraseKey(line.phrase, line.context);
  if (line.statut === 'corrige' && (examCountsByTeam[line.equipe] ?? 0) < TRIEUR_MIN_EXAM_PER_TEAM) {
    return 'exam';
  }
  const bucket = hashBucket(key, seed);
  return bucket < validationShare ? 'train' : 'exam';
}

export function validationToExamLine(line: ValidationLine): ExamLine {
  return {
    phrase: normalizePhrase(line.phrase),
    context: line.context,
    team: line.equipe,
  };
}

export function validationToTrainingExample(line: ValidationLine): GeneratedTrieurExample {
  const teams = availableTeams(ALL_TOOLS);
  const example = buildTrainingLine(line.equipe, line.phrase, line.context, teams, {
    team: line.equipe,
    style: 'short',
    length: 'short',
  });
  return { ...example, id: `valide-${phraseKey(line.phrase, line.context)}` };
}

export interface ValidationSplitResult {
  exam: ExamLine[];
  trainLines: string[];
}

/** Répartit les lignes `valide.jsonl` entre l'examen du banc et l'entraînement. */
export function splitValidationLines(
  lines: readonly ValidationLine[],
  manualExam: readonly ExamLine[],
  options?: { validationShare?: number; seed?: number },
): ValidationSplitResult {
  const validationShare = options?.validationShare ?? TRIEUR_PREP_DEFAULTS.validationShare;
  const seed = options?.seed ?? TRIEUR_PREP_DEFAULTS.seed;
  const examCounts = examTeamCounts(manualExam);
  const exam: ExamLine[] = [];
  const trainLines: string[] = [];

  for (const line of lines) {
    const target = validationSplitTarget(line, examCounts, validationShare, seed);
    if (target === 'exam') {
      exam.push(validationToExamLine(line));
      examCounts[line.equipe] = (examCounts[line.equipe] ?? 0) + 1;
    } else {
      trainLines.push(JSON.stringify(validationToTrainingExample(line)));
    }
  }

  return { exam, trainLines };
}

export function validationRecord(input: {
  phrase: string;
  context: string;
  proposedTeam: OrchestraTeam;
  chosenTeam: OrchestraTeam;
  path: ValidationPath;
  at?: Date;
}): ValidationLine {
  const statut: ValidationStatut = input.chosenTeam === input.proposedTeam ? 'confirme' : 'corrige';
  return {
    phrase: input.phrase,
    context: input.context,
    equipe: input.chosenTeam,
    equipeProposee: input.proposedTeam,
    chemin: input.path,
    statut,
    date: (input.at ?? new Date()).toISOString(),
  };
}
