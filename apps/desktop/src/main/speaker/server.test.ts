import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  InMemoryConversationStore,
  SPEAKER_CONFIRMATION_REFUSAL,
  SPEAKER_IMAGE_WAIT,
  SPEAKER_SAMPLE_RATE,
  SPEAKER_TRANSCRIBE_FAILED,
  createMessage,
  decodeWav,
  encodeWav,
  newConversation,
  silenceWav,
  withMessages,
} from '@jarvis/core';
import type { SendChatInput } from '../../shared/ipc.js';
import { SpeakerServer, type SpeakerChat, type SpeakerSender } from './server.js';
import { SpeakerService, localHostName } from './service.js';
import { SpeakerStore } from './store.js';
import { windowsSpeechScript, WindowsSpeechSynthesizer, createSpeakerSynthesizer, type SpeakerSynthesizer } from './synth.js';

/**
 * 5.0.64 — pont des enceintes, sur un vrai port local : jeton, adresse non privée, WAV trop gros
 * ou mal formé, phrase → transcription (fausse) → chat (faux) → WAV de réponse, 204 pour vide,
 * mention, « stop », suivi refusé ; carte de confirmation refusée ; enceinte retirée ; interrupteur.
 */
const dir = mkdtempSync(join(tmpdir(), 'jarvis-speaker-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function call(
  port: number,
  path: string,
  options: { method?: string; token?: string; body?: Uint8Array; type?: string; followUp?: boolean } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? (options.body ? 'POST' : 'GET'),
        headers: {
          ...(options.body ? { 'Content-Type': options.type ?? 'audio/wav', 'Content-Length': String(options.body.byteLength) } : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.followUp ? { 'X-Jarvis-Follow-Up': '1' } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    if (options.body) req.write(Buffer.from(options.body));
    req.end();
  });
}

/** Une seconde de « voix » (sinusoïde) en WAV 16 kHz mono. */
function voiceWav(seconds = 1): Uint8Array {
  const samples = Float32Array.from({ length: Math.round(seconds * SPEAKER_SAMPLE_RATE) }, (_, index) =>
    0.2 * Math.sin((2 * Math.PI * 220 * index) / SPEAKER_SAMPLE_RATE),
  );
  return encodeWav(samples, SPEAKER_SAMPLE_RATE);
}

/** Faux synthétiseur : un WAV de silence dont la durée code la longueur du texte (vérifiable). */
class FakeSynth implements SpeakerSynthesizer {
  spoken: string[] = [];
  fail = false;
  async synthesize(text: string): Promise<Uint8Array> {
    if (this.fail) throw new Error('pas de voix');
    this.spoken.push(text);
    return silenceWav(100 + text.length);
  }
}

class FakeChat implements SpeakerChat {
  inputs: SendChatInput[] = [];
  confirmations: Array<[string, boolean]> = [];
  cancelled = 0;
  constructor(private readonly script: (sender: SpeakerSender, input: SendChatInput, chat: FakeChat) => Promise<void> | void) {}
  async send(sender: SpeakerSender, input: SendChatInput): Promise<void> {
    this.inputs.push(input);
    await this.script(sender, input, this);
  }
  respondConfirmation(requestId: string, approved: boolean): void {
    this.confirmations.push([requestId, approved]);
  }
  cancel(): void {
    this.cancelled += 1;
  }
}

/** Faux chat « normal » : répond en flux et enregistre dans l'historique donné. */
function answering(store: InMemoryConversationStore, reply: (text: string) => string) {
  return async (sender: SpeakerSender, input: SendChatInput): Promise<void> => {
    const existing = input.conversationId ? await store.get(input.conversationId) : null;
    const conversation = existing ?? newConversation();
    const user = createMessage('user', input.text);
    sender.send('chat:event', { type: 'started', conversationId: conversation.id, message: user });
    const text = reply(input.text);
    for (const part of text.split(' ')) sender.send('chat:event', { type: 'delta', text: `${part} ` });
    const updated = withMessages(conversation, [...conversation.messages, user, createMessage('assistant', text)]);
    await store.save(updated);
    sender.send('chat:event', { type: 'done', conversationId: updated.id, messages: updated.messages });
  };
}

let servers: SpeakerServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.stop()));
  servers = [];
});

interface SetupOptions {
  transcribe?: (pcm: Float32Array) => Promise<string>;
  script?: (sender: SpeakerSender, input: SendChatInput, chat: FakeChat) => Promise<void> | void;
  remote?: string;
  followUpSeconds?: number;
  now?: () => number;
  turnTimeoutMs?: number;
  onShowOnPc?: (conversationId: string) => void;
}

