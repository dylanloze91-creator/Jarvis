import { describe, expect, it } from 'vitest';
import {
  extractSpotifyPlayDeviceHint,
  extractSpotifyTransferTarget,
  isSpotifyTransferPhrase,
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
});
