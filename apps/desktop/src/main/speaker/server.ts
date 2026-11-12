import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  SPEAKER_HEADER_CONTINUE,
  SPEAKER_HEADER_FOLLOW_UP,
  SPEAKER_HEADER_TRANSCRIPT,
  SPEAKER_MAX_BODY_BYTES,
  SPEAKER_NO_REPLY,
  SPEAKER_SESSION_IDLE_MS,
  SPEAKER_TRANSCRIBE_FAILED,
  SPEAKER_TURN_TIMEOUT_MS,
  SPEAKER_HEADER_CAPTURE_MS,
  SPEAKER_WAKE_INTERVAL_MS,
  SPEAKER_CONFIRMATION_REFUSAL,
  SPEAKER_MISSION_PROPOSAL,
  SPEAKER_DETAIL_ON_PC,
  SPEAKER_EARLY_SENTENCES,
  SPEAKER_IMAGE_WAIT,
  SPEAKER_SAMPLE_RATE,
  SentenceStreamer,
  checkTurnWav,
  streamingWavHeader,
  wavPcmBytes,
  classifySpokenTurn,
  collapseRepeatedSentences,
  speakerReplyForEars,
  speakerReflexPhrase,
  followUpWindowMs,
  isSpotifyDeviceQuestion,
  looksLikeImageIntent,
  isPrivateAddress,
  speakerGreeting,
  readHelloHeaders,
  isWavContentType,
  readCaptureMs,
  type SpeakerChrono,
  type SpeakerChronoPath,
  type SpeakerChronoSample,
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
  store: Pick<SpeakerStore, 'verify' | 'noteHello' | 'takeHelloActions'>;
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
  /** Ouvre la discussion de l'enceinte sur l'écran du PC, sans prendre le clavier. */
  onShowOnPc?: (conversationId: string) => void;
  log?: (line: string) => void;
  now?: () => number;
  /** Délai maximal d'une phrase côté PC (défaut `SPEAKER_TURN_TIMEOUT_MS`) ; court dans les tests. */
  turnTimeoutMs?: number;
  /** Adresse distante d'une requête ; remplaçable dans les tests (tout vient de 127.0.0.1). */
  remoteAddress?: (req: IncomingMessage) => string | undefined;
  /** Durées des phrases (jamais le texte). */
  chrono?: SpeakerChrono;
  /** Suivi d'enceinte jugé par les règles seulement. */
  rulesOnlyAddressee?: () => boolean;
  /** Le préchauffage au mot « Jarvis » est activé. */
  warmupEnabled?: () => boolean;
  /** Charge Whisper, les modèles et Piper. Ne doit rien générer. */
  warm?: () => void | Promise<void>;
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
  /**
   * Image en cours sur sa propre session. Les phrases d'après vont ailleurs
   * jusqu'à la fin : `send` d'une même session annulerait le calcul.
   */
  image: { chat: SpeakerChat; conversationId: string | null } | null;
  /** Réponse déjà partie : la suite du modèle continue sans être annulée par la phrase d'après. */
  live: { chat: SpeakerChat; conversationId: string | null } | null;
}

/** Lien avec la carte pendant une phrase : rompu (fermé ou trop long) = plus rien ne lui est dû. */
interface TurnLink {
  gone: boolean;
  timedOut: boolean;
  /** Génération laissée tourner sur le PC : fermer la réponse HTTP ne l'annule pas. */
  detached: boolean;
  listeners: Set<() => void>;
  /** Session de CE tour : un raccrochage n'annule pas une image partie sur une autre. */
  bind(chat: SpeakerChat): void;
  release(): void;
  detach(): void;
}

/** File de phrases en cours d'envoi à la carte (réponse en flux). */
interface SpeakerStream {
  /** Entêtes HTTP et WAV déjà partis (première phrase envoyée). */
  started: boolean;
  /** Phrases mises en file (0 = rien à dire). */
  queued: number;
  /** Première erreur de synthèse, s'il y en a eu une. */
  failed: string | null;
  enqueue(sentence: string): void;
  /** Jette les phrases pas encore synthétisées (une carte refusée) ; ce qui est parti reste. */
  discard(): void;
  /** Attend la fin de la file et termine la réponse. */
  finish(): Promise<void>;
}

