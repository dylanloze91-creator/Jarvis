import { createHash } from 'node:crypto';
import type { ChatMessage, Conversation } from '../types.js';
import { routerUserPrompt } from '../agent/orchestra.js';
import type { OrchestraTeam } from '../agent/orchestraTeams.js';
import { ORCHESTRA_TEAMS } from '../agent/orchestraTeams.js';

/** Entrée lue dans `a-trier.jsonl`. */
export interface ToSortLine {
  id: string;
  phrase: string;
  context: string;
  /** Équipe enregistrée à l'époque ; jamais utilisée comme réponse d'examen. */
  suggestion: OrchestraTeam | null;
  /** Origine de la phrase (ex. export claude.ai). */
  source?: 'claude.ai';
  /** Marqueur de test synthétique (jamais copié dans un cahier). */
  synthetiqueTest?: boolean;
}

/** Ligne écrite dans `examen.jsonl`. */
export interface ExamLine {
  phrase: string;
  context: string;
  team: OrchestraTeam | 'unknown' | 'not_a_request';
}

/** Journal optionnel dans un fichier conversation (équipe choisie à l'époque). */
export interface ConversationRouteLog {
  userMessageId: string;
  team: string;
  how?: string;
}

export interface StoredConversation extends Conversation {
  routeLog?: ConversationRouteLog[];
}

export function normalizePhrase(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function contextForUserMessage(messages: ChatMessage[], userIndex: number): string {
  const history = messages.slice(0, userIndex);
  const user = messages[userIndex];
  if (!user || user.role !== 'user') return '';
  return routerUserPrompt(user.content, history);
}

function suggestionForMessage(
  messageId: string,
  routeLog: ConversationRouteLog[] | undefined,
): OrchestraTeam | null {
  if (!routeLog?.length) return null;
  const hit = routeLog.find((entry) => entry.userMessageId === messageId);
  if (!hit) return null;
  const team = hit.team as OrchestraTeam;
  return ORCHESTRA_TEAMS.includes(team) ? team : null;
}

export function phraseKey(phrase: string, context: string): string {
  const payload = `${normalizePhrase(phrase)}\n${context.trim()}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Extrait les messages utilisateur des conversations enregistrées (un JSON par fichier).
 * Doublons (même phrase + contexte) fusionnés ; phrases vides ignorées.
 */
export function extractFromConversations(
  conversations: readonly StoredConversation[],
): ToSortLine[] {
  const byKey = new Map<string, ToSortLine>();
  for (const conversation of conversations) {
    for (let index = 0; index < conversation.messages.length; index += 1) {
      const message = conversation.messages[index]!;
      if (message.role !== 'user') continue;
      const phrase = normalizePhrase(message.content);
      if (!phrase) continue;
      const context = contextForUserMessage(conversation.messages, index);
      const key = phraseKey(phrase, context);
      const existing = byKey.get(key);
      const suggestion = suggestionForMessage(message.id, conversation.routeLog);
      if (existing) {
        if (!existing.suggestion && suggestion) existing.suggestion = suggestion;
        continue;
      }
      byKey.set(key, {
        id: key,
        phrase,
        context,
        suggestion,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.phrase.localeCompare(b.phrase, 'fr'));
}

export function parseToSortLine(raw: unknown): ToSortLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.phrase !== 'string' || typeof row.context !== 'string') return null;
  const phrase = normalizePhrase(row.phrase);
  if (!phrase) return null;
  const id = typeof row.id === 'string' && row.id ? row.id : phraseKey(phrase, String(row.context));
  let suggestion: OrchestraTeam | null = null;
  if (typeof row.suggestion === 'string' && ORCHESTRA_TEAMS.includes(row.suggestion as OrchestraTeam)) {
    suggestion = row.suggestion as OrchestraTeam;
  }
  const synthetiqueTest = row.meta && typeof row.meta === 'object' && (row.meta as Record<string, unknown>)['synthetique-test'] === true;
  const source = row.source === 'claude.ai' ? 'claude.ai' : undefined;
  return {
    id,
    phrase,
    context: String(row.context),
    suggestion,
    ...(source ? { source } : {}),
    ...(synthetiqueTest ? { synthetiqueTest: true } : {}),
  };
}

export function parseExamLine(raw: unknown): ExamLine | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.phrase !== 'string' || typeof row.context !== 'string' || typeof row.team !== 'string') return null;
  const team = row.team as ExamLine['team'];
  if (team !== 'unknown' && team !== 'not_a_request' && !ORCHESTRA_TEAMS.includes(team as OrchestraTeam)) return null;
  return { phrase: normalizePhrase(row.phrase), context: String(row.context), team };
}

/** Compte par équipe dans l'examen (hors « je ne sais pas » et « pas une demande »). */
export function examTeamCounts(lines: readonly ExamLine[]): Record<OrchestraTeam, number> {
  const counts = Object.fromEntries(ORCHESTRA_TEAMS.map((team) => [team, 0])) as Record<OrchestraTeam, number>;
  for (const line of lines) {
    if (ORCHESTRA_TEAMS.includes(line.team as OrchestraTeam)) counts[line.team as OrchestraTeam] += 1;
  }
  return counts;
}

export const EXAM_TARGET = { min: 150, max: 300, perTeamHint: 12 } as const;

export function examBalanceMessage(counts: Record<OrchestraTeam, number>, total: number): string {
  const missing = ORCHESTRA_TEAMS.filter((team) => counts[team] < EXAM_TARGET.perTeamHint);
  const parts = [`${total} phrase(s) classée(s) (objectif ${EXAM_TARGET.min}–${EXAM_TARGET.max}).`];
  if (missing.length) {
    parts.push(`Équipes avec peu de phrases (< ${EXAM_TARGET.perTeamHint}) : ${missing.map((t) => TEAM_LABEL[t]).join(', ')}.`);
  }
  return parts.join(' ');
}

const TEAM_LABEL: Record<OrchestraTeam, string> = {
  conversation: 'Conversation',
  pc: 'PC',
  fichiers: 'Fichiers',
  web: 'Internet',
  musique: 'Musique',
  concentration: 'Concentration',
  memoire: 'Mémoire',
  google: 'Google',
  code: 'Code',
  images: 'Images',
};

export { TEAM_LABEL as trieurTeamLabels };
