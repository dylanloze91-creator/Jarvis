import { describe, expect, it } from 'vitest';
import { VIDEO_DUREE_MAX_S } from '@jarvis/core';
import { estVideo, instantsEchantillons, versBase64 } from './videoYeux';

describe('vidéo jointe, dans la fenêtre', () => {
  it('une image par seconde, trois minutes au plus, au moins une image', () => {
    expect(instantsEchantillons(4.5)).toEqual([0, 1, 2, 3, 4]);
    expect(instantsEchantillons(0.3)).toEqual([0]);
    const long = instantsEchantillons(600);
    expect(long).toHaveLength(VIDEO_DUREE_MAX_S);
    expect(long.at(-1)).toBe(VIDEO_DUREE_MAX_S - 1);
  });

  it('base64 par morceaux, identique à Buffer', () => {
    const octets = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
    expect(versBase64(octets)).toBe(Buffer.from(octets).toString('base64'));
    expect(versBase64(new Uint8Array())).toBe('');
  });

  it('reconnaît les vidéos par leur type ou leur extension, pas les photos', () => {
    expect(estVideo({ type: 'video/mp4', name: 'a' })).toBe(true);
    expect(estVideo({ type: '', name: 'IMG_0042.MOV' })).toBe(true);
    expect(estVideo({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
  });
});
