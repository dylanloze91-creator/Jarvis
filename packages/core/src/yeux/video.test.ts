import { describe, expect, it } from 'vitest';
import {
  choisirImagesCles,
  demandeReponseVideo,
  ecartImages,
  finirReponseVideo,
  flottantsVersPcm16,
  formatInstant,
  IMAGES_CLES_MAX,
  lireVideoJointe,
  morceauxAudio,
  pcm16VersFlottants,
  reponseVideoSansModele,
  VIDEO_AUDIO_TAUX,
  type EchantillonVideo,
} from './video.js';

const gris = (v: number) => new Array(16).fill(v) as number[];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
const decoder = (b: string) => new Uint8Array(Buffer.from(b, 'base64'));

describe('images clés', () => {
  it('une toutes les 5 s quand rien ne change', () => {
    const e: EchantillonVideo[] = Array.from({ length: 21 }, (_, t) => ({ t, gris: gris(100) }));
    expect(choisirImagesCles(e).map((i) => e[i]!.t)).toEqual([0, 5, 10, 15, 20]);
  });
  it('plus tôt quand l’image change, jamais à moins de 2 s', () => {
    // L'image change à 1 s (trop tôt), diffère encore à 2 s (prise) ; puis plus rien jusqu'à 7 s.
    const e: EchantillonVideo[] = Array.from({ length: 10 }, (_, t) => ({ t, gris: gris(t >= 1 ? 200 : 20) }));
    expect(choisirImagesCles(e).map((i) => e[i]!.t)).toEqual([0, 2, 7]);
  });
  it('40 au plus, la première gardée, réparties jusqu’à la fin', () => {
    const e: EchantillonVideo[] = Array.from({ length: 180 }, (_, t) => ({ t, gris: gris(t % 4 < 2 ? 0 : 255) }));
    const c = choisirImagesCles(e);
    expect(c.length).toBeLessThanOrEqual(IMAGES_CLES_MAX);
    expect(c[0]).toBe(0);
    expect(e[c.at(-1)!]!.t).toBeGreaterThan(170);
  });
  it('écart et instants', () => {
    expect(ecartImages(gris(0), gris(255))).toBe(1);
    expect(formatInstant(42)).toBe('0:42');
    expect(formatInstant(125.7)).toBe('2:05');
  });
});

describe('vidéo reçue', () => {
  it('lit une vidéo correcte, son compris', () => {
    const son = flottantsVersPcm16(new Float32Array([0, 0.5, -0.5]));
    const r = lireVideoJointe(
      {
        nom: 'C:\\x\\soudure.mov',
        duree: 30,
        tronquee: false,
        images: [
          { t: 0, jpegBase64: JPEG },
          { t: 4, jpegBase64: JPEG },
        ],
        audioPcm16Base64: Buffer.from(son).toString('base64'),
      },
      decoder,
      1,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.video.nom).toBe('C:xsoudure.mov');
    expect(r.video.images.map((i) => i.t)).toEqual([0, 4]);
    expect(Array.from(r.video.audio!).map((x) => Math.round(x * 10) / 10)).toEqual([0, 0.5, -0.5]);
  });
  it('refuse ce qui n’est pas propre', () => {
    const base = { nom: 'v', duree: 10, tronquee: false };
    expect(lireVideoJointe({ ...base, images: [] }, decoder, 0)).toMatchObject({ ok: false });
    expect(lireVideoJointe({ ...base, images: [{ t: 0, jpegBase64: Buffer.from('PNG!').toString('base64') }] }, decoder, 0)).toMatchObject({
      ok: false,
      raison: 'une image n’est pas un JPEG',
    });
    expect(
      lireVideoJointe(
        {
          ...base,
          images: [
            { t: 3, jpegBase64: JPEG },
            { t: 1, jpegBase64: JPEG },
          ],
        },
        decoder,
        0,
      ),
    ).toMatchObject({ ok: false });
    expect(lireVideoJointe({ ...base, images: Array.from({ length: 41 }, (_, t) => ({ t, jpegBase64: JPEG })) }, decoder, 0)).toMatchObject({ ok: false });
    const long = Buffer.alloc(181 * VIDEO_AUDIO_TAUX * 2).toString('base64');
    expect(lireVideoJointe({ ...base, images: [{ t: 0, jpegBase64: JPEG }], audioPcm16Base64: long }, decoder, 0)).toMatchObject({ ok: false, raison: 'son trop long' });
  });
  it('une vidéo de plus de 3 minutes est marquée coupée', () => {
    const r = lireVideoJointe({ nom: 'v', duree: 400, tronquee: false, images: [{ t: 0, jpegBase64: JPEG }] }, decoder, 0);
    expect(r.ok && r.video.tronquee).toBe(true);
  });
  it('son en morceaux de 20 s avec leur instant', () => {
    const m = morceauxAudio(new Float32Array(45 * VIDEO_AUDIO_TAUX));
    expect(m.map((x) => [x.t, x.pcm.length / VIDEO_AUDIO_TAUX])).toEqual([
      [0, 20],
      [20, 20],
      [40, 5],
    ]);
    expect(pcm16VersFlottants(new Uint8Array([0, 0x80])).at(0)).toBe(-1);
  });
});

describe('réponse sur une vidéo', () => {
  const instants = [
    { t: 0, description: 'Un fer à souder approche une carte.', texteLu: [] },
    { t: 42, description: 'Une soudure brillante.', texteLu: ['ESP32'] },
  ];
  it('la demande donne les moments, ce qui se voit et ce qui se dit', () => {
    const d = demandeReponseVideo({ question: 'résume', video: { nom: 'v.mp4', duree: 200, tronquee: true }, instants, paroles: [{ t: 40, texte: 'Voilà la soudure.' }] });
    expect(d).toContain('- 0:42 : Une soudure brillante. [texte lu : ESP32]');
    expect(d).toContain('- 0:40 : Voilà la soudure.');
    expect(d).toContain('seules les 3 premières minutes');
    expect(demandeReponseVideo({ question: 'q', video: { nom: 'v', duree: 5, tronquee: false }, instants, paroles: null })).toContain('pas de son');
  });
  it('sans modèle : les images et les paroles telles quelles', () => {
    expect(reponseVideoSansModele({ instants, paroles: null })).toContain('- 0:42 : Une soudure brillante.');
  });
  it('dit la coupure, le son raté, et ce qui a regardé', () => {
    const f = finirReponseVideo({ texte: 'On soude.', video: { tronquee: true }, images: 12, son: 'echec', modeleVision: 'gemma3:4b', oral: false });
    expect(f).toMatch(/^J'ai regardé les 3 premières minutes\./);
    expect(f).toContain("Je n'ai pas pu écouter le son");
    expect(f).toContain('gemma3:4b sur 12 images clés');
    expect(finirReponseVideo({ texte: 'On soude.', video: { tronquee: false }, images: 1, son: 'transcrit', modeleVision: 'g', oral: true })).toBe('On soude.');
  });
});