interface ChatOutcome {
  reply: string;
  refused: boolean;
  notAddressed: boolean;
  error: string | null;
  conversationId: string | null;
  missionProposal: boolean;
  tools: string[];
  path: SpeakerChronoPath;
  firstAt: number | null;
  /** Texte du dernier message assistant quand le chat n'a rien diffusé en deltas. */
  fromMessages: string;
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
function chronoPath(how: string, model: string): SpeakerChronoPath {
  if (how === 'calcul' || model === 'sans modèle') return 'reflexe';
  if (how === 'express' || how === 'direct') return 'express';
  if (how === 'trieur') return 'trieur';
  return 'cerveau';
}

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
  private queue: Promise<void> = Promise.resolve();
  private lastWarmAt = Number.NEGATIVE_INFINITY;

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

  /**
   * `start` et `stop` s'enchaînent toujours dans l'ordre où ils sont demandés (l'interrupteur
   * cliqué deux fois vite, ou coupé pendant le démarrage) : jamais un port qui reste ouvert.
   */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Démarre sur toutes les interfaces. Port déjà pris : erreur, rien ne reste ouvert. */
  start(port: number): Promise<void> {
    return this.serialize(() => this.doStart(port));
  }

  stop(): Promise<void> {
    return this.serialize(() => this.doStop());
  }

