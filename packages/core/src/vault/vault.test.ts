import { describe, expect, it } from 'vitest';
import { redactValue } from '../security/redact.js';
import { parseSettings, settingsSchema } from '../settings.js';
import { SECRET_MARKER, SECRET_SETTING_PATHS, applySecretEdit, blankSecrets, maskSecrets, readSecret, secretSettingPaths } from './secrets.js';

describe('coffre des clés', () => {
  it('liste les secrets du schéma, et seulement ceux que redactValue masque', () => {
    const paths = secretSettingPaths(settingsSchema);
    expect(paths).toEqual(SECRET_SETTING_PATHS);
    expect(paths).toEqual(
      expect.arrayContaining(['apiKey', 'googleClientSecret', 'searchApiKey', 'marketDataApiKey', 'roverToken', 'siteBlockToken', 'voice.apiKey']),
    );
    const sample = parseSettings({
      apiKey: 'sk-exemple-12345678',
      searchApiKey: 'tvly-exemple',
      marketDataApiKey: 'finnhub-exemple',
      googleClientSecret: 'GOCSPX-exemple',
      siteBlockToken: 'jeton-site',
      roverToken: 'jeton-robot',
      voice: { apiKey: 'voix-secrete' },
    });
    const redacted = redactValue(sample) as Record<string, unknown>;
    for (const path of paths) {
      const leaf = path.split('.').at(-1) ?? path;
      expect(redacted[leaf] === '[REDACTED]' || path.includes('.')).toBe(true);
    }
    const voice = redacted.voice as Record<string, unknown>;
    expect(voice.apiKey).toBe('[REDACTED]');
    expect(redacted.spotifyClientId).toBe('');
    expect(paths).not.toContain('spotifyClientId');
    expect(paths).not.toContain('googleClientId');
  });

  it('migre une clé en clair : settings.json et le marqueur, pas la clé', () => {
    const current = parseSettings({ apiKey: 'sk-en-clair-123456', provider: 'openai' });
    expect(parseSettings({})).not.toHaveProperty('coffre');
    const edited = applySecretEdit(parseSettings({ provider: 'openai' }), { apiKey: 'sk-en-clair-123456', provider: 'openai' }, {}, true);
    expect(readSecret(edited.disk, 'apiKey')).toBe('');
    expect(readSecret(edited.settings, 'apiKey')).toBe('sk-en-clair-123456');
    expect(JSON.stringify(edited.disk)).not.toContain('sk-en-clair-123456');
    const shown = maskSecrets(edited.settings, edited.secrets);
    expect(readSecret(shown, 'apiKey')).toBe(SECRET_MARKER);
    expect(JSON.stringify(shown)).not.toContain('sk-en-clair');
    const kept = applySecretEdit(edited.settings, { apiKey: SECRET_MARKER }, edited.secrets, true);
    expect(kept.secrets.apiKey).toBe('sk-en-clair-123456');
    const cleared = applySecretEdit(edited.settings, { apiKey: '' }, edited.secrets, true);
    expect(cleared.secrets.apiKey).toBeUndefined();
    const replaced = applySecretEdit(edited.settings, { apiKey: 'sk-nouvelle-123456' }, edited.secrets, true);
    expect(replaced.secrets.apiKey).toBe('sk-nouvelle-123456');
    expect(JSON.stringify(blankSecrets(current))).not.toContain('sk-en-clair');
  });

  it('ne crée pas roverToken ni un bloc absent', () => {
    const plain = parseSettings({});
    expect(plain).not.toHaveProperty('roverToken');
    expect(blankSecrets(plain)).not.toHaveProperty('roverToken');
    expect(maskSecrets(plain, { roverToken: 'jeton-robot' })).not.toHaveProperty('roverToken');
    const edited = applySecretEdit(plain, {}, { roverToken: 'jeton-robot' }, true);
    expect(edited.settings).not.toHaveProperty('roverToken');
    expect(edited.disk).not.toHaveProperty('roverToken');
  });

  it('sans chiffrement, le comportement d’avant est gardé', () => {
    const edited = applySecretEdit(parseSettings({}), { apiKey: 'sk-clair-12345678', provider: 'openai' }, {}, false);
    expect(readSecret(edited.disk, 'apiKey')).toBe('sk-clair-12345678');
    expect(edited.secrets).toEqual({});
  });
});
