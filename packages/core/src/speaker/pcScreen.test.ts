import { describe, expect, it } from 'vitest';
import {
  SPEAKER_DETAIL_ON_PC,
  SPEAKER_IMAGE_READY,
  SPEAKER_IMAGE_WAIT,
  SPEAKER_LIST_ON_PC,
  decideSpeakerSpeech,
  earlySpeakerUtterance,
  speakerReplyForEars,
} from './pcScreen.js';
import { SPEAKER_CONFIRMATION_REFUSAL } from './speaker.js';

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

describe('earlySpeakerUtterance', () => {
  it('attend tant que la partie dite n’est pas complète', () => {
    expect(earlySpeakerUtterance('Première phrase. Deuxième phrase.', false).ready).toBe(false);
  });

  it('répond dès trois phrases, avec le renvoi vers le PC, sans attendre la fin', () => {
    const partial = 'Première phrase. Deuxième phrase. Troisième phrase. Quatrième';
    const early = earlySpeakerUtterance(partial, false);
    expect(early.ready).toBe(true);
    expect(early.showOnPc).toBe(true);
    expect(early.spoken).toContain('Troisième phrase.');
    expect(early.spoken).not.toContain('Quatrième');
    expect(early.spoken.endsWith(SPEAKER_DETAIL_ON_PC)).toBe(true);
  });

  it('une réponse courte déjà finie reste celle d’aujourd’hui', () => {
    expect(earlySpeakerUtterance('Il est 14 h.', true)).toEqual({
      ready: true,
      spoken: 'Il est 14 h.',
      showOnPc: false,
    });
  });

  it('une commande Spotify dit la phrase courte et montre le détail sur le PC', () => {
    const decision = decideSpeakerSpeech({
      reply: 'Lecture de Get Lucky — Daft Punk sur la Devialet.',
      finished: true,
      refused: false,
      mission: false,
      notAddressed: false,
      tools: ['spotify_play'],
      userText: 'mets Get Lucky',
    });
    expect(decision.spoken).toBe('C’est parti.');
    expect(decision.showOnPc).toBe(true);
    expect(decision.reflex).toBe(true);
  });

  it('une carte d’enceinte reste refusée', () => {
    const decision = decideSpeakerSpeech({
      reply: '',
      finished: false,
      refused: true,
      mission: false,
      notAddressed: false,
      tools: [],
      userText: 'supprime le fichier',
    });
    expect(decision.spoken).toBe(SPEAKER_CONFIRMATION_REFUSAL);
  });

  it('300 caractères suffisent, même sans trois phrases', () => {
    const partial = `${'mot '.repeat(80)}suite`;
    const early = earlySpeakerUtterance(partial, false);
    expect(early.ready).toBe(true);
    expect(early.spoken.endsWith(SPEAKER_DETAIL_ON_PC)).toBe(true);
  });
});
