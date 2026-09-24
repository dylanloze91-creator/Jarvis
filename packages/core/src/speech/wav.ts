/**
 * Encodage WAV minimal (PCM 16 bits, mono) : suffisant pour transmettre un
 * enregistrement à une API de transcription comme Whisper. Aucune
 * dépendance externe, aucun DOM.
 */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // taille du sous-bloc fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // débit d'octets
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits par échantillon
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Décode un WAV PCM 16 bits — l'inverse d'`encodeWav`, utilisé par le
 * script de diagnostic du mot de réveil pour lire un enregistrement fourni
 * par l'utilisateur (après transcodage éventuel en WAV par ffmpeg, en amont
 * de cette fonction, pour les formats compressés comme le MP3). Les canaux
 * multiples sont ramenés à un seul par moyenne — l'appelant convertit déjà
 * en mono en amont, mais cette fonction reste correcte s'il ne le fait pas.
 * Pure : aucune dépendance au DOM ni à Node.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Fichier WAV invalide (en-tête RIFF/WAVE manquant).');
  }

  let offset = 12;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let numChannels = 1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataSize = chunkSize;
    }
    // Les blocs sont alignés sur 2 octets : un bloc de taille impaire est suivi d'un octet de bourrage.
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) throw new Error('Fichier WAV invalide (bloc "data" introuvable).');
  if (bitsPerSample !== 16) {
    throw new Error(
      `Format WAV non pris en charge (${bitsPerSample} bits par échantillon, 16 attendus).`,
    );
  }

  const frameCount = Math.floor(dataSize / 2 / Math.max(1, numChannels));
  const samples = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sampleOffset = dataOffset + (index * numChannels + channel) * 2;
      const raw = view.getInt16(sampleOffset, true);
      sum += raw / (raw < 0 ? 0x8000 : 0x7fff);
    }
    samples[index] = sum / numChannels;
  }

  return { samples, sampleRate };
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}
