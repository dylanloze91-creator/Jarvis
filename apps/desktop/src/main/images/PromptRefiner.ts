import {
  REFINE_SYSTEM_PROMPT,
  chooseRefinedPrompt,
  parseRefinedPrompt,
  refineRetryMessage,
  refineUserMessage,
  type RefineInput,
} from '@jarvis/core';

export interface RefineOutcome {
  prompt: string;
  negative?: string;
  /** Vrai si la consigne reformulée a été retenue. */
  used: boolean;
  model: string;
  reason?: string;
  durationMs: number;
  /** Nombre d'appels au modèle (1, ou 2 si la première réponse a été refusée). */
  attempts: number;
}

/** Chaque appel au modèle a 20 s ; au-delà, la consigne d'origine part telle quelle. */
export const REFINE_CALL_TIMEOUT_MS = 20_000;

/**
 * Demande au modèle de langage (encore chargé) de réécrire la demande en consigne SDXL.
 * Un appel `/api/chat` en JSON, température basse ; si la réponse est illisible ou contient
 * encore du français, un second essai lui montre sa réponse et redemande ; ensuite, la
 * consigne d'origine part telle quelle. Toute erreur réseau = consigne d'origine.
 */
export class PromptRefiner {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async refine(input: RefineInput, model: string, signal?: AbortSignal): Promise<RefineOutcome> {
    const started = Date.now();
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: REFINE_SYSTEM_PROMPT },
      { role: 'user', content: refineUserMessage(input) },
    ];
    let attempts = 0;
    let lastReason: string | undefined;
    while (attempts < 2) {
      attempts += 1;
      let answer: string;
      try {
        answer = await this.ask(model, messages, signal);
      } catch (error) {
        const name = (error as { name?: string })?.name ?? '';
        const reason = name === 'TimeoutError' ? 'délai de reformulation dépassé' : error instanceof Error ? error.message : String(error);
        return { prompt: input.prompt, used: false, model, reason, durationMs: Date.now() - started, attempts };
      }
      const choice = chooseRefinedPrompt(input.prompt, parseRefinedPrompt(answer));
      if (choice.used) return { ...choice, model, durationMs: Date.now() - started, attempts };
      lastReason = choice.reason;
      messages.push({ role: 'assistant', content: answer }, { role: 'user', content: refineRetryMessage(answer) });
    }
    return {
      prompt: input.prompt,
      used: false,
      model,
      reason: `${lastReason ?? 'réponse refusée'} après deux essais`,
      durationMs: Date.now() - started,
      attempts,
    };
  }

  private async ask(model: string, messages: { role: string; content: string }[], signal?: AbortSignal): Promise<string> {
    const signals = [AbortSignal.timeout(REFINE_CALL_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        // Le modèle reste chargé comme avant : rien ne change à son keep_alive.
        options: { temperature: 0.3, num_predict: 260 },
        messages,
      }),
      signal: AbortSignal.any(signals),
    });
    if (!response.ok) throw new Error(`Ollama a répondu ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    return body.message?.content ?? '';
  }
}
