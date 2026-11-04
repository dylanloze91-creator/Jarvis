import { timingSafeEqual, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  PHONE_PAIRING_MAX_ATTEMPTS,
  PHONE_PAIRING_TTL_MS,
  phoneChatRequestSchema,
  phoneConfirmRequestSchema,
  phonePairRequestSchema,
  phoneSpeakRequestSchema,
  phoneTeamValidationSchema,
  speechTextForSpeaker,
  type Conversation,
} from '@jarvis/core';
import type { ChatEvent, SendChatInput, TeamValidationInput } from '../../shared/ipc.js';
import { PHONE_CSS, PHONE_HTML, PHONE_JS, PHONE_MANIFEST } from './page.js';
import type { PhoneDevice, PhoneStore } from './store.js';

/**
 * 5.0.63 — serveur du téléphone. Écoute **seulement 127.0.0.1** : c'est `tailscale serve` qui le
 * publie en HTTPS sur le réseau privé de l'utilisateur (jamais sur Internet, jamais sur le Wi-Fi).
 * Chaque appel `/api/*` (sauf le jumelage) exige le jeton d'un appareil relié. Le téléphone a les
 * mêmes pouvoirs que la fenêtre de discussion, avec les mêmes cartes de confirmation.
 */

/** Ce que la session de chat attend de « l'émetteur » (ici, la réponse HTTP en flux). */
export interface PhoneSender {
  isDestroyed(): boolean;
  send(channel: string, event: ChatEvent): void;
  once(event: 'destroyed', listener: () => void): void;
  removeListener(event: 'destroyed', listener: () => void): void;
}

export interface PhoneChat {
  send(sender: PhoneSender, input: SendChatInput): Promise<void>;
  respondConfirmation(requestId: string, approved: boolean): void;
  cancel(): void;
}

export interface PhoneServerDeps {
  store: Pick<PhoneStore, 'verify' | 'addDevice'>;
  chat: PhoneChat;
  validateTeam: (input: TeamValidationInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  conversation: (id: string) => Promise<Conversation | null>;
  icon: () => Promise<Buffer | null>;
  version: () => string;
  /** `piper` si le PC peut servir un WAV Piper, sinon le téléphone garde sa voix. */
  phoneVoice: () => Promise<'piper' | 'device'>;
  /** Synthèse locale pour `/api/speak` (texte déjà nettoyé). */
  synthesizeSpeech?: (text: string) => Promise<Uint8Array>;
  onPaired?: (device: PhoneDevice) => void;
  log?: (line: string) => void;
  now?: () => number;
}

export interface PhonePairing {
  code: string;
  expiresAt: number;
}

const MAX_BODY = 64 * 1024;
const MAX_HISTORY = 80;

const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Hôtes acceptés : la boucle locale et les noms `*.ts.net` de Tailscale. Un autre nom (site piégé
 * qui fait pointer son domaine sur 127.0.0.1) est refusé.
 */
export function allowedPhoneHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(name);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '');
  // JSON obligatoire : une page d'un autre site ne peut pas l'envoyer sans autorisation préalable (CORS).
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'Format attendu : JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Message trop long.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON illisible.');
  }
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header.trim()) : null;
  return match ? match[1]! : null;
}

