import { describe, expect, it } from 'vitest';
import { describeMicrophoneError } from './audioCapture';

function domError(name: string, message = ''): Error {
  return Object.assign(new Error(message), { name });
}

describe('messages du micro', () => {
  it('garde le nom exact de l’erreur, jamais un « Micro indisponible » nu', () => {
    expect(describeMicrophoneError(domError('NotFoundError', 'Requested device not found'))).toMatch(
      /^Aucune entrée audio trouvée \(NotFoundError : Requested device not found\)\./,
    );
    expect(describeMicrophoneError(domError('NotAllowedError', 'Permission denied by system'))).toMatch(
      /Confidentialité et sécurité > Microphone/,
    );
    expect(describeMicrophoneError(domError('OverconstrainedError', ''))).toMatch(/\(OverconstrainedError\)/);
    expect(describeMicrophoneError(new Error(''))).toMatch(/^Le micro ne s’ouvre pas \(Error\)/);
    expect(describeMicrophoneError(new Error(''))).not.toMatch(/^Micro indisponible/);
  });
});
