/**
 * Décide quels ratés noter. Règles seulement : aucun appel de modèle,
 * aucun changement de ce que Jarvis enverrait au modèle.
 */
import { detectCurrentInfoIntent } from '../agent/currentInfo.js';
import { looksLikeWebResearchIntent } from '../agent/agent.js';
import { ORCHESTRA_TEAMS, teamHasTool, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { looksLikeGoogleIntent } from '../google/intent.js';
import { looksLikeImageIntent } from '../images/intent.js';
import { extractKnowledgeIntent } from '../knowledge/intent.js';
import { classifyUtterance } from '../learning/continuous.js';
import { isMusicIntent } from '../media/playIntent.js';
import { extractSiteBlockIntent } from '../siteblock/intent.js';
import {
  DEFAULT_INTERRUPTION_WINDOW_MS,
  DEFAULT_REPETITION_OVERLAP,
  DEFAULT_REPETITION_WINDOW_MS,
  DEFAULT_SPEAKER_FIRST_SOUND_MS,
  DEFAULT_WINDOW_FIRST_WORD_MS,
  type CarnetHow,
  type ObservedTurn,
  type PreviousTurn,
  type RateDetection,
  type ToolLine,
} from './types.js';
import {
  isFailureReport,
  isJarvisSilence,
  isNewRequestDespiteNon,
  isRequestedDownload,
  isSpotifyAddressedStop,
  isToldYouCorrection,
  isVoluntaryRepeat,
  wordOverlap,
} from './text.js';

export interface DetectOptions {
  repetitionWindowMs?: number;
  repetitionOverlap?: number;
  interruptionWindowMs?: number;
  windowFirstWordMs?: number;
  speakerFirstSoundMs?: number;
}

const TEAMS = new Set<string>(ORCHESTRA_TEAMS);

function asTeam(team: string | null): OrchestraTeam | null {
  if (!team || !TEAMS.has(team)) return null;
  return team as OrchestraTeam;
}

function fromTurn(turn: ObservedTurn, rule: string, type: RateDetection['type']): RateDetection {
  return {
    type,
    rule,
    userText: turn.userText,
    replyText: turn.replyText,
    team: turn.team,
    model: turn.model,
    how: turn.how,
    tools: turn.tools,
    durations: turn.durations,
  };
}

function fromPrevious(
  previous: PreviousTurn,
  rule: string,
  type: RateDetection['type'],
  how: CarnetHow | null = previous.how,
): RateDetection {
  return {
    type,
    rule,
    userText: previous.userText,
    replyText: previous.replyText,
    team: previous.team,
    model: previous.model,
    how,
    tools: previous.tools,
    durations: previous.durations,
  };
}

function wantedToolNames(text: string): string[] {
  const names: string[] = [];
  if (isMusicIntent(text)) names.push('spotify_play');
  if (looksLikeGoogleIntent(text)) names.push('google_gmail_list');
  if (looksLikeImageIntent(text)) names.push('generer_image');
  if (looksLikeWebResearchIntent(text) || detectCurrentInfoIntent(text)) names.push('web_search');
  const memory = extractKnowledgeIntent(text);
  if (memory) names.push(memory.tool);
  const block = extractSiteBlockIntent(text);
  if (block) names.push(block.tool);
  return names;
}

function sameFamily(wanted: string, actual: string): boolean {
  if (wanted === actual) return true;
  const cut = wanted.indexOf('_');
  if (cut <= 0) return false;
  return actual.startsWith(`${wanted.slice(0, cut + 1)}`);
}

function wantedWasServed(wanted: readonly string[], tools: readonly ToolLine[]): boolean {
  return tools.some(
    (tool) => tool.status === 'ok' && wanted.some((name) => sameFamily(name, tool.name)),
  );
}

function teamLacksWantedTool(turn: ObservedTurn): boolean {
  if (turn.how !== 'cerveau' && turn.how !== 'trieur') return false;
  const wanted = wantedToolNames(turn.userText);
  if (!wanted.length || wantedWasServed(wanted, turn.tools)) return false;
  const team = asTeam(turn.team);
  if (!team) return true;
  return !wanted.some((name) => teamHasTool(team, name));
}

type ToolFate =
  'ok' | 'user-refused' | 'timeout' | 'verification_failed' | 'error' | 'unwanted-refusal';

export function classifyToolLine(tool: ToolLine): ToolFate {
  const line = tool.line.toLowerCase();
  const outcome = (tool.outcome ?? '').toLowerCase();
  if (tool.status === 'ok' && outcome !== 'verification_failed' && outcome !== 'timeout')
    return 'ok';
  if (/utilisateur a refusé cette action/.test(line)) return 'user-refused';
  if (outcome === 'verification_failed' || line.includes('verification_failed'))
    return 'verification_failed';
  if (
    outcome === 'timeout' ||
    /timeout|délai dépassé|delai depasse|n'a pas répondu à temps|pas répondu à temps/.test(line)
  ) {
    return 'timeout';
  }
  if (tool.status === 'denied') return 'unwanted-refusal';
  if (
    tool.status === 'error' ||
    outcome === 'definitive' ||
    outcome === 'recoverable' ||
    outcome === 'missing_dependency'
  ) {
    return 'error';
  }
  return 'ok';
}

const TOOL_RULE: Record<Exclude<ToolFate, 'ok' | 'user-refused'>, string> = {
  timeout: 'outil-delai',
  verification_failed: 'outil-verification-failed',
  error: 'outil-erreur',
  'unwanted-refusal': 'outil-refus',
};

function correctionRule(text: string): string | null {
  if (isNewRequestDespiteNon(text)) return null;
  if (isToldYouCorrection(text)) return 'correction-je-t-ai-dit';
  if (classifyUtterance(text) !== 'one-off') return 'correction-classify';
  return null;
}

function interruptionRule(turn: ObservedTurn, windowMs: number): string | null {
  const cut = turn.cut;
  if (!cut || cut.afterMs < 0 || cut.afterMs > windowMs) return null;
  const text = cut.text ?? '';
  if (text && isSpotifyAddressedStop(text)) return null;
  if (cut.button) return 'interruption-bouton';
  const silence = text ? isJarvisSilence(text) : null;
  if (silence === 'stop') return 'interruption-stop';
  if (silence === 'tais-toi') return 'interruption-tais-toi';
  if (cut.speech) return 'interruption-parole';
  return null;
}

/**
 * Ratés de ce tour. Tableau vide si rien de sûr.
 * « Ça n'a pas marché » note le tour précédent et s'arrête : la phrase elle-même n'est pas un autre raté.
 */
export function detectRates(turn: ObservedTurn, options: DetectOptions = {}): RateDetection[] {
  if (isFailureReport(turn.userText)) {
    if (!turn.previous?.replyText.trim()) return [];
    return [fromPrevious(turn.previous, 'signale-phrase', 'signale')];
  }

  const found: RateDetection[] = [];
  const repetitionWindow = options.repetitionWindowMs ?? DEFAULT_REPETITION_WINDOW_MS;
  const overlapMin = options.repetitionOverlap ?? DEFAULT_REPETITION_OVERLAP;
  const interruptWindow = options.interruptionWindowMs ?? DEFAULT_INTERRUPTION_WINDOW_MS;
  const windowFirst = options.windowFirstWordMs ?? DEFAULT_WINDOW_FIRST_WORD_MS;
  const speakerFirst = options.speakerFirstSoundMs ?? DEFAULT_SPEAKER_FIRST_SOUND_MS;

  if (turn.thumbDown) found.push(fromTurn(turn, 'signale-pouce', 'signale'));

  const previous = turn.previous;
  if (previous?.replyText.trim()) {
    const correction = correctionRule(turn.userText);
    if (correction) {
      found.push({
        ...fromPrevious(previous, correction, 'correction'),
        userText: turn.userText,
      });
    }
    const age = turn.at - previous.at;
    const voluntary =
      isVoluntaryRepeat(turn.userText) && classifyUtterance(turn.userText) === 'one-off';
    if (
      !voluntary &&
      age >= 0 &&
      age <= repetitionWindow &&
      wordOverlap(turn.userText, previous.userText) >= overlapMin
    ) {
      found.push({
        ...fromPrevious(previous, 'repetition-70-3min', 'repetition'),
        userText: turn.userText,
      });
    }
  }

  const interrupt = interruptionRule(turn, interruptWindow);
  if (interrupt) found.push(fromTurn(turn, interrupt, 'interruption'));

  for (const tool of turn.tools) {
    const fate = classifyToolLine(tool);
    if (fate === 'ok' || fate === 'user-refused') continue;
    found.push(fromTurn(turn, TOOL_RULE[fate], 'outil_echec'));
  }

  if (!isRequestedDownload(turn.userText)) {
    if (turn.place.kind === 'enceinte') {
      if (turn.speakerFirstSoundMs !== null && turn.speakerFirstSoundMs > speakerFirst) {
        found.push(fromTurn(turn, 'lenteur-enceinte', 'lenteur'));
      }
    } else if (turn.firstWordMs !== null && turn.firstWordMs > windowFirst) {
      found.push(fromTurn(turn, 'lenteur-fenetre', 'lenteur'));
    }
  }

  if (turn.brainUnreadable) {
    found.push({ ...fromTurn(turn, 'chemin-illisible', 'chemin'), how: 'chemin-avant' });
  }
  if (teamLacksWantedTool(turn)) found.push(fromTurn(turn, 'chemin-sans-outil', 'chemin'));

  return found;
}
