import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

/** Environ 2 h d'audio à 128 kbit/s. Au-delà, on n'écoute pas et on passe aux sous-titres. */
const MAX_AUDIO_BYTES = 150_000_000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Télécharge une URL de piste audio déjà choisie (pas une vidéo) dans un
 * dossier temporaire. L'appelant doit effacer ce fichier après Whisper.
 */
export async function downloadAudioFile(
  rawUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = assertAudioUrl(rawUrl);
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-yt-audio-'));
  const file = join(dir, 'piste');
  try {
    await streamToFile(url, file, fetchImpl, signal);
    return file;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function deleteAudioFile(file: string): Promise<void> {
  await rm(dirname(file), { recursive: true, force: true });
}

function assertAudioUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'googlevideo.com' ||
    host.endsWith('.googlevideo.com') ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com');
  if (url.protocol !== 'https:' || !allowed) {
    throw new Error('adresse audio refusée');
  }
  return url;
}

async function streamToFile(
  url: URL,
  file: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { 'user-agent': BROWSER_UA, accept: 'audio/*,*/*' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('video/')) {
    await response.body.cancel().catch(() => undefined);
    throw new Error('flux vidéo refusé');
  }

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_AUDIO_BYTES) {
        callback(new Error('piste audio trop volumineuse'));
        return;
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as NodeWebReadableStream),
    limiter,
    createWriteStream(file),
  );
}
