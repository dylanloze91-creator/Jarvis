import { describe, expect, it } from 'vitest';
import {
  EndOfSpeechDetector,
  SILENCE_AFTER_COMMAND_MS,
  SILENCE_BEFORE_COMMAND_MS,
  extendTrailingSilence,
} from './endOfSpeech.js';

const RATE = 16000;
const tone = (seconds: number, amplitude = 0.2) =>
  new Float32Array(Math.round(seconds * RATE)).map((_, index) => amplitude * Math.sin(index / 5));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));

function msUntilEnd(detector: EndOfSpeechDetector, frameSeconds = 0.256): number {
  let ms = 0;
  for (let i = 0; i < 100; i += 1) {
    ms += frameSeconds * 1000;
    if (detector.pushPcm(silence(frameSeconds), RATE)) return ms;
  }
  return Number.POSITIVE_INFINITY;
}

describe('fin de commande', () => {
  it('commande commencée : coupe après 650 ms de silence', () => {
    const detector = new EndOfSpeechDetector();
    expect(detector.pushPcm(tone(0.5), RATE)).toBe(false);
    expect(Math.abs(msUntilEnd(detector, 0.016) - (SILENCE_AFTER_COMMAND_MS))).toBeLessThanOrEqual(20);
  });

  it('commande pas encore commencée : attend 1,5 s', () => {
    const detector = new EndOfSpeechDetector();
    expect(Math.abs(msUntilEnd(detector, 0.016) - (SILENCE_BEFORE_COMMAND_MS))).toBeLessThanOrEqual(20);
  });

  it('la commande déjà dite avec le mot de réveil compte, son silence de fin aussi', () => {
    const detector = new EndOfSpeechDetector();
    detector.primeWithCommandAudio(new Float32Array([...tone(0.8), ...silence(0.4)]), RATE);
    expect(detector.commandStarted).toBe(true);
    expect(Math.abs(msUntilEnd(detector, 0.016) - (SILENCE_AFTER_COMMAND_MS - 400))).toBeLessThanOrEqual(20);
  });

  it('la fin du mot de réveil seule ne compte pas comme commande', () => {
    const detector = new EndOfSpeechDetector();
    detector.primeWithCommandAudio(tone(0.12), RATE);
    expect(detector.commandStarted).toBe(false);
  });

  it('la parole au milieu d’une trame de 256 ms est prise en compte finement', () => {
    const detector = new EndOfSpeechDetector();
    detector.pushPcm(tone(0.3), RATE);
    const frame = new Float32Array([...tone(0.1), ...silence(0.156)]);
    expect(detector.pushPcm(frame, RATE)).toBe(false);
    // 156 ms de silence déjà comptés dans la trame
    expect(Math.abs(msUntilEnd(detector, 0.016) - (SILENCE_AFTER_COMMAND_MS - 156))).toBeLessThanOrEqual(20);
  });
});

describe('silence de fin donné à Whisper', () => {
  const noise = (seconds: number) =>
    new Float32Array(Math.round(seconds * RATE)).map((_, index) => 0.002 * Math.sin(index * 1.3));

  it('prolonge 650 ms de silence capté jusqu’à 1 s, avec le même bruit de pièce', () => {
    const pcm = new Float32Array([...tone(1), ...noise(0.65)]);
    const extended = extendTrailingSilence(pcm, RATE);
    expect(extended.length / RATE).toBeCloseTo(2, 1);
    expect(extended.subarray(0, pcm.length)).toEqual(pcm);
    const added = extended.subarray(pcm.length);
    expect(Math.max(...added.map(Math.abs))).toBeGreaterThan(0.001);
    expect(Math.max(...added.map(Math.abs))).toBeLessThan(0.01);
  });

  it('ne touche ni un silence déjà assez long, ni un audio sans silence de fin, ni un audio muet', () => {
    const long = new Float32Array([...tone(1), ...noise(1.2)]);
    expect(extendTrailingSilence(long, RATE)).toBe(long);
    const speech = tone(1);
    expect(extendTrailingSilence(speech, RATE)).toBe(speech);
    const mute = silence(1);
    expect(extendTrailingSilence(mute, RATE)).toBe(mute);
  });
});
