import { describe, expect, it } from 'vitest';
import { readGoogleHealth } from './googleProbe.js';

describe('sonde Google', () => {
  it('ne démarre pas Google : fichier de jeton si rien n’est chargé', async () => {
    let reads = 0;
    const result = await readGoogleHealth({
      loaded: null,
      readToken: async () => {
        reads += 1;
        return { refreshToken: 'jeton', needsReconsent: true };
      },
    });
    expect(reads).toBe(1);
    expect(result).toEqual({ connected: true, needsReconsent: true });
  });

  it('relit l’état déjà chargé sans rouvrir le fichier', async () => {
    let reads = 0;
    const result = await readGoogleHealth({
      loaded: { connected: true, needsReconsent: false },
      readToken: async () => {
        reads += 1;
        return null;
      },
    });
    expect(reads).toBe(0);
    expect(result.connected).toBe(true);
  });
});
