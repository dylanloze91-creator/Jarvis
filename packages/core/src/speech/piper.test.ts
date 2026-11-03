import { describe, expect, it } from 'vitest';
import { encodeWav } from './wav.js';
import {
  PIPER_PREVIEW_TEXT,
  concatWavClips,
  describePiperVoice,
  shouldStreamPiperSpeech,
  splitFrenchSentences,
} from './piper.js';

describe('splitFrenchSentences', () => {
  it('découpe sur la ponctuation forte', () => {
    expect(splitFrenchSentences('Bonjour. Comment vas-tu ? Très bien !')).toEqual([
      'Bonjour.',
      'Comment vas-tu ?',
      'Très bien !',
    ]);
  });

  it('retourne une phrase unique sans ponctuation', () => {
    expect(splitFrenchSentences('  salut mon ami  ')).toEqual(['salut mon ami']);
  });
});

describe('shouldStreamPiperSpeech', () => {
  it('active le mode phrase pour un texte long', () => {
    const long = 'a'.repeat(150);
    expect(shouldStreamPiperSpeech(long, null)).toBe(true);
  });

  it('active le mode phrase si le banc dépasse une seconde', () => {
    expect(shouldStreamPiperSpeech('Une phrase courte mais pas toute seule. Et une autre.', 1_200)).toBe(true);
  });

  it('reste en bloc unique pour un court texte rapide', () => {
    expect(shouldStreamPiperSpeech('Bonjour.', 200)).toBe(false);
  });
});

describe('concatWavClips', () => {
  it('fusionne deux clips mono', () => {
    const a = encodeWav(new Float32Array([0, 0.5, -0.5]), 22_050);
    const b = encodeWav(new Float32Array([0.25]), 22_050);
    const merged = concatWavClips([a, b]);
    expect(merged.length).toBeGreaterThan(a.length);
  });
});

describe('describePiperVoice', () => {
  it('retombe sur la voix par défaut si inconnue', () => {
    expect(describePiperVoice('inconnue').id).toBe(describePiperVoice(undefined).id);
  });

  it('garde une phrase d’aperçu stable', () => {
    expect(PIPER_PREVIEW_TEXT.length).toBeGreaterThan(20);
  });
});