function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class PhoneServer {
  private server: Server | null = null;
  private pairing: (PhonePairing & { attempts: number }) | null = null;
  private boundPort: number | null = null;

  constructor(private readonly deps: PhoneServerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  get port(): number | null {
    return this.boundPort;
  }

  get running(): boolean {
    return this.server !== null;
  }

  /** Démarre sur 127.0.0.1. Port déjà pris : erreur, rien ne reste ouvert. */
  start(port: number): Promise<void> {
    if (this.server) return Promise.resolve();
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
        else {
          this.deps.log?.(`[téléphone] erreur : ${error instanceof Error ? error.message : String(error)}`);
          sendJson(res, 500, { error: 'Erreur de Jarvis.' });
        }
      });
    });
    // Le flux d'une réponse peut durer plusieurs minutes (outils, confirmation).
    server.requestTimeout = 0;
    server.headersTimeout = 30_000;
    return new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        server.on('error', (error) => this.deps.log?.(`[téléphone] serveur : ${error.message}`));
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
    this.pairing = null;
    if (!server) return;
    this.deps.chat.cancel();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  /** Nouveau code de jumelage (remplace le précédent). */
  startPairing(): PhonePairing {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.pairing = { code, expiresAt: this.now() + PHONE_PAIRING_TTL_MS, attempts: 0 };
    return { code, expiresAt: this.pairing.expiresAt };
  }

  cancelPairing(): void {
    this.pairing = null;
  }

  currentPairing(): PhonePairing | null {
    if (!this.pairing || this.now() > this.pairing.expiresAt) return null;
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!allowedPhoneHost(req.headers.host)) throw new HttpError(421, 'Adresse non reconnue.');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Méthode refusée.');
      return this.serveStatic(path, res);
    }

    if (path === '/api/pair') {
      if (method !== 'POST') throw new HttpError(405, 'Méthode refusée.');
      return this.pair(await readJson(req), res);
    }

    const device = this.deps.store.verify(bearer(req));
    if (!device) throw new HttpError(401, 'Ce téléphone n’est pas relié à Jarvis.');

    if (path === '/api/me' && method === 'GET') {
      const voice = await this.deps.phoneVoice();
      return sendJson(res, 200, { device: device.name, version: this.deps.version(), voice });
    }
    if (path === '/api/conversation' && method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[\w-]{1,80}$/.test(id)) throw new HttpError(400, 'Discussion inconnue.');
      const conversation = await this.deps.conversation(id);
      if (!conversation) throw new HttpError(404, 'Discussion introuvable.');
      const messages = conversation.messages
        .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
        .slice(-MAX_HISTORY)
        .map((message) => ({ role: message.role, content: message.content }));
      return sendJson(res, 200, { id: conversation.id, title: conversation.title, messages });
    }
    if (path === '/api/chat' && method === 'POST') {
      const parsed = phoneChatRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Message vide ou trop long.');
      return this.chat(parsed.data, device, res);
    }
    if (path === '/api/confirm' && method === 'POST') {
      const parsed = phoneConfirmRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Réponse illisible.');
      this.deps.chat.respondConfirmation(parsed.data.requestId, parsed.data.approved);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/cancel' && method === 'POST') {
      await readJson(req);
      this.deps.chat.cancel();
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/validate-team' && method === 'POST') {
      const parsed = phoneTeamValidationSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Validation illisible.');
      const result = await this.deps.validateTeam(parsed.data);
      if (!result.ok) throw new HttpError(400, result.error);
      return sendJson(res, 200, { ok: true });
    }
    if (path === '/api/speak' && method === 'POST') {
      if ((await this.deps.phoneVoice()) !== 'piper') throw new HttpError(503, 'La voix Piper n’est pas disponible sur ce PC.');
      if (!this.deps.synthesizeSpeech) throw new HttpError(503, 'Synthèse vocale indisponible.');
      const parsed = phoneSpeakRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Texte vide ou trop long (1 500 caractères maximum).');
      const spoken = speechTextForSpeaker(parsed.data.text);
      if (!spoken) throw new HttpError(400, 'Rien à dire après nettoyage du texte.');
      const wav = await this.deps.synthesizeSpeech(spoken);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': wav.byteLength,
        'Cache-Control': 'no-store',
      });
      res.end(Buffer.from(wav));
      return;
    }
    throw new HttpError(404, 'Introuvable.');
  }

  private async serveStatic(path: string, res: ServerResponse): Promise<void> {
    const files: Record<string, { type: string; body: string }> = {
      '/': { type: 'text/html; charset=utf-8', body: PHONE_HTML },
      '/index.html': { type: 'text/html; charset=utf-8', body: PHONE_HTML },
      '/app.js': { type: 'text/javascript; charset=utf-8', body: PHONE_JS },
      '/app.css': { type: 'text/css; charset=utf-8', body: PHONE_CSS },
      '/manifest.webmanifest': { type: 'application/manifest+json; charset=utf-8', body: PHONE_MANIFEST },
    };
    const file = files[path];
    if (file) {
      res.writeHead(200, {
        'Content-Type': file.type,
        'Cache-Control': 'no-cache',
        ...(file.type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_POLICY } : {}),
      });
      res.end(file.body);
      return;
    }
    if (path === '/icon.png' || path === '/apple-touch-icon.png') {
      const icon = await this.deps.icon().catch(() => null);
      if (!icon) throw new HttpError(404, 'Introuvable.');
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(icon);
      return;
    }
    throw new HttpError(404, 'Introuvable.');
  }

  private async pair(body: unknown, res: ServerResponse): Promise<void> {
    const parsed = phonePairRequestSchema.safeParse(body);
    const pairing = this.pairing;
    if (!pairing || this.now() > pairing.expiresAt) {
      this.pairing = null;
      throw new HttpError(401, 'Aucun code en cours : sur le PC, Réglages → Téléphone → « Relier un téléphone ».');
    }
    if (!parsed.success || !sameCode(parsed.data.code, pairing.code)) {
      pairing.attempts += 1;
      if (pairing.attempts >= PHONE_PAIRING_MAX_ATTEMPTS) {
        this.pairing = null;
        throw new HttpError(401, 'Code faux, trop d’essais : demande un nouveau code sur le PC.');
      }
      throw new HttpError(401, 'Code faux : vérifie les 6 chiffres affichés sur le PC.');
    }
    this.pairing = null;
    const { device, token } = await this.deps.store.addDevice(parsed.data.name);
    this.deps.log?.(`[téléphone] appareil relié : ${device.name}`);
    this.deps.onPaired?.(device);
    sendJson(res, 200, { token, device: { id: device.id, name: device.name } });
  }

  private async chat(
    input: { text: string; conversationId?: string | null | undefined; source?: 'text' | 'voice' | undefined },
    device: PhoneDevice,
    res: ServerResponse,
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let closed = false;
    const listeners = new Set<() => void>();
    res.on('close', () => {
      closed = true;
      for (const listener of listeners) listener();
      listeners.clear();
    });
    const sender: PhoneSender = {
      isDestroyed: () => closed || res.writableEnded,
      send: (_channel, event) => {
        if (!closed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      },
      once: (_event, listener) => {
        listeners.add(listener);
      },
      removeListener: (_event, listener) => {
        listeners.delete(listener);
      },
    };
    this.deps.log?.(`[téléphone] message de ${device.name} (${input.text.length} caractères)`);
    try {
      await this.deps.chat.send(sender, {
        conversationId: input.conversationId ?? null,
        text: input.text,
        source: input.source ?? 'text',
      });
    } catch (error) {
      sender.send('', { type: 'error', message: error instanceof Error ? error.message : String(error) });
      sender.send('', { type: 'done', conversationId: input.conversationId ?? '', messages: [] });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }
}
