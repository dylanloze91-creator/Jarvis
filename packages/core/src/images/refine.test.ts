import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESETS, chooseRefinedPrompt, looksLikeSdxlPrompt, parseRefinedPrompt, refineUserMessage, REFINE_SYSTEM_PROMPT } from './index.js';

describe('module images — reformulation pour SDXL', () => {
  it('la consigne au modèle demande un JSON en anglais, ordonné, sans logos', () => {
    expect(REFINE_SYSTEM_PROMPT).toContain('"prompt"');
    expect(REFINE_SYSTEM_PROMPT).toContain('English only');
    expect(REFINE_SYSTEM_PROMPT).toContain('Never add brand logos');
    const message = refineUserMessage({
      prompt: 'un renard roux en sticker',
      project: 'drivers-ink',
      preset: DEFAULT_PRESETS['drivers-ink'],
      style: 'manga',
      fromPhoto: true,
    });
    expect(message).toContain('Project: drivers-ink');
    expect(message).toContain('Request: un renard roux en sticker');
    expect(message).toContain('Requested style: manga');
    expect(message).toContain('image-to-image');
    expect(message).toContain('do not repeat it');
  });

  it('lit la réponse JSON, même entourée de texte ou de ```json', () => {
    expect(parseRefinedPrompt('```json\n{"prompt": " a red fox, sticker ", "negative": "blurry, text"}\n```')).toEqual({ prompt: 'a red fox, sticker', negative: 'blurry, text' });
    expect(parseRefinedPrompt('Voici : {"prompt":"a cat,  on a roof"}')).toEqual({ prompt: 'a cat, on a roof' });
    expect(parseRefinedPrompt('{"negative": "x"}')).toBeNull();
    expect(parseRefinedPrompt('pas de json')).toBeNull();
  });

  it('garde-fou : anglais plausible ; une phrase française ou trop courte est refusée', () => {
    expect(looksLikeSdxlPrompt('a red fox head, bold black outlines, flat colors, white background, sticker, centered, high quality')).toBe(true);
    expect(looksLikeSdxlPrompt('un renard roux avec des contours noirs sur un fond blanc')).toBe(false);
    expect(looksLikeSdxlPrompt('fox')).toBe(false);
    expect(looksLikeSdxlPrompt('word '.repeat(130))).toBe(false);
  });

  it('choix final : reformulée si plausible, sinon l’originale avec la raison', () => {
    const ok = chooseRefinedPrompt('chat sur un toit', { prompt: 'a tabby cat sitting on a terracotta roof, golden hour light, photo, 85mm, sharp focus', negative: 'blurry' });
    expect(ok).toEqual({ prompt: 'a tabby cat sitting on a terracotta roof, golden hour light, photo, 85mm, sharp focus', negative: 'blurry', used: true });
    expect(chooseRefinedPrompt('chat sur un toit', null)).toMatchObject({ prompt: 'chat sur un toit', used: false });
    expect(chooseRefinedPrompt('chat sur un toit', { prompt: 'un chat sur un toit avec des tuiles rouges et le soleil' })).toMatchObject({ used: false, reason: expect.stringContaining('douteuse') });
  });
});
