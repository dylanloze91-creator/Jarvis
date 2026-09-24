import { safeJsonParse } from './sse.js';

/**
 * L'API native d'Ollama (`/api/chat`, `/api/generate`) ne parle pas SSE mais
 * du JSON délimité par des retours à la ligne (NDJSON) : un objet complet par
 * ligne, sans préfixe `data:`. Cette fonction isole ce détail de protocole du
 * reste du provider.
 */
export async function* parseNDJSON<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          const parsed = safeJsonParse<T>(line);
          if (parsed !== null) yield parsed;
        }
        newline = buffer.indexOf('\n');
      }
    }
    const rest = buffer.trim();
    if (rest.length > 0) {
      const parsed = safeJsonParse<T>(rest);
      if (parsed !== null) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}
