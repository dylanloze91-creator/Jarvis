import { describe, expect, it } from 'vitest';
import { PIPER_VOICE_CREDITS } from './piperCredits.js';

describe('PIPER_VOICE_CREDITS', () => {
  it('nomme Siwis et UPMC avec leurs licences', () => {
    expect(PIPER_VOICE_CREDITS.map((line) => line.license)).toEqual(['CC BY 4.0', 'CC BY-SA 4.0']);
    expect(PIPER_VOICE_CREDITS[0]?.url).toContain('siwis');
    expect(PIPER_VOICE_CREDITS[1]?.url).toContain('upmc');
  });
});
