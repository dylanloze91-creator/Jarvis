/** En-tête RIFF/WAVE minimal : en dessous, le lecteur HTML refuse la source. */
export const MIN_PIPER_WAV_BYTES = 44;

/** Copie exacte des octets reçus (IPC peut renvoyer une vue sur un buffer plus grand). */
export function wavBlobFromBytes(data: Uint8Array, mimeType = 'audio/wav'): Blob {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return new Blob([data.buffer as ArrayBuffer], { type: mimeType });
  }
  return new Blob([Uint8Array.from(data)], { type: mimeType });
}

export type PiperWavLogFn = (line: string) => void;

export function defaultPiperWavLog(line: string): void {
  window.jarvis.voice.log(line);
}

/**
 * Lecture d'un WAV Piper dans le renderer (blob: + HTMLAudioElement).
 * Journalise la taille reçue pour le diagnostic « Écouter » / chat vocal.
 */
export async function playPiperWavBytes(
  data: Uint8Array,
  mimeType: string,
  log: PiperWavLogFn = defaultPiperWavLog,
  cancelled: () => boolean = () => false,
  hooks: { onAudio?: (audio: HTMLAudioElement) => void } = {},
): Promise<void> {
  if (cancelled()) return;
  if (data.byteLength < MIN_PIPER_WAV_BYTES) {
    throw new Error(`WAV Piper trop court (${data.byteLength} octets).`);
  }
  log(`[piper] WAV reçu : ${data.byteLength} octets`);
  const blob = wavBlobFromBytes(data, mimeType);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  hooks.onAudio?.(audio);
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (): void => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener(
        'error',
        () => {
          URL.revokeObjectURL(url);
          reject(new Error('Lecture audio impossible (vérifiez la politique media-src blob:).'));
        },
        { once: true },
      );
      void audio.play().catch(reject);
    });
  } finally {
    audio.pause();
    audio.src = '';
  }
  if (cancelled()) return;
}

/** CSP du renderer : sans `media-src … blob:`, les URL blob: des WAV Piper sont bloquées. */
export function rendererAllowsPiperBlobPlayback(csp: string): boolean {
  return /media-src[^;]*blob:/.test(csp);
}
