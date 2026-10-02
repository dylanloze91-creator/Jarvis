import { checkOllamaStatus, parseNDJSON, type OllamaStatusResult } from '@jarvis/core';

export interface RunningModel {
  name: string;
  sizeBytes: number;
  sizeVramBytes: number;
}

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
}

/** API HTTP d'Ollama utilisée par le modèle de code. Aucune variable du serveur n'est touchée. */
export interface OllamaApi {
  readonly baseUrl: string;
  status(): Promise<OllamaStatusResult>;
  running(): Promise<RunningModel[]>;
  pull(
    model: string,
    onProgress: (progress: PullProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

interface PullChunk {
  status?: string;
  completed?: number;
  total?: number;
  error?: string;
}

export function createOllamaApi(baseUrl: string, fetchImpl: typeof fetch = fetch): OllamaApi {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    baseUrl: base,
    status: () => checkOllamaStatus(base, { fetchImpl, timeoutMs: 4_000 }),
    async running() {
      try {
        const response = await fetchImpl(`${base}/api/ps`, { signal: AbortSignal.timeout(4_000) });
        if (!response.ok) return [];
        const data = (await response.json()) as {
          models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }>;
        };
        return (data.models ?? []).map((model) => ({
          name: model.name ?? model.model ?? '',
          sizeBytes: model.size ?? 0,
          sizeVramBytes: model.size_vram ?? 0,
        }));
      } catch {
        return [];
      }
    },
    async pull(model, onProgress, signal) {
      const response = await fetchImpl(`${base}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true }),
        signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(
          `Ollama a refusé le téléchargement (HTTP ${response.status}) : ${(await response.text().catch(() => '')).slice(0, 200)}`,
        );
      }
      let success = false;
      for await (const chunk of parseNDJSON<PullChunk>(response.body)) {
        if (chunk.error) throw new Error(`Ollama : ${chunk.error}`);
        onProgress({
          status: chunk.status ?? '',
          completed: chunk.completed ?? 0,
          total: chunk.total ?? 0,
        });
        if (chunk.status === 'success') success = true;
      }
      if (!success) throw new Error('Téléchargement interrompu avant la fin.');
    },
  };
}
