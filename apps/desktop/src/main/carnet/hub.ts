/**
 * Le carnet branché sur une session.
 * Il répond « C'est noté. » avant tout modèle, et il écrit les ratés dans son fichier.
 * Il ne change pas les autres réponses, ni ce qui part au modèle.
 */
import {
  DEFAULT_INTERRUPTION_WINDOW_MS,
  detectRates,
  entryFromDetection,
  isFailureReport,
  NOTED_REPLY,
  previousFromHistory,
  type CarnetEdition,
  type CarnetHow,
  type CarnetPlace,
  type ChatMessage,
  type ObservedTurn,
  type RateDetection,
  type ToolLine,
} from '@jarvis/core';
import type { CarnetFile } from './file.js';

export interface NotedExpress {
  at: number;
  conversationId: string;
  place: CarnetPlace;
  edition: CarnetEdition;
  text: string;
  detection: RateDetection;
}

export interface ObserveSnapshot {
  at: number;
  conversationId: string;
  before: readonly ChatMessage[];
  userText: string;
  replyText: string;
  place: CarnetPlace;
  team: string | null;
  model: string | null;
  how: CarnetHow | null;
  brainUnreadable: boolean;
  tools: ToolLine[];
  firstWordMs: number | null;
  speakerFirstSoundMs: number | null;
  cut: ObservedTurn['cut'];
}

export class CarnetHub {
  /** Signaux « ça n'a pas marché » depuis le démarrage de ce processus. */
  readonly noted: NotedExpress[] = [];
  private enabledOverride: boolean | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly replyStarts = new Map<string, number>();
  private readonly speakerSounds = new Map<string, number>();
  /** Dernier tour d'enceinte, pour le premier son s'il arrive après la réponse. */
  private lastSpeaker: { name: string; turn: ObservedTurn; soundNoted: boolean } | null = null;

  constructor(
    readonly edition: CarnetEdition,
    private readonly file?: CarnetFile,
  ) {}

  enabled(): boolean {
    return this.enabledOverride ?? this.edition === 'test';
  }

  setEnabled(enabled: boolean): void {
    this.enabledOverride = enabled;
  }

  /** `null` : le tour continue comme avant, y compris l'appel au modèle. */
  expressReply(text: string): string | null {
    if (!this.enabled() || !isFailureReport(text)) return null;
    return NOTED_REPLY;
  }

  noteExpress(ctx: {
    text: string;
    conversationId: string;
    before: readonly ChatMessage[];
    place: CarnetPlace;
    at: number;
  }): void {
    if (!this.enabled()) return;
    const found = detectRates(
      this.turnFrom(ctx.at, ctx.conversationId, ctx.before, ctx.text, NOTED_REPLY, ctx.place, {
        how: 'express',
      }),
    );
    for (const detection of found) {
      this.noted.push({
        at: ctx.at,
        conversationId: ctx.conversationId,
        place: ctx.place,
        edition: this.edition,
        text: ctx.text,
        detection,
      });
      this.persist(ctx.at, ctx.conversationId, ctx.place, detection);
    }
  }

  /** Fin d'un tour normal. N'écrit que des ratés ; ne renvoie rien au modèle. */
  observeTurn(input: ObserveSnapshot): void {
    if (!this.enabled() || isFailureReport(input.userText)) return;
    const turn = this.turnFrom(
      input.at,
      input.conversationId,
      input.before,
      input.userText,
      input.replyText,
      input.place,
      {
        team: input.team,
        model: input.model,
        how: input.how,
        brainUnreadable: input.brainUnreadable,
        tools: input.tools,
        firstWordMs: input.firstWordMs,
        speakerFirstSoundMs: input.speakerFirstSoundMs,
        cut: input.cut,
      },
    );
    if (input.place.kind === 'enceinte') {
      this.lastSpeaker = {
        name: input.place.name,
        turn,
        soundNoted: input.speakerFirstSoundMs !== null,
      };
    }
    for (const detection of detectRates(turn))
      this.persist(input.at, input.conversationId, input.place, detection);
  }

  noteFirstSound(name: string, elapsedMs: number): void {
    this.speakerSounds.set(name, elapsedMs);
    const last = this.lastSpeaker;
    if (!last || last.name !== name || last.soundNoted) return;
    last.soundNoted = true;
    const turn: ObservedTurn = {
      ...last.turn,
      speakerFirstSoundMs: elapsedMs,
      durations: { ...last.turn.durations, premierSonMs: elapsedMs },
    };
    for (const detection of detectRates(turn)) {
      if (detection.type !== 'lenteur') continue;
      this.persist(turn.at, turn.conversationId, turn.place, detection);
    }
  }

  takeSpeakerSound(name: string): number | null {
    const value = this.speakerSounds.get(name);
    this.speakerSounds.delete(name);
    return value ?? null;
  }

  markReply(conversationId: string, at: number | null): void {
    if (at === null) this.replyStarts.delete(conversationId);
    else this.replyStarts.set(conversationId, at);
  }

  /** Parole pendant la voix, dans les 5 secondes après le début de la réponse précédente. */
  speechCut(input: {
    conversationId: string;
    at: number;
    source?: 'voice' | 'text';
    text: string;
  }): ObservedTurn['cut'] {
    if (input.source !== 'voice') return null;
    const started = this.replyStarts.get(input.conversationId);
    if (started === undefined) return null;
    const afterMs = input.at - started;
    if (afterMs < 0 || afterMs > DEFAULT_INTERRUPTION_WINDOW_MS) return null;
    return { afterMs, speech: true, text: input.text };
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private turnFrom(
    at: number,
    conversationId: string,
    before: readonly ChatMessage[],
    userText: string,
    replyText: string,
    place: CarnetPlace,
    extra: Partial<ObservedTurn>,
  ): ObservedTurn {
    const durations: Record<string, number> = {};
    if (typeof extra.firstWordMs === 'number') durations.premierMotMs = extra.firstWordMs;
    if (typeof extra.speakerFirstSoundMs === 'number')
      durations.premierSonMs = extra.speakerFirstSoundMs;
    return {
      at,
      conversationId,
      edition: this.edition,
      place,
      userText,
      replyText,
      team: extra.team ?? null,
      model: extra.model ?? null,
      how: extra.how ?? null,
      brainUnreadable: extra.brainUnreadable ?? false,
      tools: extra.tools ?? [],
      durations: { ...durations, ...(extra.durations ?? {}) },
      firstWordMs: extra.firstWordMs ?? null,
      speakerFirstSoundMs: extra.speakerFirstSoundMs ?? null,
      cut: extra.cut ?? null,
      previous: previousFromHistory(before),
    };
  }

  private persist(
    at: number,
    conversationId: string,
    place: CarnetPlace,
    detection: RateDetection,
  ): void {
    if (!this.file) return;
    const entry = entryFromDetection({
      at,
      edition: this.edition,
      place,
      conversationId,
      detection,
    });
    this.queue = this.queue
      .then(() => this.file?.append(entry))
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error('[jarvis] carnet non écrit :', error);
      });
  }
}
