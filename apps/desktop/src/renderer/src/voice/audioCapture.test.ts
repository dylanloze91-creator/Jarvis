import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeMicrophoneError, openMicrophone } from './audioCapture';

function domError(name: string, message = ''): Error {
  return Object.assign(new Error(message), { name });
}

describe('ouverture du micro', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reprend le micro par défaut si celui des réglages a été débranché', async () => {
    const stream = { id: 'défaut' };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(domError('OverconstrainedError'))
      .mockResolvedValueOnce(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await expect(openMicrophone('casque-usb')).resolves.toBe(stream);
    expect(getUserMedia.mock.calls[1]?.[0]).toEqual({ audio: true });
  });

  it('ne contourne pas un refus d’autorisation', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(domError('NotAllowedError', 'Permission denied'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    await expect(openMicrophone('casque-usb')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('explique les erreurs en français, jamais une ligne vide', () => {
    expect(describeMicrophoneError(domError('NotFoundError', 'Requested device not found'))).toBe(
      'Aucun micro détecté. Branche un micro, ou choisis-en un autre dans les réglages.',
    );
    expect(describeMicrophoneError(domError('NotAllowedError'))).toMatch(/Confidentialité/);
    expect(describeMicrophoneError(domError('OverconstrainedError', ''))).toMatch(/Aucun micro/);
    expect(describeMicrophoneError(new Error(''))).toBe('Micro indisponible.');
  });
});
