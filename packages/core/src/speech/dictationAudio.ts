/** Réservé au pré-traitement dictée ; pas de filtre agressif (peut dégrader Whisper). */
export function highpassDictationPcm(pcm: Float32Array): Float32Array {
  return pcm;
}

export function preprocessDictationPcm(pcm: Float32Array): Float32Array {
  return pcm;
}
