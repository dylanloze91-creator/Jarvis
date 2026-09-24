import { describe, expect, it } from 'vitest';
import { VOICE_TRANSCRIPTION_NOTICE, withVoiceOriginNotice } from './voiceOriginNotice.js';

describe('withVoiceOriginNotice', () => {
  it("laisse le prompt système inchangé pour un message tapé au clavier", () => {
    expect(withVoiceOriginNotice('Tu es Jarvis.', 'text')).toBe('Tu es Jarvis.');
  });

  it("ajoute la note d'origine vocale pour un message transcrit", () => {
    const result = withVoiceOriginNotice('Tu es Jarvis.', 'voice');

    expect(result.startsWith('Tu es Jarvis.')).toBe(true);
    expect(result).toContain(VOICE_TRANSCRIPTION_NOTICE);
  });

  it("ne modifie jamais le prompt système d'origine (nouvelle chaîne)", () => {
    const base = 'Tu es Jarvis.';
    const result = withVoiceOriginNotice(base, 'voice');

    expect(result).not.toBe(base);
    expect(base).toBe('Tu es Jarvis.');
  });
});
