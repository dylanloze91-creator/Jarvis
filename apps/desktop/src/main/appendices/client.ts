import {
  appendiceActionSchema,
  appendiceStateSchema,
  checkAppendiceBaseUrl,
  parseAppendiceHello,
  type AppendiceAction,
  type AppendiceHello,
  type AppendiceParams,
  type AppendiceState,
} from '@jarvis/core';

/**
 * Client HTTP d'un appendice qui agit (Jarvis l'appelle), contrat version 1.
 * Réseau local seulement, jeton en `Authorization: Bearer`.
 *
 * Sécurité : une action annulée, sans réponse à temps ou coupée en route envoie
 * `/api/stop` avant de rendre la main, comme pour le robot.
 */
export type AppendiceErrorKind =
  | 'invalid_url'
  | 'unreachable'
  | 'unauthorized'
  | 'refused'
  | 'bad_request'
  | 'timeout'
  | 'cancelled'
  | 'protocol'
  | 'server';

export class AppendiceError extends Error {
  constructor(
    readonly kind: AppendiceErrorKind,
    message: string,
    readonly detail?: string,
    /** Action rendue avec un refus (409), quand l'appendice la donne. */
    readonly action?: AppendiceAction,
  ) {
    super(message);
    this.name = 'AppendiceError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AppendiceClientOptions {
  fetch?: FetchLike;
  /** Délai d'une requête courte (présentation, état, arrêt). */
  requestTimeoutMs?: number;
  /** Délai d'une action attendue jusqu'au bout ; l'appendice borne déjà chaque ordre. */
  actionTimeoutMs?: number;
}

type Auth = true | false | 'optional';

export class AppendiceClient {
  private readonly fetchFn: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly actionTimeoutMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string,
    options: AppendiceClientOptions = {},
  ) {
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.actionTimeoutMs = options.actionTimeoutMs ?? 120_000;
  }

  /** Présentation, avec le jeton : un mauvais jeton se voit dès l'ajout. */
  async hello(): Promise<AppendiceHello> {
    const raw = await this.request('GET', '/api/hello', undefined, { auth: true });
    const check = parseAppendiceHello(raw);
    if (!check.ok) throw new AppendiceError('protocol', check.reason);
    return check.hello;
  }

  async state(signal?: AbortSignal): Promise<AppendiceState> {
    const raw = await this.request('GET', '/api/etat', undefined, { auth: false, signal });
    const parsed = appendiceStateSchema.safeParse(raw);
    if (!parsed.success) throw new AppendiceError('protocol', 'L’appendice donne un état illisible.', parsed.error.issues[0]?.message);
    return parsed.data;
  }

  async action(capacity: string, params: AppendiceParams, signal?: AbortSignal): Promise<AppendiceAction> {
    try {
      const raw = await this.request('POST', `/api/${capacity}`, { ...params, attendre: true }, {
        auth: true,
        signal,
        timeoutMs: this.actionTimeoutMs,
      });
      const parsed = appendiceActionSchema.safeParse((raw as { action?: unknown }).action);
      if (!parsed.success) {
        // Ordre parti, réponse illisible : on ne sait pas ce qu'il fait, donc on l'arrête.
        await this.stop().catch(() => undefined);
        throw new AppendiceError('protocol', 'L’appendice a répondu sans résultat lisible. Un arrêt a été envoyé par précaution.');
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AppendiceError && (error.kind === 'timeout' || error.kind === 'cancelled' || error.kind === 'unreachable')) {
        await this.stop().catch(() => undefined);
      }
      throw error;
    }
  }

  /** Arrêt de l'action en cours. Sans jeton exigé : il doit toujours passer. */
  async stop(): Promise<void> {
    await this.request('POST', '/api/stop', {}, { auth: 'optional' });
  }

  /** `true` verrouille tout de suite ; `false` relâche, et là le jeton est exigé. */
  async emergency(active: boolean): Promise<void> {
    await this.request('POST', '/api/arret_urgence', { actif: active }, { auth: active ? 'optional' : true });
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: { auth: Auth; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown> {
    const check = checkAppendiceBaseUrl(this.baseUrl);
    if (!check.ok) throw new AppendiceError('invalid_url', check.reason);
    const token = this.getToken().trim();
    if (options.auth === true && !token) {
      throw new AppendiceError('unauthorized', 'Le jeton de cet appendice manque : redonne-le dans Réglages → Appendices.');
    }
    if (options.signal?.aborted) throw new AppendiceError('cancelled', 'Ordre annulé avant l’envoi.');

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
    if (options.auth !== false && token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(`${check.origin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error',
      });
      text = await response.text();
    } catch (error) {
      if (timedOut) throw new AppendiceError('timeout', 'L’appendice n’a pas répondu à temps.', messageOf(error));
      if (options.signal?.aborted) throw new AppendiceError('cancelled', 'Ordre annulé.', messageOf(error));
      throw new AppendiceError(
        'unreachable',
        'Impossible de joindre l’appendice. Vérifie qu’il est allumé et sur le même réseau.',
        messageOf(error),
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (response.ok) return payload;

    // Texte venu de l'appendice : une ligne, borné, avant d'entrer dans une phrase.
    const said =
      typeof payload.erreur === 'string' && payload.erreur.trim()
        ? payload.erreur.replace(/\s+/g, ' ').replace(/[^\P{C}]/gu, '').trim().slice(0, 200)
        : `HTTP ${response.status}`;
    if (response.status === 401) throw new AppendiceError('unauthorized', 'L’appendice refuse le jeton.', said);
    if (response.status === 409) {
      const action = appendiceActionSchema.safeParse(payload.action);
      throw new AppendiceError('refused', said, `HTTP 409`, action.success ? action.data : undefined);
    }
    if (response.status === 400 || response.status === 404) throw new AppendiceError('bad_request', said, `HTTP ${response.status}`);
    throw new AppendiceError('server', `L’appendice a répondu : ${said}`, `HTTP ${response.status}`);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
