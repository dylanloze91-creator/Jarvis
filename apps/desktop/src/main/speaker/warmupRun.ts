import {
  isOllamaLoadOnly,
  speakerWarmupRequests,
  type OllamaLoadRequest,
  type SpeakerWarmupSettings,
} from '@jarvis/core';

/**
 * Charge les modèles dans Ollama sans rien leur faire dire.
 * Doc : https://github.com/ollama/ollama/blob/main/docs/api.md
 * (« Load a model » : prompt vide ; `keep_alive` négatif le garde).
 */
export async function warmOllamaModels(
  settings: SpeakerWarmupSettings,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  /** Jarvis Test : options de chargement de chaque modèle, comme le chat les envoie. */
  optionsFor?: (model: string) => OllamaLoadRequest['options'],
): Promise<OllamaLoadRequest[]> {
  const requests = speakerWarmupRequests(settings).map((request) => {
    const options = optionsFor?.(request.model);
    return options ? { ...request, options } : request;
  });
  const root = baseUrl.replace(/\/+$/, '') || 'http://127.0.0.1:11434';
  for (const body of requests) {
    if (!isOllamaLoadOnly(body)) throw new Error('Le préchauffage ne doit rien générer.');
    await fetchImpl(`${root}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  }
  return requests;
}
