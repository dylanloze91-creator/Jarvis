import { describe, expect, it } from 'vitest';
import {
  clearSpotifyDeviceAsks,
  connectSpeakerNamesForAsk,
  extractSpotifyPlayDeviceHint,
  extractSpotifyTransferTarget,
  interpretSpotifyDeviceAnswer,
  isSpotifyDeviceQuestion,
  isSpotifyHaltPhrase,
  isSpotifyTransferPhrase,
  peekSpotifyDeviceAsk,
  rememberSpotifyDeviceAsk,
  spotifyDeviceQuestion,
  stripSpotifyPlayDeviceSuffix,
} from './spotifyDeviceVoice.js';

describe('spotifyDeviceVoice', () => {
  it('détecte enceinte, PC et nom d’appareil', () => {
    expect(extractSpotifyPlayDeviceHint('mets Jul sur l’enceinte')).toEqual({ kind: 'speaker' });
    expect(extractSpotifyPlayDeviceHint('mets Jul sur le PC')).toEqual({ kind: 'pc' });
    expect(extractSpotifyPlayDeviceHint('mets Jul sur la Devialet')).toEqual({
      kind: 'named',
      name: 'Devialet',
    });
  });

  it('reconnaît les phrases de transfert', () => {
    expect(isSpotifyTransferPhrase('passe la musique sur l’enceinte')).toBe(true);
    expect(isSpotifyTransferPhrase('mets-la sur le PC')).toBe(true);
    expect(extractSpotifyTransferTarget('transfère la musique sur la Devialet')).toEqual({
      kind: 'named',
      name: 'Devialet',
    });
  });

  it('retire le suffixe appareil sans toucher au titre', () => {
    expect(stripSpotifyPlayDeviceSuffix('Sur la route de Memphis')).toBe('Sur la route de Memphis');
    expect(stripSpotifyPlayDeviceSuffix('Daft Punk sur l’enceinte')).toBe('Daft Punk');
  });

  it('cite la Devialet ou les enceintes visibles, trois au plus', () => {
    expect(connectSpeakerNamesForAsk([], 'Devialet', false)).toEqual(['Devialet']);
    expect(connectSpeakerNamesForAsk(['Phantom'], '', false)).toEqual(['Phantom']);
    expect(connectSpeakerNamesForAsk(['A', 'B', 'C', 'D'], 'Devialet', false)).toEqual(['A', 'B', 'C']);
    expect(spotifyDeviceQuestion(['Devialet'])).toBe('Sur la Devialet ou sur le PC ?');
    expect(spotifyDeviceQuestion(['Devialet'], true)).toBe('Devialet ou PC ?');
    expect(isSpotifyDeviceQuestion('Sur la Devialet ou sur le PC ?')).toBe(true);
    expect(isSpotifyDeviceQuestion('Devialet ou PC ?')).toBe(true);
    expect(isSpotifyDeviceQuestion('Il est midi.')).toBe(false);
  });

  it('comprend la réponse, et oublie la question après 60 s', () => {
    clearSpotifyDeviceAsks();
    const names = ['Devialet', 'Ordinateur'];
    expect(interpretSpotifyDeviceAnswer('la Devialet', names)).toEqual({
      kind: 'named',
      name: 'Devialet',
    });
    expect(interpretSpotifyDeviceAnswer("l'enceinte", names)).toEqual({ kind: 'speaker' });
    expect(interpretSpotifyDeviceAnswer('sur le PC', names)).toEqual({ kind: 'pc' });
    expect(interpretSpotifyDeviceAnswer("l'ordi", names)).toEqual({ kind: 'pc' });
    expect(interpretSpotifyDeviceAnswer("l'ordinateur", names)).toEqual({ kind: 'pc' });
    expect(interpretSpotifyDeviceAnswer('peu importe', names)).toEqual({ kind: 'usual' });
    expect(interpretSpotifyDeviceAnswer("comme d'habitude", names)).toEqual({ kind: 'usual' });
    expect(interpretSpotifyDeviceAnswer('euh ailleurs', names)).toEqual({ kind: 'fuzzy' });
    expect(interpretSpotifyDeviceAnswer('quelle heure est-il ?', names)).toEqual({ kind: 'unrelated' });
    expect(isSpotifyHaltPhrase('stop')).toBe(true);
    expect(isSpotifyHaltPhrase('pause')).toBe(true);
    expect(interpretSpotifyDeviceAnswer('pause', names)).toEqual({ kind: 'unrelated' });

    rememberSpotifyDeviceAsk({
      sessionId: 'salon',
      query: 'Daft Punk',
      askedAt: 1_000,
      retried: false,
      speakerNames: ['Devialet'],
      deviceNames: names,
    });
    rememberSpotifyDeviceAsk({
      sessionId: 'fenetre',
      query: 'Jul',
      askedAt: 1_000,
      retried: false,
      speakerNames: ['Devialet'],
      deviceNames: names,
    });
    expect(peekSpotifyDeviceAsk('salon', 1_000 + 60_000)?.query).toBe('Daft Punk');
    expect(peekSpotifyDeviceAsk('salon', 1_000 + 60_001)).toBeNull();
    expect(peekSpotifyDeviceAsk('fenetre', 1_000 + 60_000)?.query).toBe('Jul');
    clearSpotifyDeviceAsks();
  });
});
