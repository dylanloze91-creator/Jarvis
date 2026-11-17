/**
 * Chronomètre d'un tour (mission « Jarvis plus rapide, sans nouveau modèle »).
 *
 * Il mesure, il ne change rien : le fournisseur enveloppé envoie la même requête et rend les
 * mêmes événements. Il ne garde que des durées, des comptes et des noms d'outil.
 */
import type { ChatRequest, ChatStreamEvent, ChatUsage, LLMProvider } from '../providers/types.js';
import type { TurnSteps } from '../types.js';

export type ClockPhase = 'tri' | 'reponse';

interface ModelCall {
  phase: ClockPhase;
  usage: ChatUsage | null;
}

function round(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export class TurnClock {
  private readonly startedAt: number;
  private readonly calls: ModelCall[] = [];
  private readonly tools: { name: string; ms: number; garde?: boolean }[] = [];
  private routingStartedAt: number | null = null;
  private routing: { ms: number; chemin: string } | null = null;
  private firstWordMs: number | null = null;
  private voiceMs: number | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  startRouting(): void {
    this.routingStartedAt = this.now();
  }

  /** `chemin` : calcul, horloge, express, trieur, cerveau… `null` : personne n'a choisi. */
  endRouting(chemin: string | null): void {
    if (this.routingStartedAt === null) return;
    this.routing = { ms: round(this.now() - this.routingStartedAt), chemin: chemin ?? 'aucun' };
    this.routingStartedAt = null;
  }

  /** Premier morceau de réponse montré à l'utilisateur. Seul le premier appel compte. */
  firstWord(): void {
    if (this.firstWordMs === null) this.firstWordMs = round(this.now() - this.startedAt);
  }

  tool(name: string, ms: number, garde = false): void {
    this.tools.push({ name, ms: round(ms), ...(garde ? { garde: true } : {}) });
  }

  /** Premier son, en millisecondes depuis le début du tour. */
  voice(ms: number): void {
    if (this.voiceMs === null) this.voiceMs = round(ms);
  }

  /** Même fournisseur, mêmes événements : les mesures d'Ollama sont lues au passage. */
  wrap(provider: LLMProvider, phase: ClockPhase): LLMProvider {
    const calls = this.calls;
    return {
      id: provider.id,
      label: provider.label,
      model: provider.model,
      requiresApiKey: provider.requiresApiKey,
      async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
        const call: ModelCall = { phase, usage: null };
        calls.push(call);
        for await (const event of provider.streamChat(request)) {
          if (event.type === 'done' && event.usage) call.usage = event.usage;
          yield event;
        }
      },
    };
  }

  steps(): TurnSteps {
    const steps: TurnSteps = {};
    const sorting = this.calls.filter((call) => call.phase === 'tri');
    if (this.routing) {
      const measured = sorting.filter((call) => call.usage);
      steps.tri = {
        ms: this.routing.ms,
        chemin: this.routing.chemin,
        ...(sorting.length ? { modele: true } : {}),
        ...(measured.length
          ? {
              chargementMs: round(measured.reduce((sum, call) => sum + (call.usage?.loadMs ?? 0), 0)),
              jetons: measured.reduce((sum, call) => sum + (call.usage?.promptTokens ?? 0), 0),
            }
          : {}),
      };
    }
    const replies = this.calls.filter((call) => call.phase === 'reponse');
    const measured = replies.filter((call) => call.usage);
    if (replies.length) steps.appels = replies.length;
    if (measured.length) {
      const sum = (pick: (usage: ChatUsage) => number): number =>
        measured.reduce((total, call) => total + (call.usage ? pick(call.usage) : 0), 0);
      steps.chargement = round(sum((usage) => usage.loadMs));
      steps.lecture = { ms: round(sum((usage) => usage.promptMs)), jetons: sum((usage) => usage.promptTokens) };
      steps.ecriture = { ms: round(sum((usage) => usage.outputMs)), jetons: sum((usage) => usage.outputTokens) };
    }
    if (this.firstWordMs !== null) steps.premierMot = this.firstWordMs;
    if (this.tools.length) steps.outils = this.tools.map((tool) => ({ ...tool }));
    if (this.voiceMs !== null) steps.voix = this.voiceMs;
    return steps;
  }
}

/** Vrai si le chronomètre n'a rien mesuré : on n'écrit pas un champ vide dans le journal. */
export function emptySteps(steps: TurnSteps): boolean {
  return Object.keys(steps).length === 0;
}
