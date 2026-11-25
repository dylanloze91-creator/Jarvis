import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { AtelierEtat } from '@jarvis/core';
import type { SendChatInput } from '../../shared/ipc.js';
import { PHONE_ATELIER_TTL_MS, PhoneServer, type PhoneChat, type PhoneSender } from './server.js';
import { PhoneStore } from './store.js';
import { PHONE_JS } from './page.js';

/**
 * Atelier 3D sur le téléphone (Jarvis Test, essai du 24 novembre au soir) : une pièce rendue arrive
 * comme une carte (résumé, mesures) avec des liens à usage unique vers ses deux images et son STL.
 * Jamais le dossier ni les noms de fichiers ; lien lu une seule fois, par le même appareil, avec le
 * jeton, dans les 2 minutes.
 */
const dir = mkdtempSync(join(tmpdir(), 'jarvis-phone-atelier-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const STL = new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n');

const PIECE: Extract<AtelierEtat, { etape: 'piece' }> = {
  etape: 'piece',
  gabarit: 'boite',
  nom: 'boîte',
  dossier: 'boite-2026-11-24-1',
  versionChoisie: 2,
  plateau: { x: 300, y: 300 },
  versions: [
    { numero: 1, valeurs: {}, fiche: 'Boîte de 120 × 100 × 40 mm.', mesures: [], taille: [120, 100, 40], stl: 'v1.stl', image: 'v1.png' },
    {
      numero: 2,
      valeurs: {},
      fiche: 'Boîte de 120 × 100 × 40 mm. Avec un trou de 8 mm sur le côté droit.',
      mesures: [{ nom: 'Longueur', valeur: '120 mm' }],
      taille: [120, 100, 40],
      stl: 'v2.stl',
      image: 'v2.png',
      imageDessus: 'v2-dessus.png',
      changement: 'Ajout : trou de 8 mm sur le côté droit',
    },
  ],
};

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function call(port: number, path: string, options: { token?: string; body?: unknown } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: payload ? 'POST' : 'GET',
        headers: {
          Host: 'pc.tail1a2b.ts.net:8443',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let servers: PhoneServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop()));
  servers = [];
});

async function setup(options: { avecFichiers?: boolean } = {}) {
  const store = new PhoneStore(() => join(dir, `phone-${Math.random().toString(36).slice(2)}.json`));
  await store.load();
  let maintenant = 1_000_000;
  const lus: string[] = [];
  const chat: PhoneChat = {
    async send(sender: PhoneSender, _input: SendChatInput) {
      sender.send('', { type: 'atelier', messageId: 'm1', etat: PIECE });
      sender.send('', {
        type: 'done',
        conversationId: 'c1',
        messages: [{ id: 'm1', role: 'assistant', content: 'Version 2.', createdAt: 1, atelier: PIECE }],
      });
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
    now: () => maintenant,
    ...(options.avecFichiers === false
      ? {}
      : {
          fichierAtelier: async (dossier: string, fichier: string) => {
            lus.push(`${dossier}/${fichier}`);
            return fichier.endsWith('.png') ? PNG : STL;
          },
        }),
  });
  await server.start(0);
  servers.push(server);
  const port = server.port!;
  const relier = async (name: string): Promise<string> => {
    const { code } = server.startPairing();
    const reply = await call(port, '/api/pair', { body: { code, name } });
    return (JSON.parse(reply.body.toString('utf8')) as { token: string }).token;
  };
  const evenements = async (token: string) => {
    const reply = await call(port, '/api/chat', { token, body: { text: 'fais un trou de 8 à droite pour un câble' } });
    return reply.body
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  };
  return { port, relier, evenements, lus, avancer: (ms: number) => (maintenant += ms) };
}

