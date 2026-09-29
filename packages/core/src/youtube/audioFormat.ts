/** Piste audio seule, avec une URL directe (pas un flux vidéo, pas une signature chiffrée). */
export interface AudioOnlyFormat {
  url: string;
  mimeType: string;
  bitrate: number;
}

export function listAudioOnlyFormats(player: unknown): AudioOnlyFormat[] {
  const formats = readAdaptiveFormats(player);
  const parsed: AudioOnlyFormat[] = [];
  for (const format of formats) {
    if (!format || typeof format !== 'object') continue;
    const record = format as Record<string, unknown>;
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';
    const url = typeof record.url === 'string' ? record.url : '';
    if (!mimeType.startsWith('audio/') || !url.startsWith('https://')) continue;
    const bitrate = typeof record.bitrate === 'number' ? record.bitrate : 0;
    parsed.push({ url, mimeType, bitrate });
  }
  return parsed;
}

/**
 * Préfère l'audio MP4 (décodable par Chromium), puis le débit le plus bas
 * encore utile : on ne télécharge que la piste son, jamais la vidéo.
 */
export function pickAudioOnlyFormat(formats: AudioOnlyFormat[]): AudioOnlyFormat | null {
  if (formats.length === 0) return null;
  const mp4 = formats.filter((format) => format.mimeType.startsWith('audio/mp4'));
  const pool = mp4.length > 0 ? mp4 : formats;
  return [...pool].sort((left, right) => left.bitrate - right.bitrate)[0] ?? null;
}

function readAdaptiveFormats(player: unknown): unknown[] {
  if (!player || typeof player !== 'object') return [];
  const streaming = (player as { streamingData?: { adaptiveFormats?: unknown } }).streamingData;
  return Array.isArray(streaming?.adaptiveFormats) ? streaming.adaptiveFormats : [];
}
