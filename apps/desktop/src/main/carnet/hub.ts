/**
 * Le carnet branché sur une session. Il répond « C'est noté. » avant tout modèle
 * et retient le tour précédent. Il n'écrit pas encore sur le disque : c'est la partie suivante.
 */
import {
  detectRates,
  isFailureReport,
  NOTED_REPLY,
  previousFromHistory,
  type CarnetEdition,
  type CarnetPlace,
  type ChatMessage,
  type RateDetection,
} from '@jarvis/core';

export interface NotedExpress {
  at: number;
  conversationId: string;
  place: CarnetPlace;
  edition: CarnetEdition;
  text: string;
  detection: RateDetection;
}

export class CarnetHub {
  /** Signaux reçus depuis le démarrage. La partie fichier les relira depuis le disque. */
  readonly noted: NotedExpress[] = [];
  private enabledOverride: boolean | null = null;

  constructor(readonly edition: CarnetEdition) {}

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
    const previous = previousFromHistory(ctx.before);
    const found = detectRates({
      at: ctx.at,
      conversationId: ctx.conversationId,
      edition: this.edition,
      place: ctx.place,
      userText: ctx.text,
      replyText: NOTED_REPLY,
      team: null,
      model: null,
      how: 'express',
      brainUnreadable: false,
      tools: [],
      durations: {},
      firstWordMs: 0,
      speakerFirstSoundMs: null,
      cut: null,
      previous,
    });
    for (const detection of found) {
      this.noted.push({
        at: ctx.at,
        conversationId: ctx.conversationId,
        place: ctx.place,
        edition: this.edition,
        text: ctx.text,
        detection,
      });
    }
  }
}