  private doStart(port: number): Promise<void> {
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
    // Posé tout de suite : un `stop` demandé pendant `listen` trouvera ce serveur à fermer.
    this.server = server;
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        if (this.server === server) this.server = null;
        reject(error);
      };
      server.once('error', onError);
      server.listen(port, () => {
        server.off('error', onError);
        server.on('error', (error) => this.deps.log?.(`[enceinte] serveur : ${error.message}`));
        const address = server.address();
        this.boundPort = typeof address === 'object' && address ? address.port : port;
        resolve();
      });
    });
  }

  private async doStop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.boundPort = null;
    for (const state of this.states.values()) {
      state.chat?.cancel();
      state.image?.chat.cancel();
      state.live?.chat.cancel();
    }
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
    state.image?.chat.cancel();
    state.live?.chat.cancel();
    this.states.delete(speakerId);
  }

  private stateFor(speaker: Speaker): SpeakerState {
    let state = this.states.get(speaker.id);
    if (!state) {
      state = { speaker, chat: null, conversationId: null, lastTurnAt: 0, busy: false, image: null, live: null };
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
      const flat: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(req.headers)) flat[key] = Array.isArray(value) ? value[0] : value;
      const signs = readHelloHeaders(flat);
      if (signs.fw || signs.mac || typeof signs.rssi === 'number') {
        await this.deps.store.noteHello(speaker.id, signs, this.now());
      }
      const actions = await this.deps.store.takeHelloActions(speaker.id);
      const body: { name: string; version: string; followUpMs: number; identify?: true; rename?: string } = {
        name: actions.rename ?? speaker.name,
        version: this.deps.version(),
        followUpMs: followUpWindowMs(this.deps.voiceSettings()),
      };
      if (actions.identify) body.identify = true;
      if (actions.rename) body.rename = actions.rename;
      return sendJson(res, 200, body);
    }
    if (path === '/api/speaker/greeting') {
      if (method !== 'GET') throw new HttpError(405, 'Méthode refusée.');
      const wav = await this.deps.synthesizer.synthesize(speakerGreeting(speaker.name));
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.byteLength),
      });
      res.end(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength));
      return;
    }
    if (path === '/api/speaker/turn') {
      if (method !== 'POST') throw new HttpError(405, 'Méthode refusée.');
      return this.turn(req, res, speaker);
    }
    if (path === '/api/speaker/wake') {
      if (method !== 'POST') throw new HttpError(405, 'Méthode refusée.');
      res.writeHead(204);
      res.end();
      this.scheduleWarm();
      return;
    }
    throw new HttpError(404, 'Introuvable.');
  }

  private scheduleWarm(): void {
    if (!this.deps.warmupEnabled?.()) return;
    const now = this.now();
    if (now - this.lastWarmAt < SPEAKER_WAKE_INTERVAL_MS) return;
    this.lastWarmAt = now;
    void Promise.resolve(this.deps.warm?.()).catch((error: unknown) => {
      this.deps.log?.(`[enceinte] préchauffage : ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async turn(req: IncomingMessage, res: ServerResponse, speaker: Speaker): Promise<void> {
    if (!isWavContentType(req.headers['content-type'])) throw new HttpError(415, 'Format attendu : audio/wav (PCM 16 bits, mono, 16 kHz).');
    const started = this.now();
    const mark: SpeakerChronoSample = {
      audioMs: 0,
      captureMs: readCaptureMs(req.headers[SPEAKER_HEADER_CAPTURE_MS]),
      transcriptionMs: 0,
      decisionMs: 0,
      path: 'cerveau',
      firstTextMs: null,
      spokenReadyMs: null,
      synthesisMs: null,
      firstSoundMs: null,
      responseMs: null,
      totalMs: 0,
    };
    let noted = false;
    const note = (path?: SpeakerChronoPath): void => {
      if (noted) return;
      noted = true;
      if (path) mark.path = path;
      mark.totalMs = Math.max(0, this.now() - started);
      this.deps.chrono?.record(mark);
    };
    const body = await readBody(req, SPEAKER_MAX_BODY_BYTES);
    const state = this.stateFor(speaker);
    // Une phrase à la fois : la seconde est refusée tout de suite, sans refaire
    // la transcription (le test et la carte comptent sur ce 429 immédiat).
    if (state.busy) {
      note();
      throw new HttpError(429, 'Une phrase de cette enceinte est déjà en cours.');
    }
    state.busy = true;
    const check = checkTurnWav(body);
    if (!check.ok) {
      state.busy = false;
      throw new HttpError(400, `WAV refusé : ${check.error}`);
    }
    mark.audioMs = Math.round((check.pcm.length / SPEAKER_SAMPLE_RATE) * 1000);
    const transcribeStarted = this.now();
    let transcript: string;
    try {
      transcript = collapseRepeatedSentences((await this.deps.transcribe(check.pcm)).trim());
    } catch (error) {
      mark.transcriptionMs = Math.max(0, this.now() - transcribeStarted);
      note();
      state.busy = false;
      this.deps.log?.(`[enceinte] ${speaker.name} : transcription impossible (${error instanceof Error ? error.message : String(error)})`);
      return this.errorWav(res, 503, SPEAKER_TRANSCRIBE_FAILED);
    }
    mark.transcriptionMs = Math.max(0, this.now() - transcribeStarted);
    const followUp = String(req.headers[SPEAKER_HEADER_FOLLOW_UP] ?? '') === '1';
    const voice = this.deps.voiceSettings();
    const wake = { word: voice.wakeWord, variants: voice.wakeWordVariants };
    const classifiedAt = this.now();
    const decision = classifySpokenTurn(transcript, followUp ? 'follow-up' : 'command', wake);
    mark.decisionMs = Math.max(0, this.now() - classifiedAt);
    // Un « stop » n'attend ni la phrase en cours, ni la fin de la transcription suivante.
    if (decision.kind === 'stop') {
      state.chat?.cancel();
      state.live?.chat.cancel();
      state.image?.chat.cancel();
      note('reflexe');
      state.busy = false;
      return this.noReply(res, transcript);
    }
    const link = this.watchLink(res);
    let parked = false;
    try {
      const now = this.now();
      this.deps.onTurn?.(speaker, now);
      this.deps.log?.(`[enceinte] ${speaker.name}${followUp ? ' (suivi)' : ''} : « ${transcript.slice(0, 120)} »`);
      if (decision.kind !== 'send') {
        note('reflexe');
        return this.noReply(res, transcript);
      }
      if (state.conversationId && now - state.lastTurnAt > SPEAKER_SESSION_IDLE_MS) state.conversationId = null;
      state.lastTurnAt = now;
      const wasNew = state.conversationId === null;
      if (looksLikeImageIntent(decision.text)) {
        mark.path = 'reflexe';
        mark.spokenReadyMs = Math.max(0, this.now() - started);
        const synthStarted = this.now();
        await this.backgroundImage(res, state, speaker, decision.text, transcript, followUp, link);
        mark.synthesisMs = Math.max(0, this.now() - synthStarted);
        mark.firstSoundMs = mark.synthesisMs;
        note('reflexe');
        return;
      }

      const imageAtStart = state.image;
      let conversationSeen: string | null = state.conversationId;
      const streamer = new SentenceStreamer();
      let earCount = 0;
      let earClosed = false;
      let reflexPhrase: string | null = null;
      let earFinish: Promise<void> = Promise.resolve();
      const stream = this.openStream(
        res,
        link,
        (first) => ({
          [SPEAKER_HEADER_CONTINUE]: followUpWindowMs(voice) > 0 || isSpotifyDeviceQuestion(first) ? '1' : '0',
          [SPEAKER_HEADER_TRANSCRIPT]: encodeURIComponent(transcript),
        }),
        () => {
          if (mark.firstSoundMs === null) mark.firstSoundMs = Math.max(0, this.now() - started);
        },
        (synthMs) => {
          mark.synthesisMs = (mark.synthesisMs ?? 0) + synthMs;
        },
      );
      const park = (): void => {
        if (parked) return;
        parked = true;
        link.detach();
        const chat = state.chat;
        if (chat) {
          state.live = { chat, conversationId: state.conversationId };
          state.chat = null;
          state.conversationId = null;
        }
        state.busy = false;
      };
      const closeEar = (): void => {
        if (earClosed) return;
        earClosed = true;
        mark.spokenReadyMs = Math.max(0, this.now() - started);
        stream.enqueue(SPEAKER_DETAIL_ON_PC);
        const showId = state.conversationId ?? conversationSeen;
        if (showId) this.deps.onShowOnPc?.(showId);
        park();
        earFinish = stream.finish();
      };
      const say = (sentences: string[], chatFinished: boolean): void => {
        for (const sentence of sentences) {
          if (earClosed || reflexPhrase) return;
          if (earCount >= SPEAKER_EARLY_SENTENCES) {
            closeEar();
            return;
          }
          if (mark.spokenReadyMs === null) mark.spokenReadyMs = Math.max(0, this.now() - started);
          stream.enqueue(sentence);
          earCount += 1;
          if (earCount >= SPEAKER_EARLY_SENTENCES && !chatFinished) closeEar();
        }
      };
      const pending = this.runChat(
        state,
        decision.text,
        followUp,
        link,
        (conversationId) => {
          conversationSeen = conversationId;
          if (wasNew) void this.titleConversation(conversationId, speaker);
        },
        undefined,
        {
          onDelta: (delta) => {
            if (reflexPhrase) return;
            say(streamer.push(delta), false);
          },
          onUpdate: (outcome) => {
            if (outcome.path) mark.path = outcome.path;
            if (outcome.firstAt !== null && mark.firstTextMs === null) {
              mark.firstTextMs = Math.max(0, outcome.firstAt - started);
            }
            if (reflexPhrase || outcome.refused) return;
            for (const toolName of outcome.tools) {
              const phrase = speakerReflexPhrase(toolName, decision.text);
              if (!phrase) continue;
              reflexPhrase = phrase;
              mark.path = 'reflexe';
              stream.discard();
              earClosed = true;
              mark.spokenReadyMs = Math.max(0, this.now() - started);
              stream.enqueue(phrase);
              if (outcome.conversationId) this.deps.onShowOnPc?.(outcome.conversationId);
              break;
            }
          },
        },
      );
      const outcome = await pending;
      if (!parked && outcome.conversationId) {
        const imageStillRunning = imageAtStart !== null && state.image === imageAtStart;
        const imageEndedDuring = imageAtStart !== null && state.image === null;
        if (!imageStillRunning && !imageEndedDuring) {
          state.conversationId = outcome.conversationId;
          if (wasNew) await this.titleConversation(outcome.conversationId, speaker);
        } else if (wasNew) {
          await this.titleConversation(outcome.conversationId, speaker);
        }
      } else if (parked) {
        const jobChat = state.live?.chat ?? null;
        void Promise.resolve(outcome).then((final) => {
          if (!jobChat || state.live?.chat !== jobChat) return;
          state.live = null;
          if (state.chat === null) {
            state.chat = jobChat;
            state.conversationId = final.conversationId;
          }
          if (final.conversationId && (final.refused || final.missionProposal)) {
            this.deps.onShowOnPc?.(final.conversationId);
          }
        });
      }
      if (link.gone && !stream.started) {
        note(mark.path);
        return;
      }
      if (outcome.notAddressed && !stream.started) {
        note('reflexe');
        return this.noReply(res, transcript);
      }
      if (outcome.refused) {
        stream.discard();
        earClosed = true;
        stream.enqueue(SPEAKER_CONFIRMATION_REFUSAL);
      } else if (!reflexPhrase && !earClosed) {
        say(streamer.flush(), true);
        const full = outcome.reply || outcome.fromMessages;
        if (!stream.queued && full) {
          const late = new SentenceStreamer();
          say([...late.push(full), ...late.flush()], true);
        }
        const ears = speakerReplyForEars(full);
        if (ears.showOnPc && ears.spoken.includes(SPEAKER_DETAIL_ON_PC) && !earClosed) {
          stream.enqueue(SPEAKER_DETAIL_ON_PC);
          if (outcome.conversationId) this.deps.onShowOnPc?.(outcome.conversationId);
        } else if (ears.showOnPc && outcome.conversationId) {
          this.deps.onShowOnPc?.(outcome.conversationId);
        }
        if (outcome.missionProposal) stream.enqueue(SPEAKER_MISSION_PROPOSAL);
      }
      if (!stream.queued && outcome.error) stream.enqueue(SPEAKER_NO_REPLY);
      if (!stream.queued && !stream.started) {
        note(mark.path);
        return this.noReply(res, transcript);
      }
      if (earClosed && parked) await earFinish;
      else {
        const responseStarted = this.now();
        await stream.finish();
        mark.responseMs = Math.max(0, this.now() - responseStarted);
      }
      if (stream.failed && !stream.started) throw new HttpError(500, stream.failed);
      note(mark.path);
    } finally {
      note();
      link.release();
      if (!parked) state.busy = false;
    }
  }

  /**
   * Flux de réponse : une file de phrases, synthétisées une à une et envoyées dès que possible ;
   * l'entête HTTP et l'entête WAV partent avec la première. Une synthèse qui échoue avant la
   * première phrase remonte en erreur ; après, le flux s'arrête proprement.
   */
  private openStream(
    res: ServerResponse,
    link: TurnLink,
    headersFor: (firstSentence: string) => Record<string, string>,
    onFirstSound: () => void,
    onSynth: (ms: number) => void,
  ): SpeakerStream {
    const stream: SpeakerStream = {
      started: false,
      queued: 0,
      failed: null,
      discard: () => {
        generation += 1;
        if (!stream.started) stream.queued = 0;
      },
      enqueue: (sentence: string) => {
        stream.queued += 1;
        const mine = generation;
        chain = chain.then(async () => {
          if (link.gone || stream.failed || mine !== generation) return;
          let wav: Uint8Array;
          const synthStarted = this.now();
          try {
            wav = await this.deps.synthesizer.synthesize(sentence);
          } catch (error) {
            stream.failed = error instanceof Error ? error.message : String(error);
            this.deps.log?.(`[enceinte] synthèse impossible : ${stream.failed}`);
            return;
          }
          onSynth(Math.max(0, this.now() - synthStarted));
          if (link.gone) return;
          if (!stream.started) {
            stream.started = true;
            res.writeHead(200, { 'Content-Type': 'audio/wav', ...headersFor(sentence) });
            res.write(Buffer.from(streamingWavHeader()));
          }
          const pcm = wavPcmBytes(wav);
          await new Promise<void>((resolve) => {
            if (!res.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength))) res.once('drain', () => resolve());
            else resolve();
          });
          onFirstSound();
        });
      },
      finish: async () => {
        await chain;
        if (stream.started && !res.writableEnded) res.end();
      },
    };
    let chain: Promise<void> = Promise.resolve();
    let generation = 0;
    return stream;
  }

  /**
   * Suit la connexion d'une phrase : fermée par la carte, ou trop longue côté PC. Dans les deux cas
   * la session de chat est annulée tout de suite (le modèle et les outils s'arrêtent, rien n'est
   * exécuté pour personne) et `busy` est rendu par `turn`.
   */
  private watchLink(res: ServerResponse): TurnLink {
    const listeners = new Set<() => void>();
    let bound: SpeakerChat | null = null;
    const link: TurnLink = {
      gone: false,
      timedOut: false,
      detached: false,
      listeners,
      bind: (chat) => {
        bound = chat;
      },
      release: () => {
        clearTimeout(timer);
        res.off('close', onClose);
        listeners.clear();
      },
      detach: () => {
        link.detached = true;
        clearTimeout(timer);
        res.off('close', onClose);
      },
    };
    const drop = (): void => {
      if (link.detached || link.gone) return;
      link.gone = true;
      bound?.cancel();
      for (const listener of listeners) listener();
      listeners.clear();
    };
    const onClose = (): void => {
      if (!res.writableEnded) drop();
    };
    const timer = setTimeout(() => {
      link.timedOut = true;
      drop();
      if (!res.headersSent) sendJson(res, 504, { error: 'Jarvis a mis trop longtemps à répondre.' }, { [SPEAKER_HEADER_CONTINUE]: '0' });
      else res.destroy();
    }, this.deps.turnTimeoutMs ?? SPEAKER_TURN_TIMEOUT_MS);
    res.on('close', onClose);
    return link;
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
   * Image : la carte reçoit tout de suite la phrase d'attente. Le calcul continue sur le PC
   * (fermer cette réponse HTTP ne l'annule pas). La phrase de fin est dans la discussion,
   * pas renvoyée à l'enceinte : il n'y a pas de canal pour la prévenir plus tard.
   */
  private async backgroundImage(
    res: ServerResponse,
    state: SpeakerState,
    speaker: Speaker,
    text: string,
    transcript: string,
    followUp: boolean,
    link: TurnLink,
  ): Promise<void> {
    link.detach();
    const imageChat = state.chat ?? this.deps.chatFor(speaker);
    const imageConversationId = state.conversationId;
    // La phrase suivante ne doit pas entrer dans cette session : send() annulerait l'image.
    state.chat = null;
    state.conversationId = null;
    const job = { chat: imageChat, conversationId: imageConversationId };
    state.image = job;
    link.bind(imageChat);

    const show = (conversationId: string): void => {
      if (!conversationId) return;
      if (state.image === job) {
        const fresh = job.conversationId === null;
        job.conversationId = conversationId;
        if (fresh) void this.titleConversation(conversationId, speaker);
      }
      this.deps.onShowOnPc?.(conversationId);
    };
    void this.runChat(state, text, followUp, link, show, {
      chat: imageChat,
      conversationId: imageConversationId,
    }).then((outcome) => {
      const id = outcome.conversationId ?? job.conversationId;
      if (id) {
        void this.titleConversation(id, speaker);
        this.deps.onShowOnPc?.(id);
      }
      if (state.image !== job) return;
      state.image = null;
      state.chat = imageChat;
      state.conversationId = id;
    });
    const wav = await this.deps.synthesizer.synthesize(SPEAKER_IMAGE_WAIT);
    if (res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': String(wav.byteLength),
      // Pas de suivi : le micro se referme. Une phrase dite pendant l'image ne doit pas partir dans ce tour.
      [SPEAKER_HEADER_CONTINUE]: '0',
      [SPEAKER_HEADER_TRANSCRIPT]: encodeURIComponent(transcript),
    });
    res.end(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength));
  }

  /**
   * Un tour de la session de l'enceinte. Une carte de confirmation est **refusée** tout de suite
   * (aucun écran sur une enceinte) et Jarvis le dira ; `not_addressed` (5.0.62) = rien à dire.
   */
  private runChat(
    state: SpeakerState,
    text: string,
    followUp: boolean,
    link: TurnLink,
    onConversation?: (conversationId: string) => void,
    /** Session déjà choisie (l'image), qui ne doit pas devenir celle des phrases d'après. */
    bound?: { chat: SpeakerChat; conversationId: string | null },
    hooks?: {
      onDelta?: (text: string) => void;
      onUpdate?: (outcome: ChatOutcome, finished: boolean) => void;
    },
  ): Promise<ChatOutcome> {
    const conversationId = bound ? bound.conversationId : state.conversationId;
    const outcome: ChatOutcome = {
      reply: '',
      refused: false,
      notAddressed: false,
      error: null,
      conversationId,
      missionProposal: false,
      tools: [],
      path: 'cerveau',
      firstAt: null,
      fromMessages: '',
    };
    let fromMessages = '';
    const chat = bound?.chat ?? state.chat ?? (state.chat = this.deps.chatFor(state.speaker));
    link.bind(chat);
    const sender: SpeakerSender = {
      isDestroyed: () => link.gone && !link.detached,
      send: (_channel, event) => {
        if (link.gone && !link.detached) return;
        switch (event.type) {
          case 'started':
            outcome.conversationId = event.conversationId;
            onConversation?.(event.conversationId);
            break;
          case 'route':
            outcome.path = chronoPath(event.how, event.model);
            hooks?.onUpdate?.(outcome, false);
            break;
          case 'delta':
            outcome.reply += event.text;
            if (outcome.firstAt === null) outcome.firstAt = this.now();
            hooks?.onUpdate?.(outcome, false);
            // Après une carte refusée, le texte du modèle (« tu as refusé… ») ne s'adresse pas à l'enceinte.
            if (!outcome.refused) hooks?.onDelta?.(event.text);
            break;
          case 'tool_result':
            if (event.status === 'ok') outcome.tools.push(event.toolName);
            hooks?.onUpdate?.(outcome, false);
            break;
          case 'mission_proposal':
            outcome.missionProposal = true;
            hooks?.onUpdate?.(outcome, false);
            break;
          case 'confirm':
            outcome.refused = true;
            chat.respondConfirmation(event.requestId, false);
            hooks?.onUpdate?.(outcome, true);
            break;
          case 'not_addressed':
            outcome.notAddressed = true;
            hooks?.onUpdate?.(outcome, true);
            break;
          case 'error':
            outcome.error = event.message;
            break;
          case 'done':
            fromMessages = lastAssistantText(event.messages);
            if (!outcome.reply.trim() && fromMessages) outcome.reply = fromMessages;
            outcome.fromMessages = fromMessages;
            hooks?.onUpdate?.(outcome, true);
            break;
          default:
            break;
        }
      },
      once: (_event, listener) => {
        link.listeners.add(listener);
      },
      removeListener: (_event, listener) => {
        link.listeners.delete(listener);
      },
    };
    const rulesOnly = followUp && this.deps.rulesOnlyAddressee?.() === true;
    return chat
      .send(sender, {
        conversationId,
        text,
        source: 'voice',
        place: { kind: 'enceinte', name: state.speaker.name },
        ...(followUp ? { followUp: true } : {}),
        ...(rulesOnly ? { rulesOnlyAddressee: true } : {}),
      })
      .then(() => ({ ...outcome, reply: outcome.reply.trim(), fromMessages }))
      .catch((error: unknown) => {
        outcome.error = error instanceof Error ? error.message : String(error);
        hooks?.onUpdate?.(outcome, true);
        return { ...outcome, fromMessages };
      });
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
