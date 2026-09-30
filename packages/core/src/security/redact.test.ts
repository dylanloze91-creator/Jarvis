import { describe, expect, it } from 'vitest';
import { redactSecrets, redactValue } from './redact.js';

describe('redactSecrets', () => {
  it('masque une clé API, un Bearer et un jeton Spotify', () => {
    const raw =
      'Authorization: Bearer BQC-spotify-token-secret-value apiKey=sk-live-abcdefghijklmnopqrstuvwxyz';
    const safe = redactSecrets(raw);
    expect(safe).not.toContain('BQC-spotify-token-secret-value');
    expect(safe).not.toContain('sk-live-abcdefghijklmnopqrstuvwxyz');
    expect(safe).toContain('[REDACTED]');
    expect(safe).toContain('Authorization:');
  });

  it('masque un refresh token, un en-tête Authorization et le jeton SiteBlock', () => {
    const raw = JSON.stringify({
      refresh_token: 'spotify-refresh-very-long-secret',
      siteBlockToken: 'siteblock-local-token',
      authorization: 'Bearer google-access-token-xyz',
    });
    const safe = redactSecrets(raw);
    expect(safe).not.toContain('spotify-refresh-very-long-secret');
    expect(safe).not.toContain('siteblock-local-token');
    expect(safe).not.toContain('google-access-token-xyz');
  });

  it('laisse un message ordinaire intact', () => {
    expect(redactSecrets('La recherche Internet n’a pas répondu à temps.')).toBe(
      'La recherche Internet n’a pas répondu à temps.',
    );
  });
});

describe('redactValue', () => {
  it('masque les champs sensibles d’un objet d’arguments', () => {
    const safe = redactValue({
      query: 'actualité',
      apiKey: 'sk-secret-value-12345678',
      nested: { refresh_token: 'rt-secret-value' },
    }) as { query: string; apiKey: string; nested: { refresh_token: string } };
    expect(safe.query).toBe('actualité');
    expect(safe.apiKey).toBe('[REDACTED]');
    expect(safe.nested.refresh_token).toBe('[REDACTED]');
  });
});
