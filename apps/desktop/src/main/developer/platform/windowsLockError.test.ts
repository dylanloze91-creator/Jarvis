import { describe, expect, it } from 'vitest';
import { windowsLockMessage } from './windowsLockError.js';

describe('message de verrou Windows', () => {
  it('explique EPERM en français avec une action OneDrive/antivirus', () => {
    const message = windowsLockMessage(
      'EPERM: operation not permitted, rename index.lock',
      'C:\\Users\\Moi\\OneDrive\\Projet',
    );
    expect(message).toMatch(/Windows bloque/);
    expect(message).toMatch(/OneDrive/);
    expect(message).toMatch(/antivirus/);
  });

  it('laisse les autres erreurs à leur appelant', () => {
    expect(windowsLockMessage('npm ERR! code E404')).toBeNull();
  });
});

