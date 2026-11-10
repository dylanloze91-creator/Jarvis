import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESETS, chooseRefinedPrompt, keepOneFramingTag, looksLikeEnglishNegative, looksLikeSdxlPrompt, parseRefinedPrompt, refineUserMessage, REFINE_SYSTEM_PROMPT } from './index.js';

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
    // Cas réel du 9 novembre : un seul nom français laissé dans une consigne anglaise.
    expect(looksLikeSdxlPrompt('femme in lingerie red, anime style, standing, confident smile, minimalistic background, soft lighting')).toBe(false);
    expect(looksLikeSdxlPrompt('woman in red lingerie, anime style, standing, confident smile, minimalistic background, soft lighting')).toBe(true);
    expect(looksLikeSdxlPrompt('view of La Défense towers at dusk, wide angle, photo, sharp')).toBe(true);
    expect(looksLikeSdxlPrompt('fox')).toBe(false);
    expect(looksLikeSdxlPrompt('word '.repeat(130))).toBe(false);
  });

  it('rendu anime : étiquettes Danbooru et noms gardés dans la consigne ; la consigne système garde les noms propres', () => {
    const base = { project: 'perso' as const, preset: DEFAULT_PRESETS.perso, prompt: 'Hinata dans Naruto' };
    expect(refineUserMessage({ ...base, render: 'anime' })).toContain('Danbooru');
    expect(refineUserMessage({ ...base, render: 'anime' })).toContain('hyuuga hinata, naruto (series)');
    expect(refineUserMessage({ ...base, render: 'realiste' })).toContain('realistic photograph');
    expect(refineUserMessage(base)).not.toContain('Rendering');
    expect(REFINE_SYSTEM_PROMPT).toContain('Never replace a named character');
    // Cadrage : « close-up » réservé au portrait du visage (observé : bikini dans un jacuzzi rendu en gros plan du visage).
    expect(REFINE_SYSTEM_PROMPT).toContain('"close-up" only when');
    expect(refineUserMessage({ ...base, render: 'anime' })).toContain('framing tag');
  });

  it('négatif reformulé en français : écarté seul, la consigne reste utilisée', () => {
    const chosen = chooseRefinedPrompt('x', { prompt: 'a young woman with long dark hair, smiling, city street at night, soft light', negative: 'très pudique, pudique, overly explicit' });
    expect(chosen.used).toBe(true);
    expect(chosen.negative).toBeUndefined();
    expect(chooseRefinedPrompt('x', { prompt: 'a young woman with long dark hair, smiling, city street at night, soft light', negative: 'neon signs, extra tails' }).negative).toBe('neon signs, extra tails');
  });

  it('garde une seule étiquette de cadrage (observé le 10 novembre : « upper body … full body » dans la même consigne)', () => {
    const observed = '1girl, hyuuga hinata, naruto (series), bikini, beach, upper body, sitting, wet hair, water splashing, sunlight, full body';
    expect(keepOneFramingTag(observed)).toBe('1girl, hyuuga hinata, naruto (series), bikini, beach, upper body, sitting, wet hair, water splashing, sunlight');
    expect(keepOneFramingTag('a red fox in a forest, full body, soft light')).toBe('a red fox in a forest, full body, soft light');
    expect(keepOneFramingTag('a Close-Up, portrait of a man')).toBe('a Close-Up, portrait of a man');
    expect(chooseRefinedPrompt('x', { prompt: observed }).prompt).not.toContain('full body');
    expect(looksLikeEnglishNegative('blurry, trop flou')).toBe(false);
    expect(looksLikeEnglishNegative('blurry, lowres')).toBe(true);
  });

  it('choix final : reformulée si plausible, sinon l’originale avec la raison', () => {
    const ok = chooseRefinedPrompt('chat sur un toit', { prompt: 'a tabby cat sitting on a terracotta roof, golden hour light, photo, 85mm, sharp focus', negative: 'blurry' });
    expect(ok).toEqual({ prompt: 'a tabby cat sitting on a terracotta roof, golden hour light, photo, 85mm, sharp focus', negative: 'blurry', used: true });
    expect(chooseRefinedPrompt('chat sur un toit', null)).toMatchObject({ prompt: 'chat sur un toit', used: false });
    expect(chooseRefinedPrompt('chat sur un toit', { prompt: 'un chat sur un toit avec des tuiles rouges et le soleil' })).toMatchObject({ used: false, reason: expect.stringContaining('douteuse') });
  });
});
