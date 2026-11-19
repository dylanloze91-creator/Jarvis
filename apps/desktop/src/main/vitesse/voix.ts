/**
 * Chronomètre « voix » : du début du tour au premier son.
 *
 * Le son arrive souvent après l'écriture du journal du tour (la fenêtre parle une fois la réponse
 * finie). Ce carnet garde donc le dernier tour de chaque lieu : si le son arrive avant le journal,
 * la session le lit ; s'il arrive après, la ligne du journal est complétée sur le disque.
 * Il ne contient que des identifiants et des durées.
 */
import type { Conversation } from '@jarvis/core';

/** Au-delà, ce n'est plus « la réponse dite » de ce tour. */
export const VOICE_SOUND_MAX_MS = 180_000;

export interface VoiceTurn {
  conversationId: string;
  userMessageId: string;
  startedAt: number;
}

interface OpenTurn extends VoiceTurn {
  ms: number | null;
  saved: boolean;
}

export interface VoiceStartStore {
  get(id: string): Promise<Conversation | null>;
  save(conversation: Conversation): Promise<unknown>;
}

export class VoiceStartBook {
  private readonly turns = new Map<string, OpenTurn>();

  constructor(
    private readonly store: VoiceStartStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Un tour commence dans ce lieu (`fenetre`, `enceinte:<nom>`). */
  turnStarted(place: string, turn: VoiceTurn): void {
    this.turns.set(place, { ...turn, ms: null, saved: false });
  }

  /** Le journal du tour est écrit. Rend le premier son s'il est déjà connu. */
  journalised(place: string, userMessageId: string): number | null {
    const turn = this.turns.get(place);
    if (!turn || turn.userMessageId !== userMessageId) return null;
    turn.saved = true;
    return turn.ms;
  }

  /** Premier son entendu dans ce lieu. Complète le journal s'il est déjà écrit. */
  async sound(place: string): Promise<void> {
    const turn = this.turns.get(place);
    if (!turn || turn.ms !== null) return;
    const ms = this.now() - turn.startedAt;
    if (!Number.isFinite(ms) || ms < 0 || ms > VOICE_SOUND_MAX_MS) return;
    turn.ms = Math.round(ms);
    if (!turn.saved) return;
    const conversation = await this.store.get(turn.conversationId);
    const log = conversation?.turnLog;
    if (!conversation || !log) return;
    const index = log.findIndex((entry) => entry.userMessageId === turn.userMessageId);
    const entry = index >= 0 ? log[index] : undefined;
    if (!entry || entry.etapes?.voix !== undefined) return;
    const turnLog = [...log];
    turnLog[index] = { ...entry, etapes: { ...(entry.etapes ?? {}), voix: turn.ms } };
    await this.store.save({ ...conversation, turnLog });
  }
}

export function voicePlaceKey(place: { kind: 'fenetre' | 'telephone' | 'enceinte'; name?: string } | undefined): string | null {
  if (!place || place.kind === 'fenetre') return 'fenetre';
  if (place.kind === 'enceinte') return `enceinte:${place.name ?? ''}`;
  // Le téléphone parle avec sa propre synthèse : le PC ne sait pas quand.
  return null;
}