async function setup(options: SetupOptions = {}) {
  const store = new SpeakerStore(() => join(dir, `speakers-${Math.random().toString(36).slice(2)}.json`));
  await store.load();
  const conversations = new InMemoryConversationStore();
  const chats = new Map<string, FakeChat>();
  const synth = new FakeSynth();
  const turns: Array<[string, number]> = [];
  let transcript = 'Jarvis, quelle heure est-il ?';
  const server = new SpeakerServer({
    store,
    chatFor: (speaker) => {
      const chat = new FakeChat(options.script ?? answering(conversations, (text) => `Réponse à : ${text}`));
      chats.set(speaker.id, chat);
      return chat;
    },
    transcribe: options.transcribe ?? (async () => transcript),
    synthesizer: synth,
    voiceSettings: () => ({ wakeWord: 'jarvis', wakeWordVariants: [], followUpSeconds: options.followUpSeconds }),
    version: () => '5.0.64',
    conversations,
    onTurn: (speaker, at) => turns.push([speaker.name, at]),
    now: options.now,
    ...(options.onShowOnPc ? { onShowOnPc: options.onShowOnPc } : {}),
    ...(options.turnTimeoutMs ? { turnTimeoutMs: options.turnTimeoutMs } : {}),
    ...(options.remote ? { remoteAddress: () => options.remote } : {}),
  });
  await server.start(0);
  servers.push(server);
  const port = server.port!;
  const { speaker, token } = await store.addSpeaker('Salon');
  return {
    store,
    server,
    port,
    speaker,
    token,
    synth,
    chats,
    conversations,
    turns,
    setTranscript: (text: string) => {
      transcript = text;
    },
    chat: () => chats.get(speaker.id)!,
  };
}

