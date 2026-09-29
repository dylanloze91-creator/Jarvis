import { OLLAMA_DEFAULT_MODEL } from '../providers/ollama.js';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/**
 * Modèle local utilisé pour les condensés YouTube.
 * Si le chat est déjà réglé sur Ollama, on reprend son modèle.
 * Sinon on reste sur le défaut `qwen2.5:3b`, sans changer le modèle du chat.
 */
export function resolveLocalSummaryModel(input: {
  provider: string;
  model: string;
  baseUrl: string;
}): { model: string; baseUrl: string } {
  const configuredLocal = input.provider === 'ollama';
  const model = configuredLocal && input.model.trim() ? input.model.trim() : OLLAMA_DEFAULT_MODEL;
  const baseUrl = (
    configuredLocal && input.baseUrl.trim() ? input.baseUrl.trim() : DEFAULT_OLLAMA_URL
  ).replace(/\/+$/, '');
  return { model, baseUrl };
}
