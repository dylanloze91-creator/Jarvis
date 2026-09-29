import { isPrivateIpAddress } from '../web/urlSafety.js';

const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';

/**
 * Les embeddings de la mémoire documentaire ne quittent jamais la machine :
 * seulement Ollama en boucle locale ou sur un réseau privé. Une URL OpenAI /
 * Anthropic / publique est refusée, même si `settings.baseUrl` la contient.
 */
export function isLocalMemoryEndpoint(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
    if (host === 'localhost' || host === '::1') return true;
    return isPrivateIpAddress(host);
  } catch {
    return false;
  }
}

export function resolveLocalOllamaBase(input: { provider?: string; baseUrl?: string }): string {
  const candidate = input.provider === 'ollama' ? (input.baseUrl?.trim() ?? '') : '';
  if (candidate && isLocalMemoryEndpoint(candidate)) {
    return candidate.replace(/\/+$/, '');
  }
  return DEFAULT_OLLAMA;
}
