/**
 * Lecture phrase par phrase avec pré-synthèse d'une phrase d'avance (annulée si `cancelled`).
 */
export async function playPiperPartsWithPrefetch(
  parts: string[],
  synthesize: (part: string) => Promise<{ ok: true; data: Uint8Array; mimeType: string } | { ok: false; error: string }>,
  play: (data: Uint8Array, mimeType: string) => Promise<void>,
  cancelled: () => boolean,
): Promise<void> {
  let nextPromise: Promise<{ ok: true; data: Uint8Array; mimeType: string } | { ok: false; error: string }> | null =
    null;
  for (let index = 0; index < parts.length; index += 1) {
    if (cancelled()) return;
    const part = parts[index]!;
    const result = nextPromise ? await nextPromise : await synthesize(part);
    nextPromise = null;
    if (cancelled()) return;
    if (!result.ok) throw new Error(result.error);
    const playDone = play(result.data, result.mimeType);
    if (index + 1 < parts.length && !cancelled()) {
      nextPromise = synthesize(parts[index + 1]!);
    }
    await playDone;
  }
}