describe('atelier 3D sur le téléphone', () => {
  it('une pièce arrive en carte : résumé, mesures, deux images et le STL, jamais le dossier', async () => {
    const { port, relier, evenements, lus } = await setup();
    const token = await relier('iPhone');
    const events = await evenements(token);
    const carte = events.find((e) => e.type === 'atelier')!;
    expect(carte).toMatchObject({
      type: 'atelier',
      nom: 'boîte',
      numero: 2,
      fiche: 'Boîte de 120 × 100 × 40 mm. Avec un trou de 8 mm sur le côté droit.',
      changement: 'Ajout : trou de 8 mm sur le côté droit',
      mesures: [{ nom: 'Longueur', valeur: '120 mm' }],
    });
    const texte = JSON.stringify(events);
    expect(texte).not.toContain('boite-2026-11-24-1');
    expect(texte).not.toContain('v2.png');
    expect(texte).not.toContain('v2.stl');
    const images = carte.images as { vue: string; url: string }[];
    expect(images.map((i) => i.vue)).toEqual(['trois-quarts', 'dessus']);
    for (const url of [...images.map((i) => i.url), carte.modele as string]) expect(url).toMatch(/^\/api\/atelier\/fichier\/[0-9a-f]{32}$/);

    const image = await call(port, images[0]!.url, { token });
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('no-store');
    expect(new Uint8Array(image.body)).toEqual(PNG);
    const dessus = await call(port, images[1]!.url, { token });
    expect(dessus.status).toBe(200);
    const modele = await call(port, carte.modele as string, { token });
    expect(modele.headers['content-type']).toBe('model/stl');
    expect(modele.body.toString('utf8')).toContain('vertex 1 0 0');
    expect(lus).toEqual(['boite-2026-11-24-1/v2.png', 'boite-2026-11-24-1/v2-dessus.png', 'boite-2026-11-24-1/v2.stl']);
  });

  it('lien à usage unique : une seconde lecture est refusée', async () => {
    const { port, relier, evenements } = await setup();
    const token = await relier('iPhone');
    const url = ((await evenements(token)).find((e) => e.type === 'atelier')!.images as { url: string }[])[0]!.url;
    expect((await call(port, url, { token })).status).toBe(200);
    expect((await call(port, url, { token })).status).toBe(404);
  });

  it('jeton obligatoire, et un autre appareil relié ne peut pas lire le lien', async () => {
    const { port, relier, evenements, lus } = await setup();
    const token = await relier('iPhone');
    const autre = await relier('iPad');
    const url = ((await evenements(token)).find((e) => e.type === 'atelier')!.images as { url: string }[])[0]!.url;
    expect((await call(port, url)).status).toBe(401);
    expect((await call(port, url, { token: autre })).status).toBe(404);
    // Le lien a été effacé à la tentative de l'autre appareil : plus rien pour personne.
    expect((await call(port, url, { token })).status).toBe(404);
    expect(lus).toEqual([]);
  });

  it('lien expiré après 2 minutes', async () => {
    const { port, relier, evenements, avancer } = await setup();
    const token = await relier('iPhone');
    const url = ((await evenements(token)).find((e) => e.type === 'atelier')!.images as { url: string }[])[0]!.url;
    avancer(PHONE_ATELIER_TTL_MS + 1);
    expect((await call(port, url, { token })).status).toBe(404);
  });

  it('la fin du tour ne transporte pas l’état brut de la pièce', async () => {
    const { relier, evenements } = await setup();
    const token = await relier('iPhone');
    const done = (await evenements(token)).find((e) => e.type === 'done')!;
    expect(done.messages).toEqual([{ id: 'm1', role: 'assistant', content: 'Version 2.', createdAt: 1 }]);
  });

  it('sans lecteur de fichiers (Jarvis Live), aucune carte ni lien', async () => {
    const { relier, evenements, port } = await setup({ avecFichiers: false });
    const token = await relier('iPhone');
    const events = await evenements(token);
    expect(events.some((e) => e.type === 'atelier')).toBe(false);
    expect((await call(port, '/api/atelier/fichier/0123456789abcdef0123456789abcdef', { token })).status).toBe(404);
  });

  it('la page du téléphone se lit, affiche la carte sans HTML et lit les images avec le jeton', () => {
    // Analyse seulement : le corps n'est pas exécuté.
    expect(() => new Function(PHONE_JS)).not.toThrow();
    expect(PHONE_JS).toContain("case 'atelier':");
    expect(PHONE_JS).not.toMatch(/innerHTML/);
    expect(PHONE_JS).toContain("headers: { Authorization: 'Bearer ' + token }");
  });

  it('un chemin forgé n’est jamais lu', async () => {
    const { port, relier, lus } = await setup();
    const token = await relier('iPhone');
    for (const path of ['/api/atelier/fichier/..%2F..%2Fsettings.json', '/api/atelier/fichier/abc', '/api/atelier/fichier/']) {
      expect((await call(port, path, { token })).status).toBe(404);
    }
    expect(lus).toEqual([]);
  });
});
