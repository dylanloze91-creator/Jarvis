import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createMessage, newConversation, withMessages, encodeWav, type Conversation } from '@jarvis/core';
import type { ChatEvent, SendChatInput } from '../../shared/ipc.js';
import { PhoneServer, allowedPhoneHost, type PhoneChat, type PhoneSender } from './server.js';
import { PhoneService } from './service.js';
import { PhoneStore } from './store.js';
import { readTailscale } from './tailscale.js';

/**
 * 5.0.63 — serveur du téléphone, sur un vrai port local : page, jumelage, jeton, flux de la
 * discussion, confirmations, historique, retrait d'un appareil, interrupteur.
 */
const dir = mkdtempSync(join(tmpdir(), 'jarvis-phone-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: unknown; host?: string; type?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? (payload ? 'POST' : 'GET'),
        headers: {
          Host: options.host ?? 'pc-de-dylan.tail1a2b.ts.net',
          ...(payload ? { 'Content-Type': options.type ?? 'application/json' } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class FakeChat implements PhoneChat {
  inputs: SendChatInput[] = [];
  confirmations: Array<[string, boolean]> = [];
  cancelled = 0;
  destroyedSeen = false;
  constructor(private readonly script: (sender: PhoneSender, input: SendChatInput) => Promise<void> | void) {}
  async send(sender: PhoneSender, input: SendChatInput): Promise<void> {
    this.inputs.push(input);
    sender.once('destroyed', () => {
      this.destroyedSeen = true;
    });
    await this.script(sender, input);
  }
  respondConfirmation(requestId: string, approved: boolean): void {
    this.confirmations.push([requestId, approved]);
  }
  cancel(): void {
    this.cancelled += 1;
  }
}

const saved: Conversation = withMessages(newConversation(), [
  createMessage('user', 'Quelle météo demain ?'),
  createMessage('assistant', 'Soleil, 22 degrés.'),
  createMessage('tool', 'résultat brut', { toolName: 'web_search' }),
]);

let servers: PhoneServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop()));
  servers = [];
});

async function setup(script: (sender: PhoneSender, input: SendChatInput) => Promise<void> | void = () => undefined) {
  const store = new PhoneStore(() => join(dir, `phone-${Math.random().toString(36).slice(2)}.json`));
  await store.load();
  const chat = new FakeChat(script);
  const paired: string[] = [];
  const server = new PhoneServer({
    store,
    chat,
    conversation: async (id) => (id === saved.id ? saved : null),
    icon: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    version: () => '5.0.63',
    phoneVoice: async () => 'device',
    onPaired: (device) => paired.push(device.name),
  });
  await server.start(0);
  servers.push(server);
  const port = server.port!;
  const pairPhone = async (): Promise<string> => {
    const { code } = server.startPairing();
    const reply = await call(port, '/api/pair', { body: { code, name: 'iPhone' } });
    expect(reply.status).toBe(200);
    return (JSON.parse(reply.body) as { token: string }).token;
  };
  return { store, chat, server, port, paired, pairPhone };
}