describe('pont des enceintes (5.0.64)', () => {
  it('sans jeton ou jeton faux : 401 ; bon jeton : hello avec la fenêtre de suivi', async () => {
    const { port, token } = await setup({ followUpSeconds: 12 });
    expect((await call(port, '/api/speaker/hello')).status).toBe(401);
    expect((await call(port, '/api/speaker/hello', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await call(port, '/api/speaker/turn', { body: voiceWav() })).status).toBe(401);
    const hello = await call(port, '/api/speaker/hello', { token });
    expect(hello.status).toBe(200);
    expect(JSON.parse(hello.body.toString('utf8'))).toEqual({ name: 'Salon', version: '5.0.64', followUpMs: 12_000 });
    expect((await call(port, '/api/speaker/hello', { token, method: 'POST' })).status).toBe(405);
    expect((await call(port, '/api/speaker/autre', { token })).status).toBe(404);
  });

  it('refuse une adresse distante non privée, même avec le bon jeton', async () => {
    const { port, token } = await setup({ remote: '8.8.8.8' });
    expect((await call(port, '/api/speaker/hello', { token })).status).toBe(403);
    expect((await call(port, '/api/speaker/turn', { token, body: voiceWav() })).status).toBe(403);
  });

  it('accepte les adresses privées IPv4 mappées en IPv6 (Wi-Fi de la maison)', async () => {
    const { port, token } = await setup({ remote: '::ffff:192.168.1.57' });
    expect((await call(port, '/api/speaker/hello', { token })).status).toBe(200);
  });

  it('WAV trop gros = 413 ; mauvais type = 415 ; WAV mal formé = 400', async () => {
    const { port, token, chats } = await setup();
    const big = new Uint8Array(1_500_001);
    expect((await call(port, '/api/speaker/turn', { token, body: big })).status).toBe(413);
    expect((await call(port, '/api/speaker/turn', { token, body: voiceWav(), type: 'application/json' })).status).toBe(415);
    const stereoOrWrongRate = encodeWav(new Float32Array(44_100), 44_100);
    const wrong = await call(port, '/api/speaker/turn', { token, body: stereoOrWrongRate });
    expect(wrong.status).toBe(400);
    expect(wrong.body.toString('utf8')).toContain('16000');
    expect((await call(port, '/api/speaker/turn', { token, body: new Uint8Array([1, 2, 3]) })).status).toBe(400);
    expect(chats.size).toBe(0);
  });

  it('phrase → transcription → chat → WAV 16 kHz de la réponse, avec en-têtes', async () => {
    const { port, token, synth, chat, turns, conversations } = await setup();
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('audio/wav');
    expect(reply.headers['x-jarvis-continue']).toBe('1');
    expect(decodeURIComponent(String(reply.headers['x-jarvis-transcript']))).toBe('Jarvis, quelle heure est-il ?');
    const wav = decodeWav(new Uint8Array(reply.body));
    expect(wav.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(Number(reply.headers['content-length'])).toBe(reply.body.byteLength);
    // Le mot de réveil est retiré avant le chat ; source vocale, pas de suivi.
    expect(chat().inputs).toEqual([{ conversationId: null, text: 'quelle heure est-il', source: 'voice' }]);
    expect(synth.spoken).toEqual(['Réponse à : quelle heure est-il']);
    expect(turns).toHaveLength(1);
    expect(turns[0]![0]).toBe('Salon');
    // Historique du PC : titre préfixé du nom de l'enceinte.
    const list = await conversations.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('Salon · quelle heure est-il');
  });

  it('la discussion continue sur la même conversation, puis une nouvelle après 10 minutes', async () => {
    let clock = 1_000_000;
    const { port, token, chat, conversations, setTranscript } = await setup({ now: () => clock });
    await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    clock += 60_000;
    setTranscript('Jarvis et demain ?');
    await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    const first = (await conversations.list())[0]!.id;
    expect(chat().inputs[0]!.conversationId).toBeNull();
    expect(chat().inputs[1]!.conversationId).toBe(first);
    clock += 11 * 60_000;
    setTranscript('Jarvis, la météo');
    await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(chat().inputs[2]!.conversationId).toBeNull();
    const list = await conversations.list();
    expect(list.map((item) => item.title).sort()).toEqual(['Salon · la météo', 'Salon · quelle heure est-il']);
  });

  it('204 sans réponse : transcription vide, hallucination, mention de Jarvis, « stop », un seul mot inconnu', async () => {
    const { port, token, chats, synth, setTranscript } = await setup();
    for (const text of ['', '...', 'Sous-titres réalisés par la communauté d’Amara.org', 'Tu connais Jarvis ?', 'Jarvis stop', 'tais-toi', 'Jarvis', 'Bonjour']) {
      setTranscript(text);
      const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
      expect(reply.status, text).toBe(204);
      expect(reply.headers['x-jarvis-continue'], text).toBe('0');
      expect(decodeURIComponent(String(reply.headers['x-jarvis-transcript'])), text).toBe(text);
      expect(reply.body.byteLength).toBe(0);
    }
    expect(chats.size).toBe(0);
    expect(synth.spoken).toEqual([]);
  });

  it('phrase de suivi : envoyée avec followUp ; « pas pour Jarvis » = 204 ; un mot suffit', async () => {
    const { port, token, chat, setTranscript } = await setup({
      script: (sender, input) => {
        if (input.text === 'il fait beau chez eux') {
          sender.send('', { type: 'not_addressed', text: input.text });
          return;
        }
        sender.send('', { type: 'started', conversationId: 'c-suivi', message: createMessage('user', input.text) });
        sender.send('', { type: 'delta', text: 'Mis en pause.' });
        sender.send('', { type: 'done', conversationId: 'c-suivi', messages: [] });
      },
    });
    setTranscript('il fait beau chez eux');
    const ignored = await call(port, '/api/speaker/turn', { token, body: voiceWav(), followUp: true });
    expect(ignored.status).toBe(204);
    expect(ignored.headers['x-jarvis-continue']).toBe('0');
    expect(chat().inputs[0]).toEqual({ conversationId: null, text: 'il fait beau chez eux', source: 'voice', followUp: true });

    setTranscript('pause');
    const ok = await call(port, '/api/speaker/turn', { token, body: voiceWav(), followUp: true });
    expect(ok.status).toBe(200);
    expect(chat().inputs[1]).toMatchObject({ text: 'pause', followUp: true });
  });

  it('une carte de confirmation est refusée tout de suite et Jarvis le dit', async () => {
    const { port, token, synth, chat, setTranscript } = await setup({
      script: async (sender, input, fake) => {
        sender.send('', { type: 'started', conversationId: 'c1', message: createMessage('user', input.text) });
        sender.send('', { type: 'confirm', requestId: 'r1', toolName: 'create_folder', details: 'Créer « Essai »' });
        // La session attend la réponse à la carte : elle doit déjà être là (refus immédiat).
        expect(fake.confirmations).toEqual([['r1', false]]);
        sender.send('', { type: 'tool_result', callId: 'c', toolName: 'create_folder', status: 'denied', content: 'refusé' });
        sender.send('', { type: 'delta', text: 'D’accord, je n’ai rien fait : tu as refusé « create_folder ».' });
        sender.send('', { type: 'done', conversationId: 'c1', messages: [] });
      },
    });
    setTranscript('Jarvis crée un dossier Essai');
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(200);
    expect(chat().confirmations).toEqual([['r1', false]]);
    expect(synth.spoken).toEqual([SPEAKER_CONFIRMATION_REFUSAL]);
  });

  it('Whisper indisponible : 503 avec un court WAV d’erreur ; sans voix non plus : 503 JSON', async () => {
    const { port, token, synth, chats } = await setup({
      transcribe: async () => {
        throw new Error('fenêtre indisponible pour Whisper');
      },
    });
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(503);
    expect(reply.headers['content-type']).toBe('audio/wav');
    expect(reply.headers['x-jarvis-continue']).toBe('0');
    expect(decodeWav(new Uint8Array(reply.body)).sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(synth.spoken).toEqual([SPEAKER_TRANSCRIBE_FAILED]);
    expect(chats.size).toBe(0);
    synth.fail = true;
    const json = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(json.status).toBe(503);
    expect(json.headers['content-type']).toContain('application/json');
  });

  it('une erreur de la session devient une phrase d’excuse ; une réponse sans texte, 204', async () => {
    let mode: 'error' | 'empty' = 'error';
    const { port, token, synth } = await setup({
      script: (sender, input) => {
        sender.send('', { type: 'started', conversationId: 'c1', message: createMessage('user', input.text) });
        if (mode === 'error') sender.send('', { type: 'error', message: 'Ollama ne répond pas.' });
        sender.send('', { type: 'done', conversationId: 'c1', messages: [] });
      },
    });
    const failed = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(failed.status).toBe(200);
    expect(synth.spoken).toEqual(['Je n’ai pas pu répondre. Réessaie dans un instant.']);
    mode = 'empty';
    expect((await call(port, '/api/speaker/turn', { token, body: voiceWav() })).status).toBe(204);
  });

  it('le texte dit est nettoyé : sources et code retirés, le détail reste sur le PC', async () => {
    const shown: string[] = [];
    const { port, token, synth, setTranscript } = await setup({
      onShowOnPc: (id) => shown.push(id),
      script: (sender, input) => {
        sender.send('', { type: 'started', conversationId: 'c1', message: createMessage('user', input.text) });
        sender.send('', {
          type: 'delta',
          text: 'Il fait **22 degrés**.\n\n```\ncode\n```\n\nSources (recherche web du 2 novembre 2026) :\n- [1] Météo — site (meteo.fr), 2026 — https://meteo.fr',
        });
        sender.send('', { type: 'done', conversationId: 'c1', messages: [] });
      },
    });
    setTranscript('Jarvis quelle météo ?');
    await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(synth.spoken).toEqual(['Il fait 22 degrés. Le détail est sur le PC.']);
    expect(synth.spoken[0]).not.toContain('meteo.fr');
    expect(synth.spoken[0]).not.toContain('code');
    expect(shown).toEqual(['c1']);
  });

  it('une seule phrase à la fois par enceinte : la seconde reçoit 429', async () => {
    let release: () => void = () => undefined;
    const { port, token } = await setup({
      transcribe: () => new Promise<string>((resolve) => (release = () => resolve('Jarvis bonjour à toi'))),
    });
    const first = call(port, '/api/speaker/turn', { token, body: voiceWav() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(second.status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });

  it('la carte raccroche pendant la réflexion : session annulée, verrou rendu, rien n’est envoyé', async () => {
    let cancelledBy: FakeChat | null = null;
    const { port, token, chats, synth } = await setup({
      // Un chat qui ne finit que quand on l'annule (modèle lent, GPU pris).
      script: (sender, _input, chat) =>
        new Promise<void>((resolve) => {
          // La deuxième phrase, elle, répond tout de suite.
          if (chat.inputs.length > 1) return resolve();
          sender.once('destroyed', () => {
            cancelledBy = chat;
            resolve();
          });
          sender.send('chat:event', { type: 'started', conversationId: 'c1', message: createMessage('user', 'x') });
        }),
    });
    const body = voiceWav();
    const aborted = new Promise<void>((resolve) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/speaker/turn',
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav', 'Content-Length': String(body.byteLength), Authorization: `Bearer ${token}` },
        },
        () => undefined,
      );
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      req.end(Buffer.from(body));
      setTimeout(() => req.destroy(), 150);
    });
    await aborted;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const chat = [...chats.values()][0]!;
    expect(cancelledBy).toBe(chat);
    expect(chat.cancelled).toBe(1);
    expect(synth.spoken).toEqual([]);
    // La phrase suivante n'est pas refusée en 429 : le verrou a été rendu.
    const next = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(next.status).toBe(204);
    expect(chat.inputs).toHaveLength(2);
  });

  it('phrase trop longue côté PC : 504, session annulée, verrou rendu', async () => {
    const { port, token, chats, synth } = await setup({
      turnTimeoutMs: 200,
      script: (sender) =>
        new Promise<void>((resolve) => {
          sender.once('destroyed', () => resolve());
        }),
    });
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(504);
    expect(reply.headers['x-jarvis-continue']).toBe('0');
    expect([...chats.values()][0]!.cancelled).toBe(1);
    expect(synth.spoken).toEqual([]);
    expect((await call(port, '/api/speaker/turn', { token, body: voiceWav() })).status).toBe(504);
  });

  it('une longue réponse est dite en deux ou trois phrases et s’affiche sur le PC', async () => {
    const shown: string[] = [];
    const text = 'Première phrase. Deuxième phrase. Troisième phrase. Quatrième phrase qui reste sur l’écran.';
    const { port, token, synth } = await setup({
      onShowOnPc: (id) => shown.push(id),
      script: (sender) => {
        sender.send('chat:event', {
          type: 'started',
          conversationId: 'conv-long',
          message: createMessage('user', 'raconte'),
        });
        sender.send('chat:event', { type: 'delta', text });
        sender.send('chat:event', {
          type: 'done',
          conversationId: 'conv-long',
          messages: [createMessage('assistant', text)],
        });
      },
    });
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(200);
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]).toContain('Première phrase.');
    expect(synth.spoken[0]).toContain('Le détail est sur le PC.');
    expect(synth.spoken[0]).not.toContain('Quatrième');
    expect(shown).toEqual(['conv-long']);
  });

  it('une demande d’image répond tout de suite et le calcul continue sur le PC', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shown: string[] = [];
    const { port, token, synth, setTranscript } = await setup({
      onShowOnPc: (id) => shown.push(id),
      script: async (sender) => {
        sender.send('chat:event', {
          type: 'started',
          conversationId: 'img-1',
          message: createMessage('user', 'image'),
        });
        await gate;
        const text = 'Image générée (1024×1024, projet perso) :\n- C:/img/chat.png — graine 1';
        sender.send('chat:event', { type: 'delta', text });
        sender.send('chat:event', {
          type: 'done',
          conversationId: 'img-1',
          messages: [createMessage('assistant', text)],
        });
      },
    });
    setTranscript('Jarvis, génère une image d’un chat');
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(200);
    expect(reply.headers['x-jarvis-continue']).toBe('0');
    expect(synth.spoken).toEqual([SPEAKER_IMAGE_WAIT]);
    expect(shown).toContain('img-1');
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(shown.filter((id) => id === 'img-1').length).toBeGreaterThanOrEqual(1);
  });

  it('une phrase pendant une image ne l’annule pas, et le micro se ferme après l’attente', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shown: string[] = [];
    const seen: Array<{ chat: FakeChat; input: SendChatInput }> = [];
    const box: { store?: InMemoryConversationStore } = {};
    const { port, token, synth, setTranscript, conversations } = await setup({
      followUpSeconds: 8,
      onShowOnPc: (id) => shown.push(id),
      script: async (sender, input, chat) => {
        seen.push({ chat, input });
        if (input.text.includes('image')) {
          sender.send('chat:event', {
            type: 'started',
            conversationId: 'img-1',
            message: createMessage('user', input.text),
          });
          await gate;
          const text = 'Image générée (1024×1024, projet perso) :\n- C:/img/chat.png — graine 1';
          sender.send('chat:event', { type: 'delta', text });
          sender.send('chat:event', {
            type: 'done',
            conversationId: 'img-1',
            messages: [createMessage('assistant', text)],
          });
          return;
        }
        const store = box.store!;
        const existing = input.conversationId ? await store.get(input.conversationId) : null;
        const user = createMessage('user', input.text);
        const conversation = existing ?? newConversation([user]);
        const text = 'Lecture lancée.';
        const updated = withMessages(conversation, [...conversation.messages, user, createMessage('assistant', text)]);
        await store.save(updated);
        sender.send('chat:event', { type: 'started', conversationId: updated.id, message: user });
        sender.send('chat:event', { type: 'delta', text });
        sender.send('chat:event', { type: 'done', conversationId: updated.id, messages: updated.messages });
      },
    });
    box.store = conversations;
    setTranscript('Jarvis, génère une image d’un chat');
    const waiting = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(waiting.status).toBe(200);
    expect(waiting.headers['x-jarvis-continue']).toBe('0');
    expect(synth.spoken).toEqual([SPEAKER_IMAGE_WAIT]);

    setTranscript('Jarvis, mets de la musique');
    const music = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(music.status).toBe(200);
    expect(synth.spoken[1]).toBe('Lecture lancée.');
    expect(seen[0]!.chat).not.toBe(seen[1]!.chat);
    expect(seen[0]!.chat.cancelled).toBe(0);
    expect(seen[1]!.input.conversationId).toBeNull();
    const titles = (await conversations.list()).map((item) => item.title);
    expect(titles.some((title) => title.startsWith('Salon · ') && title.includes('musique'))).toBe(true);

    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen[0]!.chat.cancelled).toBe(0);
    expect(shown).toContain('img-1');

    setTranscript('Jarvis, merci');
    await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(seen[2]!.chat).toBe(seen[0]!.chat);
    expect(seen[2]!.input.conversationId).toBe('img-1');
    expect(seen[0]!.chat.cancelled).toBe(0);
  });

  it('fenêtre de suivi à 0 : réponse jouée mais X-Jarvis-Continue 0', async () => {
    const { port, token } = await setup({ followUpSeconds: 0 });
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(200);
    expect(reply.headers['x-jarvis-continue']).toBe('0');
  });

  it('une question Spotify garde le micro ouvert même si le suivi est à 0', async () => {
    const { port, token, synth } = await setup({
      followUpSeconds: 0,
      script: (sender) => {
        sender.send('chat:event', { type: 'delta', text: 'Sur la Devialet ou sur le PC ?' });
        sender.send('chat:event', {
          type: 'done',
          conversationId: 'c1',
          messages: [],
        });
      },
    });
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(200);
    expect(reply.headers['x-jarvis-continue']).toBe('1');
    expect(synth.spoken).toEqual(['Sur la Devialet ou sur le PC ?']);
  });

  it('enceinte retirée : son jeton ne marche plus et sa discussion est oubliée', async () => {
    const { port, token, store, server, speaker, chat } = await setup();
    expect((await call(port, '/api/speaker/turn', { token, body: voiceWav() })).status).toBe(200);
    const fake = chat();
    await store.removeSpeaker(speaker.id);
    server.forget(speaker.id);
    expect(fake.cancelled).toBe(1);
    expect((await call(port, '/api/speaker/hello', { token })).status).toBe(401);
  });

  it('au-delà de 20 enceintes, la plus ancienne disparaît avec sa discussion et son jeton', async () => {
    const store = new SpeakerStore(() => join(dir, 'vingt.json'));
    const turns: string[] = [];
    const service = new SpeakerService({
      store,
      port: 0,
      chatFor: () => new FakeChat(() => undefined),
      transcribe: async () => 'Jarvis bonjour à toi',
      synthesizer: new FakeSynth(),
      voiceSettings: () => ({ wakeWord: 'jarvis', wakeWordVariants: [] }),
      version: () => '5.0.64',
      localAddresses: () => ['192.168.1.20'],
      log: (line) => turns.push(line),
    });
    await service.init();
    await service.setEnabled(true);
    const port = service.server.port!;
    const first = await service.add('Première');
    const token = /JARVIS_TOKEN {5}"([^"]+)"/.exec(first.secrets)![1]!;
    expect((await call(port, '/api/speaker/turn', { token, body: voiceWav() })).status).toBe(204);
    expect((await service.status()).speakers[0]!.lastTurnAt).toBeGreaterThan(0);
    for (let i = 2; i <= 20; i++) await service.add(`Pièce ${i}`);
    expect((await service.status()).speakers).toHaveLength(20);
    expect((await call(port, '/api/speaker/hello', { token })).status).toBe(200);

    const last = await service.add('Vingt-et-unième');
    expect(last.status.speakers).toHaveLength(20);
    expect(last.status.speakers.map((speaker) => speaker.name)).not.toContain('Première');
    expect((await call(port, '/api/speaker/hello', { token })).status).toBe(401);
    expect(turns).toContain('[enceinte] retirée (limite atteinte) : Première');
    expect((await service.status()).speakers.some((speaker) => speaker.lastTurnAt !== null)).toBe(false);
    await service.stop();
  });

  it('speakers.json illisible : copie gardée en .illisible, puis fichier réécrit proprement', async () => {
    const path = join(dir, 'abime.json');
    writeFileSync(path, '{ "enabled": true, "speakers": [ { "id": "x", ');
    const store = new SpeakerStore(() => path);
    await store.load();
    expect(store.enabled).toBe(false);
    expect(store.speakers()).toEqual([]);
    expect(readFileSync(`${path}.illisible`, 'utf8')).toBe('{ "enabled": true, "speakers": [ { "id": "x", ');
    await store.addSpeaker('Cuisine');
    expect(JSON.parse(readFileSync(path, 'utf8')).speakers).toHaveLength(1);
    expect(readFileSync(`${path}.illisible`, 'utf8')).toContain('"id": "x"');

    // Fichier absent : pas de copie fantôme.
    const fresh = new SpeakerStore(() => join(dir, 'absent.json'));
    await fresh.load();
    expect(existsSync(join(dir, 'absent.json.illisible'))).toBe(false);
  });

  it('le fichier ne garde que l’empreinte du jeton', async () => {
    const path = join(dir, 'empreinte.json');
    const store = new SpeakerStore(() => path);
    const { token } = await store.addSpeaker('Chambre');
    const file = readFileSync(path, 'utf8');
    expect(file).not.toContain(token);
    expect(file).toMatch(/"tokenHash": "[0-9a-f]{64}"/);
    const reloaded = new SpeakerStore(() => path);
    await reloaded.load();
    expect(reloaded.verify(token)?.name).toBe('Chambre');
    expect(reloaded.verify(`${token}x`)).toBeNull();
  });
});

