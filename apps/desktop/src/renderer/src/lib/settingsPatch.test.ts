import { describe, expect, it } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { settingsPatch } from './settingsPatch';

describe('settingsPatch (5.0.64)', () => {
  it('ne renvoie que les clés modifiées par le brouillon', () => {
    const base = parseSettings({ hotkey: 'Control+Space', model: 'qwen2.5:3b' });
    const draft = { ...base, model: 'qwen3.5:4b', voice: { ...base.voice, enabled: true } };
    expect(settingsPatch(base, draft)).toEqual({ model: 'qwen3.5:4b', voice: draft.voice });
  });

  it('un bloc écrit entre-temps par le processus principal n’est pas renvoyé', () => {
    const base = parseSettings({});
    const draft = { ...base, hotkey: 'Alt+J' };
    const patch = settingsPatch(base, draft);
    expect(Object.keys(patch)).toEqual(['hotkey']);
    expect('localLearning' in patch).toBe(false);
  });

  it('brouillon identique = aucune clé', () => {
    const base = parseSettings({});
    expect(settingsPatch(base, { ...base })).toEqual({});
  });
});
