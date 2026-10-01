/**
 * Étiquetage automatique des extraits de réveil, sans rien demander :
 *
 * - réveil suivi d'une vraie commande → positif (réveil réussi) ;
 * - réveil annulé par l'utilisateur → négatif (faux réveil) ;
 * - réveil suivi d'un texte vide ou halluciné → négatif, mais seulement si
 *   aucun réveil réussi ne suit dans la fenêtre de reprise (sinon douteux) ;
 * - candidat refusé (veto, quasi-réveil) puis « Jarvis » répété qui réveille
 *   et donne une commande dans la fenêtre → positif (raté rattrapé) ;
 * - erreur de transcription, candidat refusé sans reprise → ignoré.
 *
 * Pur et piloté par le temps donné en entrée : testable sans horloge.
 */
import { isWhisperHallucination, normalizeForWakeWordMatch } from '../wakeWordTextMatch.js';

/** « Jarvis » répété dans ce délai = même tentative. */
export const WAKE_RETRY_WINDOW_MS = 8_000;
/**
 * Un candidat refusé moins de 1,5 s avant le réveil est le même « Jarvis »
 * (openWakeWord juste sous le seuil, puis Vosk qui confirme) : pas un raté.
 */
export const WAKE_SAME_UTTERANCE_MS = 1_500;

export type WakeOutcome = 'command' | 'empty' | 'hallucination' | 'cancelled' | 'error';
export type WakeLabel = 'positive' | 'negative';
export type WakeStatKind = 'success' | 'miss' | 'false-wake';

export interface WakeCandidateEvent {
  id: string;
  at: number;
  /** `true` si le réveil a été accepté (dictée lancée). */
  accepted: boolean;
}

export interface WakeLabelDecision {
  id: string;
  label: WakeLabel;
  reason: 'command' | 'retry' | 'cancelled' | 'empty' | 'hallucination';
}

export interface WakeLabelerOutput {
  labels: WakeLabelDecision[];
  stats: WakeStatKind[];
  /** Extraits à oublier (douteux) : pas d'étiquette, pas de fichier. */
  discard: string[];
}

const CANCEL_PHRASES = new Set([
  'annule',
  'annuler',
  'laisse tomber',
  'rien',
  'non rien',
  'non',
  'stop',
  'tais toi',
  'oublie',
  'cancel',
  'pas toi',
  'je ne te parlais pas',
  'je parlais pas a toi',
]);

/** Une phrase d'annulation (« annule », « laisse tomber », « non rien »…). */
export function isCancelCommand(text: string): boolean {
  return CANCEL_PHRASES.has(normalizeForWakeWordMatch(text));
}

/** Classe le texte reçu après un réveil (déjà débarrassé du mot de réveil). */
export function classifyWakeOutcome(command: string, failed = false): WakeOutcome {
  if (failed) return 'error';
  const trimmed = command.trim();
  if (!trimmed) return 'empty';
  if (isWhisperHallucination(trimmed)) return 'hallucination';
  if (isCancelCommand(trimmed)) return 'cancelled';
  return 'command';
}

interface PendingRejected {
  id: string;
  at: number;
}

interface PendingNegative {
  id: string;
  at: number;
  reason: 'empty' | 'hallucination';
}

export class WakeLabeler {
  private rejected: PendingRejected[] = [];
  private negatives: PendingNegative[] = [];
  private accepted = new Map<string, number>();

  constructor(private readonly retryWindowMs = WAKE_RETRY_WINDOW_MS) {}

  /** Nouveau candidat (accepté ou refusé). Les plus anciens sont réglés d'abord. */
  candidate(event: WakeCandidateEvent): WakeLabelerOutput {
    const output = this.expire(event.at);
    if (event.accepted) this.accepted.set(event.id, event.at);
    else this.rejected.push({ id: event.id, at: event.at });
    return output;
  }

  /** Issue d'un réveil accepté. */
  outcome(id: string, outcome: WakeOutcome, at: number): WakeLabelerOutput {
    const output = this.expire(at);
    const wokeAt = this.accepted.get(id);
    this.accepted.delete(id);
    if (wokeAt === undefined) return output;

    if (outcome === 'command') {
      output.labels.push({ id, label: 'positive', reason: 'command' });
      output.stats.push('success');
      for (const missed of this.rejected) {
        const gap = wokeAt - missed.at;
        if (gap >= WAKE_SAME_UTTERANCE_MS && gap <= this.retryWindowMs) {
          output.labels.push({ id: missed.id, label: 'positive', reason: 'retry' });
          output.stats.push('miss');
        } else {
          output.discard.push(missed.id);
        }
      }
      this.rejected = [];
      // Un réveil « vide » juste avant une commande réussie : sans doute un vrai « Jarvis » trop tôt coupé.
      for (const negative of this.negatives) {
        if (wokeAt - negative.at <= this.retryWindowMs) output.discard.push(negative.id);
        else this.finalizeNegative(negative, output);
      }
      this.negatives = [];
      return output;
    }
    if (outcome === 'cancelled') {
      output.labels.push({ id, label: 'negative', reason: 'cancelled' });
      output.stats.push('false-wake');
      return output;
    }
    if (outcome === 'empty' || outcome === 'hallucination') {
      this.negatives.push({ id, at: wokeAt, reason: outcome });
      return output;
    }
    output.discard.push(id);
    return output;
  }

  /** Règle ce qui a dépassé la fenêtre de reprise. À appeler aussi périodiquement. */
  expire(now: number): WakeLabelerOutput {
    const output: WakeLabelerOutput = { labels: [], stats: [], discard: [] };
    this.rejected = this.rejected.filter((item) => {
      if (now - item.at <= this.retryWindowMs) return true;
      output.discard.push(item.id);
      return false;
    });
    this.negatives = this.negatives.filter((item) => {
      if (now - item.at <= this.retryWindowMs) return true;
      this.finalizeNegative(item, output);
      return false;
    });
    for (const [id, at] of this.accepted) {
      // Une dictée ne dure jamais aussi longtemps : issue perdue, extrait douteux.
      if (now - at > 60_000) {
        this.accepted.delete(id);
        output.discard.push(id);
      }
    }
    return output;
  }

  private finalizeNegative(item: PendingNegative, output: WakeLabelerOutput): void {
    output.labels.push({ id: item.id, label: 'negative', reason: item.reason });
    output.stats.push('false-wake');
  }
}
