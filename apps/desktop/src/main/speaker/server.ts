import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  SPEAKER_CONFIRMATION_REFUSAL,
  SPEAKER_HEADER_CONTINUE,
  SPEAKER_HEADER_FOLLOW_UP,
  SPEAKER_HEADER_TRANSCRIPT,
  SPEAKER_MAX_BODY_BYTES,
  SPEAKER_NO_REPLY,
  SPEAKER_SESSION_IDLE_MS,
  SPEAKER_TRANSCRIBE_FAILED,
  checkTurnWav,
  classifySpokenTurn,
  followUpWindowMs,
  isPrivateAddress,
  isWavContentType,
  speechTextForSpeaker,
  type ChatMessage,
  type ConversationStore,
  type VoiceSettings,
} from '@jarvis/core';
import type { ChatEvent, SendChatInput } from '../../shared/ipc.js';
import type { Speaker, SpeakerStore } from './store.js';
import type { SpeakerSynthesizer } from './synth.js';

/**
 * 5.0.64 — le pont des enceintes. `node:http` sur **toutes les interfaces** (la carte est sur le
 * Wi-Fi, pas sur la boucle locale) mais toute requête dont l'adresse distante n'est pas privée est
 * refusée : jamais d'Internet. Jeton obligatoire sur chaque route, comparé en temps constant.
 * Une phrase (WAV 16 kHz mono) → Whisper (dans la fenêtre) → session de chat de l'enceinte →
 * réponse vocale (WAV) renvoyée à la carte.
 */

/** Ce que la session de chat attend de « l'émetteur » (ici, la réponse HTTP). */
export interface SpeakerSender {
  isDestroyed(): boolean;
  send(channel: string, event: ChatEvent): void;
  once(event: 'destroyed', listener: () => void): void;
  removeListener(event: 'destroyed', listener: () => void): void;
}

export interface SpeakerChat {
  send(sender: SpeakerSender, input: SendChatInput): Promise<void>;
  respondConfirmation(requestId: string, approved: boolean): void;
  cancel(): void;
}

export interface SpeakerServerDeps {
  store: Pick<SpeakerStore, 'verify'>;
  /** Une session de chat par enceinte, créée à sa première phrase. */
  chatFor: (speaker: Speaker) => SpeakerChat;
  /** Transcription Whisper (dans la fenêtre) d'un PCM 16 kHz. */
  transcribe: (pcm: Float32Array) => Promise<string>;
  synthesizer: SpeakerSynthesizer;
  voiceSettings: () => Pick<VoiceSettings, 'wakeWord' | 'wakeWordVariants' | 'followUpSeconds'>;
  version: () => string;
  /** Historique du PC : la discussion d'une enceinte y prend son nom en titre. */
  conversations?: Pick<ConversationStore, 'get' | 'save'>;
  /** Une phrase vient d'arriver (heure gardée en mémoire pour les réglages). */
  onTurn?: (speaker: Speaker, at: number) => void;
  log?: (line: string) => void;
  now?: () => number;
  /** Adresse distante d'une requête ; remplaçable dans les tests (tout vient de 127.0.0.1). */
  remoteAddress?: (req: IncomingMessage) => string | undefined;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface SpeakerState {
  speaker: Speaker;
  /** Créée à la première phrase réellement envoyée au chat. */
  chat: SpeakerChat | null;
  conversationId: string | null;
  lastTurnAt: number;
  busy: boolean;
}

interface ChatOutcome {
  reply: string;
  refused: boolean;
  notAddressed: boolean;
  error: string | null;
  conversationId: string | null;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header.trim()) : null;
  return match ? match[1]! : null;
}

