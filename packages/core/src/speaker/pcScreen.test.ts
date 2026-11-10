import { describe, expect, it } from 'vitest';
import {
  SPEAKER_DETAIL_ON_PC,
  SPEAKER_IMAGE_READY,
  SPEAKER_IMAGE_WAIT,
  SPEAKER_LIST_ON_PC,
  speakerReplyForEars,
} from './pcScreen.js';

describe('speakerReplyForEars', () => {
  it('laisse une phrase courte telle quelle, sans ouvrir l’écran', () => {
    const reply = speakerReplyForEars('Il est 14 h.');
    expect(reply).toEqual({ spoken: 'Il est 14 h.', showOnPc: false });
  });

  it('dit que l’image est sur le PC', () => {
    const reply = speakerReplyForEars(
      'Image générée (1024×1024, projet perso) :\n- C:/dev/Jarvis_images/perso/chat.png — graine 3',
    );
    expect(reply.spoken).toBe(SPEAKER_IMAGE_READY);
    expect(reply.showOnPc).toBe(true);
    expect(SPEAKER_IMAGE_WAIT).toMatch(/environ une minute/);
  });

  it('résume une liste et un long texte', () => {
    const list = ['Voici :', '- un', '- deux', '- trois', '- quatre'].join('\n');
    expect(speakerReplyForEars(list).spoken).toBe(SPEAKER_LIST_ON_PC);
    const long =
      'Première phrase. Deuxième phrase. Troisième phrase. Quatrième phrase qui ne doit pas être lue.';
    const spoken = speakerReplyForEars(long);
    expect(spoken.showOnPc).toBe(true);
    expect(spoken.spoken).toContain('Première phrase.');
    expect(spoken.spoken).toContain('Troisième phrase.');
    expect(spoken.spoken).not.toContain('Quatrième');
    expect(spoken.spoken.endsWith(SPEAKER_DETAIL_ON_PC)).toBe(true);
  });

  it('ne lit pas le code ni les sources', () => {
    const code = speakerReplyForEars('Le correctif est prêt.\n```ts\nconst secret = 1;\n```');
    expect(code.spoken).not.toContain('secret');
    expect(code.spoken).toContain(SPEAKER_DETAIL_ON_PC);
    expect(code.showOnPc).toBe(true);
  });
});