describe('réglages des enceintes (5.0.64)', () => {
  it('coupé par défaut ; activé = port ouvert ; ajout = bloc secrets.h avec le jeton ; coupé = port fermé', async () => {
    const store = new SpeakerStore(() => join(dir, 'service.json'));
    const synth = new FakeSynth();
    const broadcasts: string[] = [];
    const service = new SpeakerService({
      store,
      port: 0,
      chatFor: () => new FakeChat(() => undefined),
      transcribe: async () => 'Jarvis bonjour à toi',
      synthesizer: synth,
      voiceSettings: () => ({ wakeWord: 'jarvis', wakeWordVariants: [] }),
      version: () => '5.0.64',
      localAddresses: () => ['192.168.1.20', '10.0.0.4'],
      hostName: () => 'pc-dylan.local',
      broadcast: (status) => broadcasts.push(status.running ? `on:${status.speakers.length}` : 'off'),
    });
    await service.init();
    let status = await service.status();
    expect(status).toMatchObject({ enabled: false, running: false, speakers: [], addresses: ['192.168.1.20', '10.0.0.4'], hostName: 'pc-dylan.local' });

    const added = await service.add('Salon <script>');
    expect(added.speaker.name).toBe('Salon script');
    expect(added.secrets).toContain('#define JARVIS_HOST      "192.168.1.20"');
    expect(added.secrets).toContain('"pc-dylan.local"');
    expect(added.secrets).toMatch(/#define JARVIS_TOKEN {5}"[A-Za-z0-9_-]{43}"/);
    expect(added.secrets).toContain('#define SPEAKER_NAME     "Salon script"');
    expect(added.status.speakers[0]).toMatchObject({ name: 'Salon script', lastTurnAt: null });
    const token = /JARVIS_TOKEN {5}"([^"]+)"/.exec(added.secrets)![1]!;

    status = await service.setEnabled(true);
    expect(status).toMatchObject({ enabled: true, running: true, error: null });
    // Interrupteur allumé : la fenêtre est prévenue tout de suite (elle charge Whisper à l'avance).
    expect(broadcasts).toEqual(['on:1']);
    const port = service.server.port!;
    const reply = await call(port, '/api/speaker/turn', { token, body: voiceWav() });
    expect(reply.status).toBe(204); // faux chat muet : rien à dire
    status = await service.status();
    expect(status.speakers[0]!.lastTurnAt).toBeGreaterThan(0);
    expect(broadcasts).toEqual(['on:1', 'on:1']); // puis à chaque phrase reçue

    status = await service.remove(added.speaker.id);
    expect(status.speakers).toEqual([]);
    expect((await call(port, '/api/speaker/hello', { token })).status).toBe(401);

    status = await service.setEnabled(false);
    expect(status).toMatchObject({ enabled: false, running: false });
    expect(broadcasts.at(-1)).toBe('off');
    await expect(call(port, '/api/speaker/hello', { token })).rejects.toThrow();
    const again = new SpeakerStore(() => join(dir, 'service.json'));
    await again.load();
    expect(again.enabled).toBe(false);
  });

  it('démarrage puis arrêt sans attendre : rien ne reste ouvert ; deux clics croisés sur l’interrupteur non plus', async () => {
    const store = new SpeakerStore(() => join(dir, 'course.json'));
    const service = new SpeakerService({
      store,
      port: 0,
      chatFor: () => new FakeChat(() => undefined),
      transcribe: async () => '',
      synthesizer: new FakeSynth(),
      voiceSettings: () => ({ wakeWord: 'jarvis', wakeWordVariants: [] }),
      version: () => '5.0.64',
      localAddresses: () => [],
    });
    await store.load();

    // Avant la correction : `stop` ne voyait pas encore le serveur (posé seulement une fois à l'écoute) → port ouvert à vie.
    const starting = service.server.start(0);
    const stopping = service.server.stop();
    await Promise.all([starting, stopping]);
    expect(service.server.running).toBe(false);
    expect(service.server.port).toBeNull();

    // Interrupteur cliqué deux fois très vite : le dernier clic gagne, le port est fermé.
    const [, off] = await Promise.all([service.setEnabled(true), service.setEnabled(false)]);
    expect(off).toMatchObject({ enabled: false, running: false });
    expect(service.server.running).toBe(false);
    expect(service.server.port).toBeNull();

    // Et dans l'autre sens : coupé puis rallumé, le port est bien ouvert à la fin.
    const [, back] = await Promise.all([service.setEnabled(false), service.setEnabled(true)]);
    expect(back).toMatchObject({ enabled: true, running: true });
    expect((await call(service.server.port!, '/api/speaker/hello', {})).status).toBe(401);
    await service.stop();
    expect(service.server.running).toBe(false);
  });

  it('nom .local du PC', () => {
    expect(localHostName('PC-de-Dylan')).toBe('pc-de-dylan.local');
    expect(localHostName('Bureau.local')).toBe('bureau.local');
    expect(localHostName('mon pc!')).toBe('mon-pc.local');
    expect(localHostName('')).toBe('pc.local');
  });
});

