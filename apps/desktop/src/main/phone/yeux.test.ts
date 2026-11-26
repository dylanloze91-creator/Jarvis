import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { VIDEO_JOINTE_JSON_MAX } from '@jarvis/core';
import type { ChatEvent, SendChatInput } from '../../shared/ipc.js';
import { PHONE_IMAGE_TTL_MS, PhoneServer, type PhoneChat, type PhoneSender } from './server.js';
import { PhoneStore } from './store.js';

/**
 * Les yeux sur le téléphone (Jarvis Test) : « Montrer à Jarvis » envoie une photo (jeton exigé,
 * image seulement, 5 Mo) ; une photo de Jarvis part comme un lien à usage unique, court, lié au
 * téléphone qui l'a reçue. Politique de la page : `img-src 'self' blob:` seulement.
 */
const dir = mkdtempSync(join(tmpdir(), 'jarvis-phone-yeux-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(800).fill(4), 0xff, 0xd9]);

function call(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: Buffer | string; type?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
        headers: {
          Host: 'pc.tail1a2b.ts.net',
          ...(options.type ? { 'Content-Type': options.type } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (res) => {
        const morceaux: Buffer[] = [];
        res.on('data', (c: Buffer) => morceaux.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(morceaux) }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

let servers: PhoneServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
});

async function setup(options: { now?: () => number; sansVideo?: boolean } = {}) {
  const store = new PhoneStore(() => join(dir, `phone-${Math.random().toString(36).slice(2)}.json`));
  await store.load();
  const recues: { octets: Uint8Array; type: string; appareil: string }[] = [];
  const videos: { video: unknown; appareil: string }[] = [];
  const chat: PhoneChat = {
    send: async (sender: PhoneSender, _input: SendChatInput) => {
      sender.send('', { type: 'yeux', messageId: 'm1', photo: { photoId: 'photo-1', prisA: 1000, camera: 'Imprimante' } } as ChatEvent);
      sender.send('', { type: 'done', conversationId: 'c1', messages: [] } as ChatEvent);
    },
    respondConfirmation: () => undefined,
    cancel: () => undefined,
  };
  const server = new PhoneServer({
    store,
    chat,
    validateTeam: async () => ({ ok: true }),
    conversation: async () => null,
    icon: async () => null,
    version: () => 'test',
    phoneVoice: async () => 'device',
    recevoirPhoto: async (photo) => {
      recues.push(photo);
      return { ok: true };
    },
    photoYeux: (photoId) => (photoId === 'photo-1' ? { type: 'image/jpeg', data: new Uint8Array(JPEG) } : null),
    ...(options.sansVideo
      ? {}
      : {
          recevoirVideo: async (video: unknown, appareil: string) => {
            const images = (video as { images?: unknown[] })?.images;
            if (!Array.isArray(images) || !images.length) return { ok: false as const, error: 'Vidéo refusée : aucune image tirée de la vidéo.' };
            videos.push({ video, appareil });
            return { ok: true as const };
          },
        }),
    ...(options.now ? { now: options.now } : {}),
  });
  await server.start(0);
  servers.push(server);
  const port = server.port!;
  const relier = async (nom: string): Promise<string> => {
    const { code } = server.startPairing();
    const r = await call(port, '/api/pair', { body: JSON.stringify({ code, name: nom }), type: 'application/json' });
    return (JSON.parse(r.body.toString('utf8')) as { token: string }).token;
  };
  return { port, recues, videos, relier };
}

async function lienDeLaPhoto(port: number, token: string): Promise<{ image: string; prisA: number; camera: string; type: string }> {
  const r = await call(port, '/api/chat', { token, body: JSON.stringify({ text: "Montre-moi l'impression" }), type: 'application/json' });
  const evenements = r.body
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; image: string; prisA: number; camera: string });
  return evenements.find((e) => e.type === 'yeux')!;
}

describe('les yeux sur le téléphone', () => {
  it('« Montrer à Jarvis » avec une vidéo : images clés en JSON, jeton exigé, refus dits, taille bornée', async () => {
    const { port, videos, relier } = await setup();
    const video = { nom: 'essai.mov', duree: 12, tronquee: false, images: [{ t: 0, jpegBase64: JPEG.toString('base64') }] };
    expect((await call(port, '/api/oeil/video', { body: JSON.stringify(video), type: 'application/json' })).status).toBe(401);
    const token = await relier('iPhone');
    // Le fichier vidéo lui-même n'est jamais accepté : seulement le JSON des images clés.
    expect((await call(port, '/api/oeil/video', { token, body: Buffer.alloc(2000), type: 'video/quicktime' })).status).toBe(415);
    const refus = await call(port, '/api/oeil/video', { token, body: JSON.stringify({ ...video, images: [] }), type: 'application/json' });
    expect(refus.status).toBe(400);
    expect(refus.body.toString('utf8')).toContain('aucune image');
    const ok = await call(port, '/api/oeil/video', { token, body: JSON.stringify(video), type: 'application/json' });
    expect(ok.status).toBe(200);
    expect(videos).toEqual([{ video, appareil: 'iPhone' }]);
  });

  it('vidéo : 404 quand les yeux ne la prennent pas, 413 au-delà de la taille annoncée', async () => {
    const sans = await setup({ sansVideo: true });
    const t1 = await sans.relier('iPhone');
    expect((await call(sans.port, '/api/oeil/video', { token: t1, body: '{}', type: 'application/json' })).status).toBe(404);
    const avec = await setup();
    const t2 = await avec.relier('iPhone');
    const r = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: avec.port,
          path: '/api/oeil/video',
          method: 'POST',
          headers: { Host: 'pc.tail1a2b.ts.net', 'Content-Type': 'application/json', Authorization: `Bearer ${t2}`, 'Content-Length': String(VIDEO_JOINTE_JSON_MAX + 1) },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', () => resolve(413));
      req.end();
      void reject;
    });
    expect(r).toBe(413);
    expect(avec.videos).toHaveLength(0);
  });

  it('« Montrer à Jarvis » : photo acceptée seulement avec le jeton, image seulement, 5 Mo au plus', async () => {
    const { port, recues, relier } = await setup();
    expect((await call(port, '/api/oeil/photo', { body: JPEG, type: 'image/jpeg' })).status).toBe(401);
    const token = await relier('iPhone');
    expect((await call(port, '/api/oeil/photo', { token, body: '<html>', type: 'text/html' })).status).toBe(415);
    expect((await call(port, '/api/oeil/photo', { token, body: '<html>', type: 'image/jpeg' })).status).toBe(415);
    const gros = Buffer.alloc(5 * 1024 * 1024 + 1);
    gros.set([0xff, 0xd8, 0xff]);
    expect((await call(port, '/api/oeil/photo', { token, body: gros, type: 'image/jpeg' })).status).toBe(413);
    const ok = await call(port, '/api/oeil/photo', { token, body: JPEG, type: 'image/jpeg' });
    expect(ok.status).toBe(200);
    expect(recues).toHaveLength(1);
    expect(recues[0]).toMatchObject({ type: 'image/jpeg', appareil: 'iPhone' });
    expect(Buffer.from(recues[0]!.octets)).toEqual(JPEG);
  });

  it('photo de Jarvis : un lien à usage unique, jamais la référence de la photo', async () => {
    const { port, relier } = await setup();
    const token = await relier('iPhone');
    const lien = await lienDeLaPhoto(port, token);
    expect(lien).toMatchObject({ type: 'yeux', prisA: 1000, camera: 'Imprimante' });
    expect(lien.image).toMatch(/^\/api\/oeil\/image\/[0-9a-f]{32}$/);
    expect(JSON.stringify(lien)).not.toContain('photo-1');
    expect((await call(port, lien.image)).status).toBe(401);
    const image = await call(port, lien.image, { token });
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.body).toEqual(JPEG);
    expect((await call(port, lien.image, { token })).status).toBe(404);
  });

  it('le lien expire, et il ne sert qu’au téléphone qui l’a reçu', async () => {
    let t = 0;
    const { port, relier } = await setup({ now: () => t });
    const a = await relier('iPhone A');
    const b = await relier('iPhone B');
    const lien = await lienDeLaPhoto(port, a);
    expect((await call(port, lien.image, { token: b })).status).toBe(404);
    const lien2 = await lienDeLaPhoto(port, a);
    t += PHONE_IMAGE_TTL_MS + 1;
    expect((await call(port, lien2.image, { token: a })).status).toBe(404);
  });

  it('la page n’affiche que ses images et les siennes en blob', async () => {
    const { port } = await setup();
    const page = await call(port, '/');
    const politique = String(page.headers['content-security-policy']);
    expect(politique).toContain("img-src 'self' blob:");
    expect(politique).not.toMatch(/img-src[^;]*(https?:|data:|\*)/);
    const script = (await call(port, '/app.js')).body.toString('utf8');
    expect(script).toContain("indexOf('/api/oeil/image/') !== 0");
    // Photo ou vidéo : sans « capture », l'iPhone propose la photothèque, l'appareil photo ou les fichiers.
    expect(page.body.toString('utf8')).toContain('accept="image/*,video/*"');
    expect(politique).toContain('media-src blob:');
    expect(politique).not.toMatch(/media-src[^;]*(https?:|data:|\*|'self')/);
  });
});
