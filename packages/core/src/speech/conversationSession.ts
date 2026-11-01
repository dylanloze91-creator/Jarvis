/**
 * Ce qui se passe après un réveil accepté. Les détecteurs (Vosk,
 * openWakeWord, vérificateur) ne sont pas ici : ils décident seulement
 * qu'un réveil est accepté. Ensuite :
 *
 * - grâce de 3 s : la captation de la commande ne peut pas se fermer, même
 *   si l'audio ressemble à du silence ;
 * - une fois la commande envoyée, le micro reste chaud pendant la réponse
 *   puis `followUpMs` après sa fin (8 s par défaut, 5.0.62) : les tours
 *   suivants n'exigent pas le mot de réveil. Passé ce délai sans parole,
 *   retour en veille (avant la 5.0.62, le micro restait ouvert sans fin) ;
 * - « tu connais Jarvis ? » réveille Vosk mais parle **de** lui : ignoré
 *   (`wakeWordAddress`, 5.0.62) ;
 * - « stop », « tais-toi », « merci c'est bon » reviennent en veille ;
 * - une hallucination Whisper ne compte pas comme un tour.
 *
 * Le temps est celui de l'audio (ms depuis le début de la capture), le même
 * que la fin de parole : les tests avancent ce temps sans horloge murale.
 */
import { DEFAULT_FOLLOW_UP_SECONDS, stripTrailingWakeWord, wakeWordAddress } from './addressee.js';
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
/**
 * Après la fin d'une réponse, l'utilisateur a ce délai pour enchaîner sans
 * dire « Jarvis » (réglage `voice.followUpSeconds`, 8 s par défaut).
 */
export const FOLLOW_UP_WINDOW_MS = DEFAULT_FOLLOW_UP_SECONDS * 1_000;

const STOP_PHRASES = new Set(['stop', 'tais toi', 'merci c est bon']);

export type ConversationPhase = 'standby' | 'command' | 'hot' | 'follow-up';

export type SpokenTurnDecision =
  | { kind: 'send'; text: string }
  | { kind: 'stop' }
  | { kind: 'ignore'; reason?: 'mention' };

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

  // « Tu connais Jarvis ? », « le Jarvis de mon frère » : on parle de lui, pas à lui.
  if (wakeWordAddress(trimmed, wake) === 'mention') return { kind: 'ignore', reason: 'mention' };

  if (role === 'command') {
    const command = stripTrailingWakeWord(commandAfterWakeWord(trimmed, wake), wake);
    if (!command) return { kind: 'ignore' };
    if (isConversationStop(command)) return { kind: 'stop' };
    return { kind: 'send', text: command };
  }

  if (!trimmed || isWhisperHallucination(trimmed)) return { kind: 'ignore' };
  if (!stripped || isWhisperHallucination(stripped)) return { kind: 'ignore' };
  if (isConversationStop(stripped)) return { kind: 'stop' };
  return { kind: 'send', text: stripTrailingWakeWord(stripped, wake) };
}

/**
 * Session d'écoute après le réveil. Les trames audio restent à l'appelant :
 * cette classe ne décide que si la captation a le droit de se fermer, et
 * si un texte transcrit est un tour, un arrêt, ou rien.
 */
export interface ConversationSessionOptions {
  /** Délai après la fin d'une réponse pour enchaîner sans mot de réveil. 0 : « Jarvis » à chaque fois. */
  followUpMs?: number;
}

export class ConversationSession {
  phase: ConversationPhase = 'standby';
  /** Vrai tant que la réponse (texte ou synthèse) n'est pas terminée. */
  awaitingReply = false;
  followUpMs: number;

  private wakeAt = 0;
  private replyEndsAt: number | null = null;

  constructor(options: ConversationSessionOptions = {}) {
    this.followUpMs = Math.max(0, options.followUpMs ?? FOLLOW_UP_WINDOW_MS);
  }

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
   * Parole pendant que le micro est chaud (réponse en cours ou après).
   * En dessous du seuil de début de commande, une toux ne lance pas un tour.
   */
  noteHotSpeech(_atMs: number, speechMs: number): 'wait' | 'capture' | 'standby' {
    if (this.phase !== 'hot') return 'wait';
    if (speechMs < COMMAND_STARTED_SPEECH_MS) return 'wait';
    this.phase = 'follow-up';
    return 'capture';
  }

  /**
   * Micro chaud : reste ouvert pendant la réponse, puis `followUpMs` après
   * sa fin. Au-delà, sans nouvelle parole, retour en veille.
   */
  pollHot(atMs: number): 'stay' | 'standby' {
    if (this.phase !== 'hot' || this.awaitingReply || this.replyEndsAt === null) return 'stay';
    if (atMs - this.replyEndsAt < this.followUpMs) return 'stay';
    this.enterStandby();
    return 'standby';
  }

  /**
   * La réponse est finie (fin de la synthèse, ou le texte si elle est
   * coupée). Ignoré si l'utilisateur a déjà repris la parole.
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
      // En suivi, parler de Jarvis à quelqu'un d'autre clôt la discussion.
      if (role === 'follow-up' && decision.reason !== 'mention') {
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

  /**
   * La phrase de suivi ne lui était pas destinée (vérification du destinataire
   * côté session) : la discussion s'arrête, « Jarvis » redevient nécessaire.
   */
  notAddressed(): void {
    this.enterStandby();
  }

  private enterStandby(): void {
    this.phase = 'standby';
    this.awaitingReply = false;
    this.replyEndsAt = null;
  }
}