describe('serveur du téléphone (5.0.63)', () => {
  it('sert la page, le script, le style, le manifeste et l’icône, avec une politique stricte', async () => {
    const { port } = await setup();
    const page = await call(port, '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('<script src="/app.js" defer></script>');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect((await call(port, '/app.js')).body).toContain("'/api/chat'");
    expect((await call(port, '/app.css')).headers['content-type']).toContain('text/css');
    expect(JSON.parse((await call(port, '/manifest.webmanifest')).body)).toMatchObject({ name: 'Jarvis', display: 'standalone' });
    expect((await call(port, '/icon.png')).headers['content-type']).toBe('image/png');
    expect((await call(port, '/inconnu')).status).toBe(404);
  });

  it('refuse un autre nom d’hôte (site piégé qui vise 127.0.0.1)', async () => {
    const { port } = await setup();
    expect((await call(port, '/', { host: 'site-piege.example' })).status).toBe(421);
    expect((await call(port, '/', { host: '127.0.0.1:53130' })).status).toBe(200);
    expect(allowedPhoneHost('pc.tail1a2b.ts.net:443')).toBe(true);
    expect(allowedPhoneHost('ts.net.example.com')).toBe(false);
    expect(allowedPhoneHost(undefined)).toBe(false);
  });

  it('sans jeton : rien ; sans code en cours : jumelage refusé', async () => {
    const { port } = await setup();
    expect((await call(port, '/api/me')).status).toBe(401);
    expect((await call(port, '/api/me', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await call(port, '/api/chat', { body: { text: 'Salut' } })).status).toBe(401);
    const pair = await call(port, '/api/pair', { body: { code: '123456' } });
    expect(pair.status).toBe(401);
    expect(pair.body).toContain('Relier un téléphone');
  });

  it('jumelage : 5 codes faux annulent le code ; le bon code donne un jeton qui marche', async () => {
    const { port, server, store, paired } = await setup();
    const { code } = server.startPairing();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) {
      expect((await call(port, '/api/pair', { body: { code: wrong } })).status).toBe(401);
    }
    const last = await call(port, '/api/pair', { body: { code: wrong } });
    expect(last.body).toContain('trop d’essais');
    expect(server.currentPairing()).toBeNull();
    expect((await call(port, '/api/pair', { body: { code } })).status).toBe(401);

    const fresh = server.startPairing();
    expect((await call(port, '/api/pair', { body: { code: fresh.code }, type: 'text/plain' })).status).toBe(415);
    const ok = await call(port, '/api/pair', { body: { code: fresh.code, name: 'iPhone <b>' } });
    expect(ok.status).toBe(200);
    const { token, device } = JSON.parse(ok.body) as { token: string; device: { name: string } };
    expect(device.name).toBe('iPhone b');
    expect(paired).toEqual(['iPhone b']);
    expect(server.currentPairing()).toBeNull();
    // Un code ne sert qu'une fois.
    expect((await call(port, '/api/pair', { body: { code: fresh.code } })).status).toBe(401);

    const me = await call(port, '/api/me', { token });
    expect(me.status).toBe(200);
    expect(JSON.parse(me.body)).toEqual({ device: 'iPhone b', version: '5.0.63', voice: 'device' });
    expect(store.devices()).toHaveLength(1);
  });

  it('rejette /api/speak sans jeton ou sans Piper', async () => {
    const wav = encodeWav(new Float32Array([0, 0.1]), 22_050);
    const store = new PhoneStore(() => join(dir, `phone-speak-${Math.random().toString(36).slice(2)}.json`));
    await store.load();
    const server = new PhoneServer({
      store,
      chat: new FakeChat(() => undefined),
      conversation: async () => null,
      icon: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      version: () => '5.0.67',
      phoneVoice: async () => 'piper',
      synthesizeSpeech: async () => wav,
    });
    await server.start(0);
    servers.push(server);
    const port = server.port!;
    expect((await call(port, '/api/speak', { body: { text: 'Bonjour' } })).status).toBe(401);
    const { token } = await store.addDevice('iPhone');
    const ok = await call(port, '/api/speak', { token, body: { text: 'Bonjour Jarvis.' } });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('audio/wav');
    expect(ok.body.length).toBeGreaterThan(40);
  });

  it('le fichier ne garde que l’empreinte du jeton', async () => {
    const path = join(dir, 'empreinte.json');
    const store = new PhoneStore(() => path);
    const { token } = await store.addDevice('iPhone');
    const file = readFileSync(path, 'utf8');
    expect(file).not.toContain(token);
    expect(file).toMatch(/"tokenHash": "[0-9a-f]{64}"/);
    const reloaded = new PhoneStore(() => path);
    await reloaded.load();
    expect(reloaded.verify(token)?.name).toBe('iPhone');
    expect(reloaded.verify(`${token}x`)).toBeNull();
  });

  it('discussion : événements en flux, une ligne JSON chacun ; entrée transmise telle quelle', async () => {
    const { port, chat, pairPhone } = await setup(async (sender, input) => {
      sender.send('chat:event', { type: 'started', conversationId: 'c1', message: createMessage('user', input.text) });
      sender.send('chat:event', { type: 'delta', text: 'Bon' });
      sender.send('chat:event', { type: 'delta', text: 'jour.' });
      sender.send('chat:event', { type: 'done', conversationId: 'c1', messages: [] });
    });
    const token = await pairPhone();
    const reply = await call(port, '/api/chat', { token, body: { text: '  Salut  ', conversationId: null, source: 'voice' } });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('application/x-ndjson');
    const events = reply.body.trim().split('\n').map((line) => JSON.parse(line) as ChatEvent);
    expect(events.map((event) => event.type)).toEqual(['started', 'delta', 'delta', 'done']);
    expect(chat.inputs).toEqual([{ conversationId: null, text: 'Salut', source: 'voice' }]);
    expect((await call(port, '/api/chat', { token, body: { text: '' } })).status).toBe(400);
    expect((await call(port, '/api/chat', { token, body: { text: 'x', conversationId: '../x' } })).status).toBe(400);
  });

  it('une erreur de la session devient un message d’erreur puis « done »', async () => {
    const { port, pairPhone } = await setup(() => {
      throw new Error('Ollama ne répond pas.');
    });
    const token = await pairPhone();
    const reply = await call(port, '/api/chat', { token, body: { text: 'Salut' } });
    const events = reply.body.trim().split('\n').map((line) => JSON.parse(line) as ChatEvent);
    expect(events).toEqual([
      { type: 'error', message: 'Ollama ne répond pas.' },
      { type: 'done', conversationId: '', messages: [] },
    ]);
  });

  it('confirmation et arrêt passent à la session ; l’historique ne montre que la discussion', async () => {
    const { port, chat, pairPhone } = await setup();
    const token = await pairPhone();
    expect((await call(port, '/api/confirm', { token, body: { requestId: 'r1', approved: true } })).status).toBe(200);
    expect((await call(port, '/api/confirm', { token, body: { requestId: 'r1' } })).status).toBe(400);
    expect(chat.confirmations).toEqual([['r1', true]]);
    expect((await call(port, '/api/cancel', { token, body: {} })).status).toBe(200);
    expect(chat.cancelled).toBe(1);

    const history = await call(port, `/api/conversation?id=${saved.id}`, { token });
    expect(JSON.parse(history.body).messages).toEqual([
      { role: 'user', content: 'Quelle météo demain ?' },
      { role: 'assistant', content: 'Soleil, 22 degrés.' },
    ]);
    expect((await call(port, '/api/conversation?id=inconnue', { token })).status).toBe(404);
    expect((await call(port, '/api/conversation?id=../../x', { token })).status).toBe(400);
  });

  it('appareil retiré : son jeton ne marche plus', async () => {
    const { port, store, pairPhone } = await setup();
    const token = await pairPhone();
    const [device] = store.devices();
    await store.removeDevice(device!.id);
    expect((await call(port, '/api/me', { token })).status).toBe(401);
  });

  it('téléphone déconnecté pendant une réponse : la session le voit', async () => {
    let release: () => void = () => undefined;
    const { port, chat, pairPhone } = await setup(
      (sender) =>
        new Promise<void>((resolve) => {
          sender.send('chat:event', { type: 'delta', text: '…' });
          release = resolve;
          sender.once('destroyed', () => resolve());
        }),
    );
    const token = await pairPhone();
    await new Promise<void>((resolve) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/chat',
          method: 'POST',
          headers: { Host: 'pc.tail.ts.net', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        },
        (res) => {
          res.once('data', () => {
            req.destroy();
            setTimeout(resolve, 50);
          });
        },
      );
      req.on('error', () => undefined);
      req.end(JSON.stringify({ text: 'Raconte une longue histoire' }));
    });
    release();
    expect(chat.destroyedSeen).toBe(true);
  });
});

