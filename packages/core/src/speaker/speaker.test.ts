import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from '../speech/wav.js';
import {
  SPEAKER_MAX_SPEECH_CHARS,
  SentenceStreamer,
  boundedWav,
  streamingWavHeader,
  wavPcmBytes,
  SPEAKER_PORT,
  SPEAKER_SAMPLE_RATE,
  cString,
  checkTurnWav,
  cleanSpeakerName,
  isPrivateAddress,
  isWavContentType,
  resampleLinear,
  silenceWav,
  sortLocalAddresses,
  speakerSecretsBlock,
  speechTextForSpeaker,
  toSpeakerWav,
} from './speaker.js';

/** WAV PCM 16 bits à `channels` canaux (encodeWav ne fait que du mono). */
function wav(samples: Float32Array, sampleRate: number, channels = 1): Uint8Array {
  if (channels === 1) return encodeWav(samples, sampleRate);
  const frames = samples.length;
  const buffer = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * channels * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  let offset = 44;
  for (const sample of samples) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setInt16(offset, Math.round(sample * 0x7fff), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

describe('enceinte (5.0.64) — adresses', () => {
  it('accepte les adresses privées et la boucle locale', () => {
    for (const address of [
      '127.0.0.1',
      '127.8.8.8',
      '10.0.0.5',
      '10.255.255.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.42',
      '169.254.10.10',
      '::1',
      '::ffff:192.168.0.7',
      '::FFFF:10.1.2.3',
      'fe80::1%eth0',
      'fe80::a1b2:c3d4',
      'fc00::1',
      'fd12:3456::1',
      '[fd00::2]',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('refuse Internet et les valeurs illisibles', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '11.0.0.1',
      '100.64.0.1',
      '::ffff:8.8.8.8',
      '2001:db8::1',
      '2a01:e0a::1',
      '::',
      '::2',
      'fe00::1',
      'fec0::1',
      '999.1.1.1',
      'localhost',
      '',
      undefined,
      null,
    ]) {
      expect(isPrivateAddress(address), String(address)).toBe(false);
    }
  });

  it('classe les adresses du PC à montrer dans les réglages', () => {
    expect(sortLocalAddresses(['169.254.3.4', '10.0.0.9', '192.168.1.20', '127.0.0.1', '172.20.0.3', '8.8.8.8', '192.168.1.20'])).toEqual([
      '192.168.1.20',
      '10.0.0.9',
      '172.20.0.3',
    ]);
  });
});

describe('enceinte (5.0.64) — WAV', () => {
  const tone = (seconds: number, rate = SPEAKER_SAMPLE_RATE): Float32Array =>
    Float32Array.from({ length: Math.round(seconds * rate) }, (_, index) => 0.3 * Math.sin((2 * Math.PI * 440 * index) / rate));

  it('reconnaît les types MIME WAV', () => {
    expect(isWavContentType('audio/wav')).toBe(true);
    expect(isWavContentType('audio/x-wav; charset=binary')).toBe(true);
    expect(isWavContentType('Audio/WAVE')).toBe(true);
    expect(isWavContentType('application/json')).toBe(false);
    expect(isWavContentType(undefined)).toBe(false);
  });

  it('accepte un WAV 16 kHz mono 16 bits et rend le PCM', () => {
    const check = checkTurnWav(encodeWav(tone(1), SPEAKER_SAMPLE_RATE));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.pcm.length).toBe(SPEAKER_SAMPLE_RATE);
      expect(check.pcm[40]).toBeCloseTo(tone(1)[40]!, 3);
    }
  });

  it('refuse vide, tronqué, mauvaise fréquence, stéréo, trop court, non WAV', () => {
    expect(checkTurnWav(new Uint8Array(0))).toMatchObject({ ok: false, error: expect.stringContaining('vide') });
    expect(checkTurnWav(new Uint8Array(20))).toMatchObject({ ok: false });
    expect(checkTurnWav(wav(tone(1, 44_100), 44_100))).toMatchObject({ ok: false, error: expect.stringContaining('44100') });
    expect(checkTurnWav(wav(tone(1), SPEAKER_SAMPLE_RATE, 2))).toMatchObject({ ok: false, error: expect.stringContaining('mono') });
    expect(checkTurnWav(encodeWav(new Float32Array(800), SPEAKER_SAMPLE_RATE))).toMatchObject({ ok: false, error: expect.stringContaining('court') });
    const notWav = new Uint8Array(100);
    notWav.set([0x7b, 0x22], 0);
    expect(checkTurnWav(notWav)).toMatchObject({ ok: false, error: expect.stringContaining('WAV') });
  });

  it('produit un silence et ramène un WAV 24 kHz au format de l’enceinte', () => {
    const silence = decodeWav(silenceWav(500));
    expect(silence.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(silence.samples.length).toBe(8_000);
    expect(Math.max(...silence.samples)).toBe(0);

    const converted = decodeWav(toSpeakerWav(encodeWav(tone(1, 24_000), 24_000)));
    expect(converted.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(converted.samples.length).toBe(SPEAKER_SAMPLE_RATE);
    // Même sinusoïde, même amplitude : la crête reste autour de 0,3.
    expect(Math.max(...converted.samples)).toBeGreaterThan(0.28);
    expect(Math.max(...converted.samples)).toBeLessThan(0.31);
  });

  it('rééchantillonne sans changer un signal déjà au bon taux', () => {
    const samples = Float32Array.from([0, 0.5, 1, 0.5, 0]);
    expect(resampleLinear(samples, 16_000, 16_000)).toBe(samples);
    expect(Array.from(resampleLinear(samples, 16_000, 8_000))).toEqual([0, 1]);
    const up = resampleLinear(samples, 8_000, 16_000);
    expect(up.length).toBe(10);
    expect(up[1]).toBeCloseTo(0.25, 5);
  });

  it('un WAV de voix en flux (tailles 0xFFFFFFFF, comme OpenAI) passe par toSpeakerWav sans allocation géante', () => {
    const streamed = new Uint8Array(encodeWav(tone(0.5, 24_000), 24_000));
    const view = new DataView(streamed.buffer, streamed.byteOffset, streamed.byteLength);
    view.setUint32(4, 0xffffffff, true);
    view.setUint32(40, 0xffffffff, true);
    const converted = decodeWav(toSpeakerWav(streamed));
    expect(converted.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(converted.samples.length).toBe(SPEAKER_SAMPLE_RATE / 2);
  });
});

describe('enceinte (5.0.64) — texte et secrets', () => {
  it('retire les sources, le code et le balisage avant la synthèse', () => {
    const text = [
      'Voici **la réponse** avec `du code` et un [lien](https://exemple.fr).',
      '',
      '```js',
      'console.log(1);',
      '```',
      '',
      '- premier point',
      '- second point',
      '',
      'Sources (recherche web du 2 novembre 2026) :',
      '- [1] Titre — média (exemple.fr), 2026 — https://exemple.fr',
    ].join('\n');
    expect(speechTextForSpeaker(text)).toBe('Voici la réponse avec du code et un lien.\npremier point\nsecond point');
  });

  it('coupe à 1 500 caractères, à une fin de phrase', () => {
    const sentence = 'Une phrase qui fait exactement cinquante caractères. ';
    const long = sentence.repeat(40);
    const spoken = speechTextForSpeaker(long);
    expect(spoken.length).toBeLessThanOrEqual(SPEAKER_MAX_SPEECH_CHARS);
    expect(spoken.endsWith('.')).toBe(true);
    expect(speechTextForSpeaker('x'.repeat(2_000)).length).toBe(SPEAKER_MAX_SPEECH_CHARS);
  });

  it('nettoie le nom et écrit le bloc secrets.h sans retour à la ligne dans les chaînes', () => {
    expect(cleanSpeakerName('  Salon <b>  ')).toBe('Salon b');
    expect(cleanSpeakerName(undefined)).toBe('Enceinte');
    expect(cString('a"b\\c\nd')).toBe('"a\\"b\\\\c d"');
    const block = speakerSecretsBlock({ host: '192.168.1.20', hostName: 'pc-dylan.local', port: SPEAKER_PORT, token: 'jeton-secret', name: 'Salon' });
    expect(block).toContain('#define JARVIS_HOST      "192.168.1.20"');
    expect(block).toContain('#define JARVIS_PORT      53131');
    expect(block).toContain('#define JARVIS_TOKEN     "jeton-secret"');
    expect(block).toContain('#define SPEAKER_NAME     "Salon"');
    expect(block).toContain('"pc-dylan.local"');
    expect(block).toContain('#define WIFI_SSID        "A_REMPLIR"');
    expect(speakerSecretsBlock({ host: '10.0.0.2', port: 1, token: 't', name: 'n' })).not.toContain('Autre possibilité');
  });
});

describe('réponse en flux (phrase par phrase)', () => {
  it('découpe les deltas en phrases nettoyées, retire sources et code, respecte la limite', () => {
    const streamer = new SentenceStreamer(60);
    expect(streamer.push('Il fait **22')).toEqual([]);
    expect(streamer.push(' degrés**. Le ciel')).toEqual(['Il fait 22 degrés.']);
    expect(streamer.push(' est dégagé !\n\n```\ncode')).toEqual(['Le ciel est dégagé !']);
    // Bloc de code ouvert : on attend sa fin ; il est retiré en entier.
    expect(streamer.push('\n```\n\nUne liste :\n- un\n- deux\n')).toEqual(['Une liste :', 'un']);
    // « deux » attendait la suite ; le bloc des sources ferme le flux et libère ce qui précède.
    expect(streamer.push('Sources (recherche web du 2 novembre 2026) :\n- [1] x')).toEqual(['deux']);
    expect(streamer.flush()).toEqual([]);
    const long = new SentenceStreamer(20);
    expect(long.push('Une phrase assez longue pour dépasser. Une autre phrase. ')).toEqual(['Une phrase assez lon']);
    expect(long.flush()).toEqual([]);
    const plain = new SentenceStreamer();
    expect(plain.push('Réponse à : quelle heure')).toEqual([]);
    expect(plain.flush()).toEqual(['Réponse à : quelle heure']);
  });

  it('entête WAV sans taille, octets PCM d’un WAV, WAV rendu lisible', () => {
    const head = streamingWavHeader();
    expect(head.byteLength).toBe(44);
    const view = new DataView(head.buffer);
    expect(view.getUint32(4, true)).toBe(0xffffffff);
    expect(view.getUint32(40, true)).toBe(0xffffffff);
    expect(view.getUint32(24, true)).toBe(SPEAKER_SAMPLE_RATE);
    const clip = silenceWav(10);
    expect(wavPcmBytes(clip).byteLength).toBe(clip.byteLength - 44);
    const streamed = new Uint8Array([...head, ...wavPcmBytes(clip), ...wavPcmBytes(clip)]);
    expect(wavPcmBytes(streamed).byteLength).toBe(2 * (clip.byteLength - 44));
    const bounded = boundedWav(streamed);
    const fixed = new DataView(bounded.buffer, bounded.byteOffset, bounded.byteLength);
    expect(fixed.getUint32(4, true)).toBe(bounded.byteLength - 8);
    expect(fixed.getUint32(40, true)).toBe(2 * (clip.byteLength - 44));
    expect(decodeWav(bounded).samples.length).toBe(2 * Math.round(0.01 * SPEAKER_SAMPLE_RATE));
  });
});
