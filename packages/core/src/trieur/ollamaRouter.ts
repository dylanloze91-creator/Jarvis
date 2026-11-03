import { OllamaProvider } from '../providers/ollama.js';
import type { RouterModel } from './bench.js';
import { ROUTER_MAX_TOKENS, ROUTER_TEMPERATURE } from './bench.js';

export async function probeOllamaModel(
  modelName: string,
  baseUrl = 'http://127.0.0.1:11434',
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return { ok: false, reason: 'Ollama ne répond pas' };
    const body = (await response.json()) as { models?: { name?: string }[] };
    const wanted = modelName.includes(':') ? modelName : `${modelName}:latest`;
    const found = (body.models ?? []).some((model) => model.name === modelName || model.name === wanted);
    if (!found) return { ok: false, reason: 'modèle absent' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Ollama injoignable' };
  }
}

export async function readOllamaGpuFraction(
  baseUrl = 'http://127.0.0.1:11434',
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/ps`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { models?: { size_vram?: number; size?: number }[] };
    const models = body.models ?? [];
    if (!models.length) return null;
    let vram = 0;
    let total = 0;
    for (const model of models) {
      vram += model.size_vram ?? 0;
      total += model.size ?? model.size_vram ?? 0;
    }
    if (!total) return null;
    return vram / total;
  } catch {
    return null;
  }
}

export function ollamaRouterModel(modelName: string, baseUrl = 'http://127.0.0.1:11434', fetchImpl?: typeof fetch): RouterModel {
  const provider = new OllamaProvider({
    provider: 'ollama',
    model: modelName,
    baseUrl,
    ollama: {
      numCtx: 8192,
      think: false,
      keepAlive: '10m',
      recoverToolCalls: false,
    },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  let first = true;
  return {
    name: modelName,
    async complete(input) {
      const t0 = Date.now();
      let text = '';
      for await (const event of provider.streamChat({
        system: input.system,
        messages: [{ id: 'u', role: 'user', content: input.user, createdAt: Date.now() }],
        temperature: ROUTER_TEMPERATURE,
        maxTokens: ROUTER_MAX_TOKENS,
        signal: input.signal,
      })) {
        if (event.type === 'text') text += event.delta;
        if (event.type === 'error') break;
      }
      const phraseMs = Date.now() - t0;
      const loadMs = first ? phraseMs : undefined;
      first = false;
      const gpuFraction = await readOllamaGpuFraction(baseUrl, fetchImpl ?? fetch);
      return { text, loadMs, phraseMs, gpuFraction };
    },
  };
}