describe('réglages du téléphone (5.0.63)', () => {
  it('coupé par défaut ; activé = serveur ; coupé = port fermé ; état de Tailscale', async () => {
    const store = new PhoneStore(() => join(dir, 'service.json'));
    const service = new PhoneService({
      store,
      port: 0,
      chat: new FakeChat(() => undefined),
      conversation: async () => null,
      icon: async () => null,
      version: () => '5.0.63',
      phoneVoice: async () => 'device',
      tailscale: async (args) =>
        args[0] === 'status'
          ? JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.tail1a2b.ts.net.', Online: true } })
          : JSON.stringify({ Web: { 'pc.tail1a2b.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:0' } } } } }),
    });
    await service.init();
    let status = await service.status();
    // Coupé : Tailscale n'est même pas interrogé.
    expect(status).toMatchObject({ enabled: false, running: false, devices: [], pairing: null, url: null });
    expect(status.tailscale.installed).toBe(false);

    // Pas de code tant que l'accès est coupé.
    expect((await service.startPairing()).pairing).toBeNull();

    status = await service.setEnabled(true);
    expect(status).toMatchObject({ enabled: true, running: true, error: null, url: 'https://pc.tail1a2b.ts.net/' });
    expect(status.tailscale).toEqual({ installed: true, online: true, dnsName: 'pc.tail1a2b.ts.net', served: true });
    status = await service.startPairing();
    expect(status.pairing?.code).toMatch(/^\d{6}$/);
    expect(status.pairing?.url).toBe(`https://pc.tail1a2b.ts.net/#code=${status.pairing!.code}`);

    status = await service.setEnabled(false);
    expect(status).toMatchObject({ enabled: false, running: false, pairing: null });
    const again = new PhoneStore(() => join(dir, 'service.json'));
    await again.load();
    expect(again.enabled).toBe(false);
  });

  it('Tailscale absent, arrêté, ou sans publication', async () => {
    const missing = Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
    expect(await readTailscale(53130, async () => Promise.reject(missing))).toMatchObject({ installed: false, served: null });
    expect(
      await readTailscale(53130, async () => JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: 'pc.tail.ts.net.' } })),
    ).toMatchObject({ installed: true, online: false, served: null });
    expect(
      await readTailscale(53130, async (args) =>
        args[0] === 'status' ? JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.tail.ts.net.', Online: true } }) : '{}',
      ),
    ).toMatchObject({ installed: true, online: true, dnsName: 'pc.tail.ts.net', served: false });
  });
});
