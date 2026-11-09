import { REFINE_SYSTEM_PROMPT, chooseRefinedPrompt, parseRefinedPrompt, refineUserMessage, type RefineInput } from '@jarvis/core';

export interface RefineOutcome {
  prompt: string;
  negative?: string;
  /** Vrai si la consigne reformulée a été retenue. */
  used: boolean;
  model: string;
  reason?: string;
  durationMs: number;
}

/** Le modèle a 25 s : au-delà, la consigne d'origine part telle quelle. */
export const REFINE_TIMEOUT_MS = 25_000;

/**
 * Demande au modèle de langage (encore chargé) de réécrire la demande en consigne SDXL.
 * Un seul appel `/api/chat` en JSON, température basse ; toute erreur = consigne d'origine.
 */
export class PromptRefiner {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async refine(input: RefineInput, model: string, signal?: AbortSignal): Promise<RefineOutcome> {
    const started = Date.now();
    const signals = [AbortSignal.timeout(REFINE_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          // Le modèle reste chargé comme avant : rien ne change à son keep_alive.
          options: { temperature: 0.3, num_predict: 260 },
          messages: [
            { role: 'system', content: REFINE_SYSTEM_PROMPT },
            { role: 'user', content: refineUserMessage(input) },
          ],
        }),
        signal: AbortSignal.any(signals),
      });
      if (!response.ok) {
        return { prompt: input.prompt, used: false, model, reason: `Ollama a répondu ${response.status}`, durationMs: Date.now() - started };
      }
      const body = (await response.json()) as { message?: { content?: string } };
      const choice = chooseRefinedPrompt(input.prompt, parseRefinedPrompt(body.message?.content ?? ''));
      return { ...choice, model, durationMs: Date.now() - started };
    } catch (error) {
      const name = (error as { name?: string })?.name ?? '';
      const reason = name === 'TimeoutError' ? 'délai de reformulation dépassé' : error instanceof Error ? error.message : String(error);
      return { prompt: input.prompt, used: false, model, reason, durationMs: Date.now() - started };
    }
  }
}