describe('synthèse de l’enceinte (5.0.64)', () => {
  it('script PowerShell constant : chemins en arguments, texte lu d’un fichier, arrêt à la première erreur', () => {
    const script = windowsSpeechScript();
    expect(windowsSpeechScript()).toBe(script); // rien n'y varie
    expect(script.split('\r\n')[0]).toMatch(/^param\(.*\$InputPath.*\$OutputPath.*\)$/);
    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    expect(script).toContain('ReadAllText($InputPath, [System.Text.Encoding]::UTF8)');
    expect(script).toContain('SetOutputToWaveFile($OutputPath, $format)');
    expect(script).toContain('SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannelCount]::Mono)');
    expect(script).toContain("TwoLetterISOLanguageName -eq 'fr'");
    expect(script).not.toContain('$(');
    expect([...script].every((char) => char.charCodeAt(0) < 128)).toBe(true); // ASCII seulement : lisible quelle que soit la page de code
  });

  it('voix Windows simulée : .ps1 constant + chemins en arguments, texte en UTF-8, WAV relu, fichiers temporaires supprimés', async () => {
    const seen: { text?: string; script?: string; args?: string[] } = {};
    const synth = new WindowsSpeechSynthesizer({
      tmpDir: () => dir,
      runPowerShellFile: async (scriptPath, args) => {
        seen.script = readFileSync(scriptPath, 'utf8');
        seen.args = args;
        const input = args[args.indexOf('-InputPath') + 1]!;
        const output = args[args.indexOf('-OutputPath') + 1]!;
        seen.text = readFileSync(input, 'utf8');
        writeFileSync(output, encodeWav(new Float32Array(2_400), 24_000));
        return { code: 0, signal: null, stdout: 'OK\n', stderr: '', timedOut: false, truncated: false };
      },
    });
    const wav = await synth.synthesize('Bonjour, il est dix heures. L’apostrophe ‘typographique’ ne gêne pas.');
    expect(seen.text).toBe('Bonjour, il est dix heures. L’apostrophe ‘typographique’ ne gêne pas.');
    expect(seen.script).toBe(`\uFEFF${windowsSpeechScript()}`);
    expect(seen.args).toHaveLength(4);
    expect(seen.args![1]).toMatch(/jarvis-enceinte-[0-9a-f]{16}\.txt$/);
    expect(seen.args![3]).toMatch(/jarvis-enceinte-[0-9a-f]{16}\.wav$/);
    const decoded = decodeWav(wav);
    expect(decoded.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(decoded.samples.length).toBe(1_600);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(dir).filter((name) => name.startsWith('jarvis-enceinte-'))).toEqual([]);
  });

  it('voix Windows en échec : erreur claire, fichiers supprimés', async () => {
    const synth = new WindowsSpeechSynthesizer({
      tmpDir: () => dir,
      runPowerShellFile: async () => ({ code: 1, signal: null, stdout: '', stderr: 'Add-Type : introuvable', timedOut: false, truncated: false }),
    });
    await expect(synth.synthesize('x')).rejects.toThrow('Add-Type : introuvable');
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(dir).filter((name) => name.startsWith('jarvis-enceinte-'))).toEqual([]);
  });

  it('OpenAI choisi avec une clé : WAV demandé puis ramené à 16 kHz ; sinon la voix Windows ; hors Windows sans clé : erreur', async () => {
    const calls: Array<{ text: string; format?: string; voice?: string }> = [];
    let ttsProvider = 'openai-tts';
    let hasKey = true;
    const windows = new FakeSynth();
    const synth = createSpeakerSynthesizer({
      getSettings: () => ({ voice: { ttsProvider, ttsVoice: 'nova' } }) as never,
      voice: {
        hasApiKey: () => hasKey,
        speak: async (input) => {
          calls.push({ text: input.text, format: input.format, voice: input.voice });
          return { ok: true, data: encodeWav(new Float32Array(24_000), 24_000), mimeType: 'audio/wav' };
        },
      },
      platform: 'linux',
      windows,
    });
    const wav = decodeWav(await synth.synthesize('Salut'));
    expect(wav.sampleRate).toBe(SPEAKER_SAMPLE_RATE);
    expect(wav.samples.length).toBe(SPEAKER_SAMPLE_RATE);
    expect(calls).toEqual([{ text: 'Salut', format: 'wav', voice: 'nova' }]);

    hasKey = false;
    await synth.synthesize('Sans clé');
    expect(windows.spoken).toEqual(['Sans clé']);
    ttsProvider = 'browser-local';
    hasKey = true;
    await synth.synthesize('Voix Windows choisie');
    expect(windows.spoken).toEqual(['Sans clé', 'Voix Windows choisie']);
    expect(calls).toHaveLength(1);

    const none = createSpeakerSynthesizer({
      getSettings: () => ({ voice: { ttsProvider: 'browser-local', ttsVoice: '' } }) as never,
      voice: { hasApiKey: () => false, speak: async () => ({ ok: false, error: 'non' }) },
      platform: 'linux',
    });
    await expect(none.synthesize('x')).rejects.toThrow('Aucune voix disponible');
  });
});
