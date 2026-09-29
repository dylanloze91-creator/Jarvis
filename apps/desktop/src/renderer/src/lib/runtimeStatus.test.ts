import { describe, expect, it } from 'vitest';
import { isDemoRuntime } from './runtimeStatus';

describe('statut affiché', () => {
  it('une première installation (fournisseur de démo) n’est pas « en ligne »', () => {
    expect(isDemoRuntime({ providerId: 'mock', usingFallback: false })).toBe(true);
  });

  it('repli faute de clé = démonstration', () => {
    expect(isDemoRuntime({ providerId: 'mock', usingFallback: true })).toBe(true);
  });

  it('Ollama configuré = en ligne', () => {
    expect(isDemoRuntime({ providerId: 'ollama', usingFallback: false })).toBe(false);
  });
});
