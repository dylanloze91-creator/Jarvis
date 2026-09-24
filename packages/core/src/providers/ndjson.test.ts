import { describe, expect, it } from 'vitest';
import { parseNDJSON } from './ndjson.js';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

async function collect<T>(body: ReadableStream<Uint8Array>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of parseNDJSON<T>(body)) out.push(value);
  return out;
}

describe('parseNDJSON', () => {
  it('découpe plusieurs objets reçus dans un seul paquet réseau', async () => {
    const body = streamFromChunks(['{"a":1}\n{"a":2}\n{"a":3}\n']);
    expect(await collect<{ a: number }>(body)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('recolle une ligne coupée au milieu par la frontière entre deux paquets réseau', async () => {
    const body = streamFromChunks(['{"a":1}\n{"a"', ':2}\n{"a":3}\n']);
    expect(await collect<{ a: number }>(body)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('traite la dernière ligne même sans retour à la ligne final', async () => {
    const body = streamFromChunks(['{"a":1}\n{"a":2}']);
    expect(await collect<{ a: number }>(body)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('ignore les lignes vides et le JSON invalide plutôt que de planter', async () => {
    const body = streamFromChunks(['{"a":1}\n\n   \nceci n’est pas du json\n{"a":2}\n']);
    expect(await collect<{ a: number }>(body)).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
