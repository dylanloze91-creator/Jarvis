/**
 * Ce qui se passe après un réveil accepté. Les détecteurs (Vosk,
 * openWakeWord, vérificateur) ne sont pas ici : ils décident seulement
 * qu'un réveil est accepté. Ensuite :
 *
 * - grâce de 3 s : la captation de la commande ne peut pas se fermer, même
 *   si l'audio ressemble à du silence ;
 * - une fois la commande envoyée, le micro reste chaud pendant la réponse
 *   et 8 s après sa fin. Une parole dans cette fenêtre est un nouveau tour,
 *   sans mot de réveil ;
 * - « stop », « tais-toi », « merci c'est bon » reviennent en veille ;
 * - une hallucination Whisper ne compte pas comme un tour et ne prolonge
 *   pas les 8 s.
 *
 * Le temps est celui de l'audio (ms depuis le début de la capture), le même
 * que la fin de parole : les tests avancent ce temps sans horloge murale.
 */
import { COMMAND_STARTED_SPEECH_MS } from './endOfSpeech.js';
import {
  commandAfterWakeWord,
  isWhisperHallucination,
  normalizeForWakeWordMatch,
  stripLeadingWakeWord,
  type WakeWordTextMatchConfig,
} from './wakeWordTextMatch.js';

/** La captation ouverte par un réveil ne peut pas se fermer avant ça. */
export const WAKE_GRACE_MS = 3_000;
/** Silence après la fin de la réponse, puis le mot de réveil redevient obligatoire. */
export const FOLLOW_UP_WINDOW_MS = 8_000;

const STOP_PHRASES = new Set(['stop', 'tais toi', 'merci c est bon']);

export type ConversationPhase = 'standby' | 'command' | 'hot' | 'follow-up';

export type SpokenTurnDecision =
  | { kind: 'send'; text: string }
  | { kind: 'stop' }
  | { kind: 'ignore' };

/** « stop », « tais-toi », « merci c'est bon » — retour immédiat en veille. */
export function isConversationStop(text: string): boolean {
  return STOP_PHRASES.has(normalizeForWakeWordMatch(text));
}

function withoutSilenceTail(text: string): string {
  return text
    .replace(/(?:\s*(?:\.{2,}|…)+)+\s*$/u, '')
    .replace(/\s+\?$/u, '')
    .trim();
}

/**
 * Texte à envoyer, ou à ignorer. `command` retire le mot de réveil déjà
 * confirmé (une commande d'un seul mot non reconnu n'est pas envoyée).
 * `follow-up` accepte une vraie parole sans mot de réveil, y compris un
 * seul mot (« pause »), et refuse les queues hallucinées.
 */
export function classifySpokenTurn(
  transcript: string,
  role: 'command' | 'follow-up',
  wake: WakeWordTextMatchConfig,
): SpokenTurnDecision {
  const trimmed = transcript.trim();
  const stripped = withoutSilenceTail(stripLeadingWakeWord(trimmed, wake));
  if (isConversationStop(trimmed) || (stripped !== trimmed && isConversationStop(stripped))) {
    return { kind: 'stop' };
  }

  if (role === 'command') {
    const command = commandAfterWakeWord(trimmed, wake);
    if (!command) return { kind: 'ignore' };
    if (isConversationStop(command)) return { kind: 'stop' };
    return { kind: 'send', text: command };
  }

  if (!trimmed || isWhisperHallucination(trimmed)) return { kind: 'ignore' };
  if (!stripped || isWhisperHallucination(stripped)) return { kind: 'ignore' };
  if (isConversationStop(stripped)) return { kind: 'stop' };
  return { kind: 'send', text: stripped };
}

/**
 * Session d'écoute après le réveil. Les trames audio restent à l'appelant :
 * cette classe ne décide que si la captation a le droit de se fermer, et
 * si un texte transcrit est un tour, un arrêt, ou rien.
 */
export class ConversationSession {
  phase: ConversationPhase = 'standby';
  /** Vrai tant que la réponse (texte ou synthèse) n'est pas terminée. */
  awaitingReply = false;

