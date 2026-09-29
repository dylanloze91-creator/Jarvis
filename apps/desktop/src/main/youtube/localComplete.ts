import { resolveLocalSummaryModel, type Settings } from '@jarvis/core';

/**
 * Appel court au modèle local (Ollama), sans outils et sans changer les poids.
 * Le défaut reste `qwen2.5:3b` si le chat n'est pas déjà sur Ollama.
 */
export async function completeWithLocalModel(
  settings: Settings,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  const { model, baseUrl } = resolveLocalSummaryModel(settings);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: { temperature: 0.1, num_predict: 700, num_ctx: 4096 },
      }),
      signal,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `Ollama injoignable (${model})`,
    );
  }

  if (!response.ok) {
    throw new Error(`Ollama a répondu HTTP ${response.status} pour ${model}`);
  }
  const payload = (await response.json()) as { message?: { content?: string } };
  const text = payload.message?.content?.trim() ?? '';
  if (!text) throw new Error(`réponse vide de ${model}`);
  return text;
}
