import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
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

describe('settings.json : aucune clé en clair', () => {
  const secrets = {
    apiKey: 'sk-live-llmkey0123456789abcdef',
    searchApiKey: 'BSA-brave-key-0123456789abcdef',
    marketDataApiKey: 'finnhubkey0123456789abcd',
    googleClientSecret: 'GOCSPX-googlesecret0123456789',
    siteBlockToken: 'siteblock-local-token-0123456789',
    voiceApiKey: 'voice-openai-key-0123456789abcdef',
  };
  const settings = parseSettings({
    provider: 'openai',
    apiKey: secrets.apiKey,
    searchProvider: 'brave',
    searchApiKey: secrets.searchApiKey,
    marketDataProvider: 'finnhub',
    marketDataApiKey: secrets.marketDataApiKey,
    googleClientId: '1234-abc.apps.googleusercontent.com',
    googleClientSecret: secrets.googleClientSecret,
    siteBlockToken: secrets.siteBlockToken,
    spotifyClientId: '0123456789abcdef0123456789abcdef',
    voice: { apiKey: secrets.voiceApiKey },
  });

  it.each([
    ['tel qu’écrit sur le disque', JSON.stringify(settings, null, 2)],
    ['compact', JSON.stringify(settings)],
  ])(
    'texte du fichier %s (lu par read_file) : clés masquées, réglages ordinaires intacts',
    (_label, raw) => {
      const safe = redactSecrets(raw);
      for (const secret of Object.values(secrets)) expect(safe).not.toContain(secret);
      expect(safe).toMatch(/"searchApiKey": ?"\[REDACTED\]"/);
      expect(safe).toMatch(/"marketDataApiKey": ?"\[REDACTED\]"/);
      expect(safe).toMatch(/"googleClientId": ?"1234-abc\.apps\.googleusercontent\.com"/);
      expect(safe).toMatch(/"spotifyClientId": ?"0123456789abcdef0123456789abcdef"/);
      expect(safe).toMatch(/"searchProvider": ?"brave"/);
      expect(safe).toMatch(/"marketDataProvider": ?"finnhub"/);
    },
  );

  it('objet de réglages : mêmes champs masqués par redactValue', () => {
    const safe = redactValue(settings) as Record<string, unknown> & {
      voice: Record<string, unknown>;
    };
    expect(safe.searchApiKey).toBe('[REDACTED]');
    expect(safe.marketDataApiKey).toBe('[REDACTED]');
    expect(safe.googleClientSecret).toBe('[REDACTED]');
    expect(safe.voice.apiKey).toBe('[REDACTED]');
    expect(safe.googleClientId).toBe('1234-abc.apps.googleusercontent.com');
    expect(safe.searchProvider).toBe('brave');
  });

  it('clé Tavily brute masquée, en-tête x-api-key masqué', () => {
    expect(redactSecrets('Tavily a refusé tvly-dev-0123456789abcdef.')).toBe(
      'Tavily a refusé [REDACTED].',
    );
    expect(redactSecrets('x-api-key: abcdef0123456789')).toBe('x-api-key: [REDACTED]');
  });

  it('noms qui ressemblent sans être des secrets : texte inchangé', () => {
    const text =
      'maxTokens: 1024, tokenCount=42, searchProvider: brave, apiKeyHint: voir les réglages, authorizationUrl=https://example.com';
    expect(redactSecrets(text)).toBe(text);
  });

  it('reste linéaire sur un long texte pathologique', () => {
    const long = `${'a-'.repeat(100_000)} ${'b'.repeat(100_000)} searchApiKey=abc123`;
    const started = performance.now();
    const safe = redactSecrets(long);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(safe.endsWith('searchApiKey=[REDACTED]')).toBe(true);
  });
});
