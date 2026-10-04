/**
 * Plafonds de chaque étape d'un spécialiste (5.0.1) : un nombre de jetons par
 * réponse du modèle (`num_predict` d'Ollama) et une durée totale. Un modèle ne
 * peut plus parler sans fin : au plafond, la réponse s'arrête, le format est
 * vérifié, une relance courte au plus, puis la mission continue sans lui
 * quand c'est possible. Durées pensées pour un petit modèle sur processeur
 * (environ 10 jetons/s).
 */
export interface StepLimit {
  /** Jetons au plus par réponse du modèle. */
  maxTokens: number;
  /** Durée totale de l'étape, outils compris. */
  timeoutMs: number;
}

const MIN = 60_000;

export const STEP_LIMITS = {
  goal: { maxTokens: 600, timeoutMs: 3 * MIN },
  design: { maxTokens: 900, timeoutMs: 6 * MIN },
  factory: { maxTokens: 300, timeoutMs: 3 * MIN },
  research: { maxTokens: 700, timeoutMs: 4 * MIN },
  skill: { maxTokens: 700, timeoutMs: 4 * MIN },
  improve: { maxTokens: 1_500, timeoutMs: 8 * MIN },
  answer: { maxTokens: 900, timeoutMs: 6 * MIN },
  review: { maxTokens: 700, timeoutMs: 5 * MIN },
  diagnose: { maxTokens: 700, timeoutMs: 5 * MIN },
  plan: { maxTokens: 900, timeoutMs: 8 * MIN },
  edit: { maxTokens: 4_000, timeoutMs: 25 * MIN },
  fix: { maxTokens: 4_000, timeoutMs: 20 * MIN },
} as const satisfies Record<string, StepLimit>;

export type StepKind = keyof typeof STEP_LIMITS;

/** Plafonds du banc réel, par sorte de tâche : le banc finit toujours, même avec un modèle bavard. */
export const BENCH_LIMITS = {
  ask: { maxTokens: 900, timeoutMs: 5 * MIN },
  plan: { maxTokens: 900, timeoutMs: 6 * MIN },
  review: { maxTokens: 700, timeoutMs: 3 * MIN },
  edit: { maxTokens: 2_500, timeoutMs: 8 * MIN },
  complete: { maxTokens: 700, timeoutMs: 5 * MIN },
} as const satisfies Record<string, StepLimit>;

/** Relance après une réponse hors format : courte et deux fois plus brève. */
export function retryLimit(limit: StepLimit): StepLimit {
  return {
    maxTokens: Math.min(limit.maxTokens, 600),
    timeoutMs: Math.max(30_000, Math.round(limit.timeoutMs / 2)),
  };
}

export function limitText(limit: StepLimit): string {
  return `${limit.maxTokens} jetons par réponse, ${Math.round(limit.timeoutMs / MIN)} min au plus`;
}

/** Signal annulé par l'utilisateur OU à l'échéance ; `expired()` distingue les deux. */
export function withDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; expired(): boolean; dispose(): void } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new Error('délai dépassé'));
  }, timeoutMs);
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    expired: () => expired && !signal?.aborted,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
