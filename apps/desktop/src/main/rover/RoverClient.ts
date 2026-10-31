import { checkRoverBaseUrl, type RoverMovementState, type RoverState, type Settings } from '@jarvis/core';

/**
 * Client HTTP du service du robot (`jarvis_rover` sur le Raspberry Pi).
 * Adresse et jeton viennent des réglages (`settings.json`), jamais de
 * `process.env`. Réseau local seulement (`checkRoverBaseUrl`).
 *
 * Sécurité : si un mouvement est annulé côté Jarvis (tour de chat arrêté,
 * délai dépassé, coupure), le client envoie `/api/stop` avant de rendre la main.
 */

export type RoverErrorKind =
  | 'not_configured'
  | 'invalid_url'
  | 'unreachable'
  | 'unauthorized'
  | 'refused'
  | 'bad_request'
  | 'timeout'
  | 'cancelled'
  | 'server';

export class RoverError extends Error {
  constructor(
    readonly kind: RoverErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'RoverError';
  }
}

export type RoverCredentials = { baseUrl?: string; token?: string };

export type RoverConnectionStatus = {
  configured: boolean;
  reachable: boolean;
  authorized: boolean;
  mode?: string;
  version?: string;
  error?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RoverClientOptions {
  fetch?: FetchLike;
  /** Délai d'une requête courte (état, stop). */
  requestTimeoutMs?: number;
  /** Délai d'un mouvement attendu jusqu'au bout (le service borne déjà chaque ordre). */
  movementTimeoutMs?: number;
}

export interface MoveRequest {
  distanceM: number;
  speedMS?: number;
}

export interface TurnRequest {
  angleDeg: number;
  reverse?: boolean;
  speedMS?: number;
}

const NOT_CONFIGURED =
  'Le robot n’est pas réglé. Dans Réglages → Robot, indique son adresse (par exemple http://jarvis-rover.local:8765) et son jeton.';

export class RoverClient {
  private readonly fetchFn: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly movementTimeoutMs: number;

  constructor(
    private readonly getSettings: () => Settings,
    options: RoverClientOptions = {},
  ) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.movementTimeoutMs = options.movementTimeoutMs ?? 240_000;
  }

  /** Vrai dès qu'une adresse valide est réglée : les outils `rover_*` entrent alors au catalogue. */
  isConfigured(): boolean {
    const url = (this.getSettings().roverBaseUrl ?? '').trim();
    return url !== '' && checkRoverBaseUrl(url).ok;
  }

  async connectionStatus(override?: RoverCredentials): Promise<RoverConnectionStatus> {
    const { baseUrl, token } = this.credentials(override);
    if (!baseUrl) return { configured: false, reachable: false, authorized: false, error: NOT_CONFIGURED };
    let health: { version?: string; mode?: string };
    try {
      health = await this.request<{ version?: string; mode?: string }>('GET', '/api/sante', undefined, {
        override,
        auth: false,
      });
    } catch (error) {
      return { configured: true, reachable: false, authorized: false, error: messageOf(error) };
    }
    const base = { configured: true, reachable: true, mode: health.mode, version: health.version };
    if (!token) {
      return { ...base, authorized: false, error: 'Robot joint, mais le jeton manque : colle celui affiché par l’installation.' };
    }
    try {
      await this.request('GET', '/api/verifier', undefined, { override });
      return { ...base, authorized: true };
    } catch (error) {
      return { ...base, authorized: false, error: messageOf(error) };
    }
  }

  state(signal?: AbortSignal): Promise<RoverState> {
    return this.request<RoverState>('GET', '/api/etat', undefined, { signal });
  }

  async move(input: MoveRequest, signal?: AbortSignal): Promise<RoverMovementState> {
    const body: Record<string, unknown> = { distance_m: input.distanceM, attendre: true };
    if (input.speedMS !== undefined) body.vitesse_m_s = input.speedMS;
    return this.movement('/api/avancer', body, signal);
  }

  async turn(input: TurnRequest, signal?: AbortSignal): Promise<RoverMovementState> {
    const body: Record<string, unknown> = {
      angle_deg: input.angleDeg,
      marche_arriere: input.reverse === true,
      attendre: true,
    };
    if (input.speedMS !== undefined) body.vitesse_m_s = input.speedMS;
    return this.movement('/api/tourner', body, signal);
  }

  /** Arrêt en douceur. Ne demande pas de jeton côté robot : il doit toujours passer. */
  async stop(): Promise<RoverState | null> {
    const reply = await this.request<{ etat?: RoverState }>('POST', '/api/stop', {}, { auth: 'optional' });
    return reply.etat ?? null;
  }

  /** `active: true` coupe les moteurs tout de suite ; `false` relâche (jeton exigé par le robot). */
  async emergency(active: boolean): Promise<void> {
    await this.request('POST', '/api/arret_urgence', { actif: active }, { auth: active ? 'optional' : true });
  }

  private async movement(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<RoverMovementState> {
    try {
      const reply = await this.request<{ mouvement: RoverMovementState }>('POST', path, body, {
        signal,
        timeoutMs: this.movementTimeoutMs,
      });
      return reply.mouvement;
    } catch (error) {
      // Ordre parti mais réponse perdue : on ne laisse jamais le robot rouler sans surveillance.
      if (error instanceof RoverError && (error.kind === 'timeout' || error.kind === 'cancelled' || error.kind === 'unreachable')) {
        await this.stop().catch(() => undefined);
      }
      throw error;
    }
  }

  private credentials(override?: RoverCredentials): { baseUrl: string; token: string } {
    const settings = this.getSettings();
    return {
      baseUrl: (override?.baseUrl ?? settings.roverBaseUrl ?? '').trim(),
      token: (override?.token ?? settings.roverToken ?? '').trim(),
    };
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: {
      override?: RoverCredentials;
      signal?: AbortSignal;
      timeoutMs?: number;
      /** true : jeton exigé ; 'optional' : envoyé s'il existe ; false : jamais envoyé. */
      auth?: boolean | 'optional';
    } = {},
  ): Promise<T> {
    const { baseUrl, token } = this.credentials(options.override);
    if (!baseUrl) throw new RoverError('not_configured', NOT_CONFIGURED);
    const check = checkRoverBaseUrl(baseUrl);
    if (!check.ok) throw new RoverError('invalid_url', check.reason);
    const auth = options.auth ?? true;
    if (auth === true && !token) {
      throw new RoverError('unauthorized', 'Le jeton du robot manque : colle-le dans Réglages → Robot.');
    }

    if (options.signal?.aborted) throw new RoverError('cancelled', 'Ordre annulé avant l’envoi.');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? this.requestTimeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth !== false && token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(`${check.origin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (timedOut) throw new RoverError('timeout', 'Le robot n’a pas répondu à temps.', messageOf(error));
      if (options.signal?.aborted) throw new RoverError('cancelled', 'Ordre annulé.', messageOf(error));
      throw new RoverError(
        'unreachable',
        'Impossible de joindre le robot. Vérifie qu’il est allumé, sur le même réseau Wi-Fi, et que son adresse est la bonne.',
        messageOf(error),
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }
    if (response.ok) return payload as T;

    const said = typeof payload.erreur === 'string' ? payload.erreur : `HTTP ${response.status}`;
    if (response.status === 401) throw new RoverError('unauthorized', 'Jeton du robot refusé : vérifie-le dans Réglages → Robot.', said);
    if (response.status === 409) throw new RoverError('refused', said);
    if (response.status === 400) throw new RoverError('bad_request', said);
    throw new RoverError('server', `Le robot a répondu : ${said}`, `HTTP ${response.status}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
