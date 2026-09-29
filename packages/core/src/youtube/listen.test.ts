import { describe, expect, it, vi } from 'vitest';
import { listAudioOnlyFormats, pickAudioOnlyFormat } from './audioFormat.js';
import { loadYoutubePlayer, youtubeRefusalReason } from './captions.js';
import { CAPTION_FALLBACK_NOTICE, summarizeYoutubeVideo } from './listen.js';

describe('piste audio', () => {
  it('choisit une piste audio directe et ignore la vidéo', () => {
    const formats = listAudioOnlyFormats({
      streamingData: {
        adaptiveFormats: [
          { mimeType: 'video/mp4', url: 'https://rr.googlevideo.com/video', bitrate: 2_000_000 },
          { mimeType: 'audio/webm; codecs="opus"', url: 'https://rr.googlevideo.com/webm', bitrate: 50_000 },
          { mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'https://rr.googlevideo.com/m4a', bitrate: 128_000 },
          { mimeType: 'audio/mp4', signatureCipher: 's=abc', bitrate: 64_000 },
        ],
      },
    });

    expect(formats.map((format) => format.mimeType.startsWith('audio/'))).toEqual([true, true]);
    expect(pickAudioOnlyFormat(formats)?.url).toBe('https://rr.googlevideo.com/m4a');
  });
});

describe('écoute puis condensé', () => {
  const player = {
    videoDetails: { title: 'Séance' },
    streamingData: {
      adaptiveFormats: [
        { mimeType: 'audio/mp4', url: 'https://rr.googlevideo.com/audio', bitrate: 128_000 },
      ],
    },
  };

  it('transcrit l’audio, efface le fichier, et n’annonce pas les sous-titres', async () => {
    const deleteAudio = vi.fn(async () => undefined);
    const readCaptions = vi.fn(async () => ({ text: 'ne pas utiliser', languageCode: 'fr' }));
    const progress: string[] = [];

    const result = await summarizeYoutubeVideo('https://youtu.be/dQw4w9WgXcQ', {
      loadPlayer: async () => player,
      downloadAudio: async () => '/tmp/jarvis-yt/piste',
      deleteAudio,
      transcribeFile: async (_path, onProgress) => {
        onProgress('Écoute de la vidéo, partie 1 sur 1…');
        return 'Le CAC est à 7200 points.';
      },
      readCaptions,
      complete: async (_system, user) =>
        user.includes('Rédige UN condensé')
          ? 'Le CAC est à 7200 points.'
          : 'Le CAC est à 7200 points.',
      onProgress: (message) => progress.push(message),
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('7200');
    expect(result.content).not.toContain(CAPTION_FALLBACK_NOTICE);
    expect(readCaptions).not.toHaveBeenCalled();
    expect(deleteAudio).toHaveBeenCalledWith('/tmp/jarvis-yt/piste');
    expect(progress).toContain('Téléchargement de la piste audio…');
    expect(progress.some((message) => message.startsWith('Écoute de la vidéo'))).toBe(true);
  });

  it('dit que les sous-titres ont remplacé l’écoute, et efface quand même le fichier', async () => {
    const deleteAudio = vi.fn(async () => undefined);

    const result = await summarizeYoutubeVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ', {
      loadPlayer: async () => player,
      downloadAudio: async () => '/tmp/jarvis-yt/piste',
      deleteAudio,
      transcribeFile: async () => {
        throw new Error('whisper indisponible');
      },
      readCaptions: async () => ({
        text: 'Le CAC est à 7200 points. Publicité pour un courtier.',
        languageCode: 'fr',
      }),
      complete: async () => 'Le CAC est à 7200 points.',
    });

    expect(result.ok).toBe(true);
    expect(result.content.startsWith(CAPTION_FALLBACK_NOTICE)).toBe(true);
    expect(result.content).toContain('7200');
    expect(deleteAudio).toHaveBeenCalled();
  });

  it('dit que YouTube a refusé l’accès au lieu de prétendre qu’il n’y a pas de sous-titres', async () => {
    const complete = vi.fn(async () => 'ne doit pas être appelé');
    const result = await summarizeYoutubeVideo('https://www.youtube.com/watch?v=jNQXAC9IVRw', {
      loadPlayer: async () => ({
        playabilityStatus: {
          status: 'LOGIN_REQUIRED',
          reason: "Connectez-vous pour confirmer que vous n'êtes pas un robot",
        },
      }),
      downloadAudio: async () => '/tmp/jarvis-yt/piste',
      deleteAudio: async () => undefined,
      transcribeFile: async () => '',
      readCaptions: async () => null,
      complete,
    });

    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/YouTube a refusé l'accès/);
    expect(result.content).toMatch(/pas un robot/);
    expect(result.content).not.toMatch(/n'a pas de sous-titres/);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('lecteur YouTube refusé', () => {
  it('essaie le client suivant quand le premier renvoie LOGIN_REQUIRED', async () => {
    const refused = {
      playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'robot' },
    };
    const playable = { playabilityStatus: { status: 'OK' }, videoDetails: { title: 'Vidéo' } };
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      const body = JSON.stringify(calls === 1 ? refused : playable);
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const player = await loadYoutubePlayer('jNQXAC9IVRw', fetchImpl);
    expect(youtubeRefusalReason(player)).toBeNull();
    expect(calls).toBe(2);
  });

  it('rend le lecteur refusé si aucun client ne passe, pour pouvoir le dire', async () => {
    const refused = { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'robot' } };
    const fetchImpl = (async (url: string) =>
      String(url).includes('/watch?')
        ? new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(JSON.stringify(refused), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })) as unknown as typeof fetch;

    const player = await loadYoutubePlayer('jNQXAC9IVRw', fetchImpl);
    expect(youtubeRefusalReason(player)).toBe('robot');
  });
});