async function readBody(req: IncomingMessage, max: number): Promise<Uint8Array> {
  const announced = Number(req.headers['content-length']);
  if (Number.isFinite(announced) && announced > max) throw new HttpError(413, 'Audio trop long (1,5 Mo au plus, environ 45 s).');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > max) throw new HttpError(413, 'Audio trop long (1,5 Mo au plus, environ 45 s).');
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Texte des messages de l'assistant après le dernier message de l'utilisateur. */
function lastAssistantText(messages: readonly ChatMessage[]): string {
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  return messages
    .slice(lastUser + 1)
    .filter((message) => message.role === 'assistant' && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n');
}

export class SpeakerServer {
  private server: Server | null = null;
  private boundPort: number | null = null;
  private readonly states = new Map<string, SpeakerState>();

  constructor(private readonly deps: SpeakerServerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  get port(): number | null {
    return this.boundPort;
  }

  get running(): boolean {
    return this.server !== null;
  }

  /** Démarre sur toutes les interfaces. Port déjà pris : erreur, rien ne reste ouvert. */
  start(port: number): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
        else {
          this.deps.log?.(`[enceinte] erreur : ${error instanceof Error ? error.message : String(error)}`);
          sendJson(res, 500, { error: 'Erreur de Jarvis.' });
        }
      });
    });
    // Une phrase peut prendre plus d'une minute (Whisper, outils, modèle, synthèse).
    server.requestTimeout = 0;
    server.headersTimeout = 30_000;
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        server.on('error', (error) => this.deps.log?.(`[enceinte] serveur : ${error.message}`));
        this.server = server;
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    for (const state of this.states.values()) state.chat?.cancel();
    this.states.clear();
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  /** Enceinte retirée : sa discussion est oubliée. */
  forget(speakerId: string): void {
    const state = this.states.get(speakerId);
    if (!state) return;
    state.chat?.cancel();
    this.states.delete(speakerId);
  }

  private stateFor(speaker: Speaker): SpeakerState {
    let state = this.states.get(speaker.id);
    if (!state) {
      state = { speaker, chat: null, conversationId: null, lastTurnAt: 0, busy: false };
      this.states.set(speaker.id, state);
    }
    return state;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const remote = this.deps.remoteAddress ? this.deps.remoteAddress(req) : req.socket.remoteAddress;
    if (!isPrivateAddress(remote)) {
      this.deps.log?.(`[enceinte] requête refusée depuis une adresse non locale (${remote ?? '?'})`);
      throw new HttpError(403, 'Réseau local seulement.');
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    const path = url.pathname;

    const speaker = this.deps.store.verify(bearer(req));
    if (!speaker) throw new HttpError(401, 'Cette enceinte n’est pas reliée à Jarvis : vérifie le jeton dans secrets.h.');

    if (path === '/api/speaker/hello') {
      if (method !== 'GET') throw new HttpError(405, 'Méthode refusée.');
      return sendJson(res, 200, {
        name: speaker.name,
        version: this.deps.version(),
        followUpMs: followUpWindowMs(this.deps.voiceSettings()),
      });
    }
    if (path === '/api/speaker/turn') {
      if (method !== 'POST') throw new HttpError(405, 'Méthode refusée.');
      return this.turn(req, res, speaker);
    }
    throw new HttpError(404, 'Introuvable.');
  }

  private async turn(req: IncomingMessage, res: ServerResponse, speaker: Speaker): Promise<void> {
    if (!isWavContentType(req.headers['content-type'])) throw new HttpError(415, 'Format attendu : audio/wav (PCM 16 bits, mono, 16 kHz).');
    const body = await readBody(req, SPEAKER_MAX_BODY_BYTES);
    const state = this.stateFor(speaker);
    if (state.busy) throw new HttpError(429, 'Une phrase de cette enceinte est déjà en cours.');
    state.busy = true;
    try {
      const check = checkTurnWav(body);
      if (!check.ok) throw new HttpError(400, `WAV refusé : ${check.error}`);
      const followUp = String(req.headers[SPEAKER_HEADER_FOLLOW_UP] ?? '') === '1';
      const now = this.now();
      this.deps.onTurn?.(speaker, now);

      let transcript: string;
      try {
        transcript = (await this.deps.transcribe(check.pcm)).trim();
      } catch (error) {
        this.deps.log?.(`[enceinte] ${speaker.name} : transcription impossible (${error instanceof Error ? error.message : String(error)})`);
        return this.errorWav(res, 503, SPEAKER_TRANSCRIBE_FAILED);
      }
      this.deps.log?.(`[enceinte] ${speaker.name}${followUp ? ' (suivi)' : ''} : « ${transcript.slice(0, 120)} »`);

      const voice = this.deps.voiceSettings();
      const wake = { word: voice.wakeWord, variants: voice.wakeWordVariants };
      const decision = classifySpokenTurn(transcript, followUp ? 'follow-up' : 'command', wake);
      if (decision.kind !== 'send') return this.noReply(res, transcript);

      // Une discussion continue tant que l'enceinte envoie des phrases ; après 10 minutes, une nouvelle.
      if (state.conversationId && now - state.lastTurnAt > SPEAKER_SESSION_IDLE_MS) state.conversationId = null;
      state.lastTurnAt = now;
      const wasNew = state.conversationId === null;

      const outcome = await this.runChat(state, decision.text, followUp);
      if (outcome.notAddressed) return this.noReply(res, transcript);
      if (outcome.conversationId) {
        state.conversationId = outcome.conversationId;
        if (wasNew) await this.titleConversation(outcome.conversationId, speaker);
      }

      const spoken = outcome.refused
        ? SPEAKER_CONFIRMATION_REFUSAL
        : speechTextForSpeaker(outcome.reply) || (outcome.error ? SPEAKER_NO_REPLY : '');
      if (!spoken) return this.noReply(res, transcript);
      const wav = await this.deps.synthesizer.synthesize(spoken);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.byteLength),
        [SPEAKER_HEADER_CONTINUE]: followUpWindowMs(voice) > 0 ? '1' : '0',
        [SPEAKER_HEADER_TRANSCRIPT]: encodeURIComponent(transcript),
      });
      res.end(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength));
    } finally {
      state.busy = false;
    }
  }

  /** Rien à dire : 204, l'enceinte retourne en veille. */
  private noReply(res: ServerResponse, transcript: string): void {
    res.writeHead(204, {
      [SPEAKER_HEADER_CONTINUE]: '0',
      [SPEAKER_HEADER_TRANSCRIPT]: encodeURIComponent(transcript),
    });
    res.end();
  }

  /** Court WAV d'erreur (Whisper indisponible) ; si même la voix manque, JSON. */
  private async errorWav(res: ServerResponse, status: number, text: string): Promise<void> {
    let wav: Uint8Array;
    try {
      wav = await this.deps.synthesizer.synthesize(text);
    } catch {
      return sendJson(res, status, { error: text }, { [SPEAKER_HEADER_CONTINUE]: '0' });
    }
    res.writeHead(status, {
      'Content-Type': 'audio/wav',
      'Content-Length': String(wav.byteLength),
      [SPEAKER_HEADER_CONTINUE]: '0',
    });
    res.end(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength));
  }

  /**
   * Un tour de la session de l'enceinte. Une carte de confirmation est **refusée** tout de suite
   * (aucun écran sur une enceinte) et Jarvis le dira ; `not_addressed` (5.0.62) = rien à dire.
   */
  private runChat(state: SpeakerState, text: string, followUp: boolean): Promise<ChatOutcome> {
    const outcome: ChatOutcome = { reply: '', refused: false, notAddressed: false, error: null, conversationId: state.conversationId };
    let fromMessages = '';
    const chat = state.chat ?? (state.chat = this.deps.chatFor(state.speaker));
    const sender: SpeakerSender = {
      isDestroyed: () => false,
      send: (_channel, event) => {
        switch (event.type) {
          case 'started':
            outcome.conversationId = event.conversationId;
            break;
          case 'delta':
            outcome.reply += event.text;
            break;
          case 'confirm':
            outcome.refused = true;
            chat.respondConfirmation(event.requestId, false);
            break;
          case 'not_addressed':
            outcome.notAddressed = true;
            break;
          case 'error':
            outcome.error = event.message;
            break;
          case 'done':
            fromMessages = lastAssistantText(event.messages);
            break;
          default:
            break;
        }
      },
      once: () => undefined,
      removeListener: () => undefined,
    };
    return chat
      .send(sender, { conversationId: state.conversationId, text, source: 'voice', ...(followUp ? { followUp: true } : {}) })
      .then(() => ({ ...outcome, reply: outcome.reply.trim() || fromMessages }))
      .catch((error: unknown) => ({ ...outcome, error: error instanceof Error ? error.message : String(error) }));
  }

  /** Titre de l'historique préfixé du nom de l'enceinte (format inchangé par ailleurs). */
  private async titleConversation(conversationId: string, speaker: Speaker): Promise<void> {
    const store = this.deps.conversations;
    if (!store) return;
    try {
      const conversation = await store.get(conversationId);
      if (!conversation) return;
      const prefix = `${speaker.name} · `;
      if (conversation.title.startsWith(prefix)) return;
      await store.save({ ...conversation, title: `${prefix}${conversation.title}` });
    } catch (error) {
      this.deps.log?.(`[enceinte] titre non changé : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
