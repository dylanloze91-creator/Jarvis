import { describe, expect, it } from 'vitest';
import { extractYoutubeUrl, parseYoutubeVideoId } from './url.js';

const ID = 'dQw4w9WgXcQ';

describe('liens YouTube', () => {
  it('reconnaît watch, youtu.be, shorts et live', () => {
    expect(parseYoutubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYoutubeVideoId(`https://youtube.com/watch?v=${ID}&t=30s`)).toBe(ID);
    expect(parseYoutubeVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(parseYoutubeVideoId(`https://youtu.be/${ID}?t=12`)).toBe(ID);
    expect(parseYoutubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYoutubeVideoId(`https://m.youtube.com/live/${ID}?feature=share`)).toBe(ID);
  });

  it('refuse un lien qui n’est pas une vidéo YouTube', () => {
    expect(parseYoutubeVideoId('https://example.com/watch?v=' + ID)).toBeNull();
    expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=court')).toBeNull();
    expect(parseYoutubeVideoId('https://www.youtube.com/@chaine')).toBeNull();
  });

  it('extrait le lien du dernier texte, sans la ponctuation collée', () => {
    expect(extractYoutubeUrl(`Résume https://youtu.be/${ID}.`)).toBe(`https://youtu.be/${ID}`);
    expect(extractYoutubeUrl('pas de lien')).toBeNull();
  });
});
