import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import { expressTeam } from '../agent/orchestra.js';
import {
  DEFAULT_PRESETS,
  buildImg2ImgPayload,
  closestFormatForAspect,
  denoisingForFidelity,
  imageAttachmentExtension,
  isImageAttachmentPath,
  lastUserHasImageAttachment,
  referenceFileName,
  sidecarText,
  withAttachmentNotes,
} from './index.js';

describe('module images — photos jointes', () => {
  const attachment = { name: 'moi.jpg', path: 'C:\\dev\\Jarvis_images\\_references\\2026-11-09\\221500-moi.jpg', mime: 'image/jpeg', kind: 'image' as const };

  it('le modèle reçoit une note avec le chemin, le message affiché ne change pas', () => {
    const user = createMessage('user', 'Fais-en un sticker', { attachments: [attachment] });
    const mapped = withAttachmentNotes([createMessage('assistant', 'Bonjour'), user]);
    expect(mapped[0]!.content).toBe('Bonjour');
    expect(mapped[1]!.content).toContain('Fais-en un sticker');
    expect(mapped[1]!.content).toContain('Photo jointe par l’utilisateur : C:\\dev\\Jarvis_images\\_references\\2026-11-09\\221500-moi.jpg');
    expect(mapped[1]!.content).toContain('photoDeBase=');
    expect(user.content).toBe('Fais-en un sticker');
    expect(lastUserHasImageAttachment([user])).toBe(true);
    expect(lastUserHasImageAttachment([createMessage('user', 'Salut')])).toBe(false);
  });

  it('une photo jointe envoie la demande à l’équipe Images même sans le mot « image »', () => {
    const available = new Set(['conversation', 'pc', 'images'] as const);
    expect(expressTeam({ text: 'Fais-en un sticker', history: [], available, hasImageAttachment: true })).toBe('images');
    expect(expressTeam({ text: 'Fais-en un sticker', history: [], available, hasImageAttachment: false })).toBe('images');
    expect(expressTeam({ text: 'Rends-la plus lumineuse', history: [], available, hasImageAttachment: true })).toBe('images');
    expect(expressTeam({ text: 'Rends-la plus lumineuse', history: [], available })).toBeNull();
  });

  it('extensions acceptées, d’après le type puis le nom', () => {
    expect(imageAttachmentExtension('photo.HEIC', 'image/jpeg')).toBe('.jpg');
    expect(imageAttachmentExtension('photo.PNG', '')).toBe('.png');
    expect(imageAttachmentExtension('document.pdf', 'application/pdf')).toBeNull();
    expect(isImageAttachmentPath('C:\\x\\a.webp')).toBe(true);
    expect(isImageAttachmentPath('C:\\x\\a.txt')).toBe(false);
    const names = referenceFileName('Ma Photo été.jpeg', '.jpg', new Date(2026, 10, 9, 22, 15, 0));
    expect(names).toEqual({ folder: '_references/2026-11-09', file: '221500-ma-photo-ete.jpg' });
  });

  it('format d’après la photo et fidélité → force du changement', () => {
    expect(closestFormatForAspect(4000, 3000)).toBe('paysage');
    expect(closestFormatForAspect(1080, 1920)).toBe('9:16');
    expect(closestFormatForAspect(1920, 1080)).toBe('16:9');
    expect(closestFormatForAspect(500, 500)).toBe('carre');
    expect(closestFormatForAspect(0, 10)).toBe('carre');
    expect(denoisingForFidelity(undefined)).toBe(0.55);
    expect(denoisingForFidelity(1)).toBe(0.2);
    expect(denoisingForFidelity(0)).toBe(0.95);
    expect(denoisingForFidelity(0.7)).toBe(0.3);
  });

  it('la requête image vers image reprend la requête texte plus la photo', () => {
    const payload = buildImg2ImgPayload(
      { prompt: 'sticker of this fox', project: 'drivers-ink', format: 'paysage', initImage: { path: 'x.jpg', fidelity: 0.7 } },
      DEFAULT_PRESETS['drivers-ink'],
      {},
      'QUJD',
      denoisingForFidelity(0.7),
    );
    expect(payload.init_images).toEqual(['QUJD']);
    expect(payload.denoising_strength).toBe(0.3);
    expect(payload.resize_mode).toBe(1);
    expect([payload.width, payload.height]).toEqual([1216, 832]);
    const text = sidecarText({ project: 'drivers-ink', userPrompt: 'un sticker', payload, seed: 1, createdAt: new Date(2026, 0, 1), sourceImage: 'C:\\x\\a-source.jpg', fidelity: 0.7 });
    expect(text).toContain('Photo de départ : C:\\x\\a-source.jpg (fidélité 0.7)');
  });
});