  private wakeAt = 0;
  private replyEndsAt: number | null = null;

  /** Veille : le mot de réveil est de nouveau obligatoire, l'orbe au repos. */
  get acceptsWakeWord(): boolean {
    return this.phase === 'standby';
  }

  /** Orbe et pastille « Jarvis écoute » : toute la session, pas seulement la première commande. */
  get showListening(): boolean {
    return this.phase !== 'standby';
  }

  /** Fin au plus tôt de la grâce ouverte par le dernier réveil accepté. */
  get graceDeadline(): number {
    return this.wakeAt + WAKE_GRACE_MS;
  }

  /**
   * Réveil accepté. Un second « Jarvis » pendant la grâce, la réponse ou
   * le suivi ne recommence pas la commande et ne décale pas la grâce.
   */
  acceptWake(atMs: number): 'started' | 'ignored' {
    if (this.phase !== 'standby') return 'ignored';
    this.phase = 'command';
    this.wakeAt = atMs;
    this.awaitingReply = false;
    this.replyEndsAt = null;
    return 'started';
  }

  /**
   * Fin de parole pendant la commande qui suit le réveil.
   * `hold` tant que les 3 s ne sont pas écoulées, même si le détecteur
   * a déjà vu du silence.
   */
  pollCommand(atMs: number, endOfSpeech: boolean): 'hold' | 'close' {
    if (this.phase !== 'command') return 'hold';
    if (!endOfSpeech) return 'hold';
    if (atMs < this.graceDeadline) return 'hold';
    return 'close';
  }

  /**
   * Parole pendant que le micro est chaud (réponse en cours, ou 8 s après).
   * En dessous du seuil de début de commande, une toux ne lance pas un tour.
   */
  noteHotSpeech(atMs: number, speechMs: number): 'wait' | 'capture' | 'standby' {
    if (this.phase !== 'hot') return 'wait';
    if (this.followUpExpired(atMs)) {
      this.enterStandby();
      return 'standby';
    }
    if (speechMs < COMMAND_STARTED_SPEECH_MS) return 'wait';
    this.phase = 'follow-up';
    return 'capture';
  }

  /** 8 s de silence après la fin de la réponse : retour en veille. */
  pollHot(atMs: number): 'stay' | 'standby' {
    if (this.phase !== 'hot') return 'stay';
    if (!this.followUpExpired(atMs)) return 'stay';
    this.enterStandby();
    return 'standby';
  }

  /**
   * La réponse est finie (fin de la synthèse, ou le texte si elle est
   * coupée). Ouvre les 8 s. Ignoré si l'utilisateur a déjà repris la parole.
   */
  replyFinished(atMs: number): void {
    if (this.phase !== 'hot') return;
    this.awaitingReply = false;
    this.replyEndsAt = atMs;
  }

  /** Transcription d'une commande (après réveil) ou d'un suivi. */
  deliver(transcript: string, wake: WakeWordTextMatchConfig): SpokenTurnDecision {
    if (this.phase !== 'command' && this.phase !== 'follow-up') return { kind: 'ignore' };
    const role = this.phase === 'follow-up' ? 'follow-up' : 'command';
    const decision = classifySpokenTurn(transcript, role, wake);
    if (decision.kind === 'stop') {
      this.enterStandby();
      return decision;
    }
    if (decision.kind === 'ignore') {
      if (role === 'follow-up') {
        this.phase = 'hot';
        return decision;
      }
      this.enterStandby();
      return decision;
    }
    this.phase = 'hot';
    this.awaitingReply = true;
    this.replyEndsAt = null;
    return decision;
  }

  standby(): void {
    this.enterStandby();
  }

  private followUpExpired(atMs: number): boolean {
    if (this.awaitingReply || this.replyEndsAt === null) return false;
    return atMs - this.replyEndsAt >= FOLLOW_UP_WINDOW_MS;
  }

  private enterStandby(): void {
    this.phase = 'standby';
    this.awaitingReply = false;
    this.replyEndsAt = null;
  }
}
