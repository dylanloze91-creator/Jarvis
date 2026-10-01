import { GOOGLE_SERVICE_LABELS, redactSecrets, type GoogleService } from '@jarvis/core';
import { GoogleError, apiDisabled, rateLimited, reconsentRequired, scopeMissing } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type QueryValue = string | number | boolean | undefined | null | readonly string[];

export interface GoogleRequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Corps attendu en texte (export Drive, téléchargement). */
  text?: boolean;
}

export interface GoogleApiDeps {
  fetch: typeof fetch;
  getAccessToken: (force?: boolean) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  /** Au-delà, un 429 n'est pas réessayé : l'utilisateur reçoit le délai. */
  maxRetryWaitMs?: number;
  requestTimeoutMs?: number;
}

const MAX_RETRIES = 2;
const DEFAULT_MAX_RETRY_WAIT_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 25_000;

const RATE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'RATE_LIMIT_EXCEEDED',
  'quotaExceeded',
  'dailyLimitExceeded',
]);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
const DISABLED_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);

interface GoogleErrorBody {
  code?: number;
  message: string;
  status?: string;
  reasons: string[];
}

export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

function parseErrorBody(text: string): GoogleErrorBody {
  try {
    const value = JSON.parse(text) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      };
    };
    const error = value.error ?? {};
    const reasons = [
      ...(error.errors ?? []).map((entry) => entry.reason ?? ''),
      ...(error.details ?? []).map((entry) => entry.reason ?? ''),
    ].filter(Boolean);
    return { code: error.code, message: error.message ?? '', status: error.status, reasons };
  } catch {
    return { message: text.slice(0, 300), reasons: [] };
  }
}

function buildUrl(url: string, query: GoogleRequestOptions['query']): string {
  if (!query) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) target.searchParams.append(key, item);
    } else {
      target.searchParams.set(key, String(value));
    }
  }
  return target.toString();
}

/**
 * Appels REST Google authentifiés. Un seul rafraîchissement après un 401
 * (sinon reconnexion), 429 suivi du `Retry-After` quand l'attente est
 * courte, et chaque refus traduit en phrase française typée.
 */
export class GoogleApiClient {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: GoogleApiDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async json<T>(service: GoogleService, url: string, options: GoogleRequestOptions = {}): Promise<T> {
    return (await this.send(service, url, options)) as T;
  }

  async text(service: GoogleService, url: string, options: GoogleRequestOptions = {}): Promise<string> {
    return String((await this.send(service, url, { ...options, text: true })) ?? '');
  }

  private async send(service: GoogleService, url: string, options: GoogleRequestOptions): Promise<unknown> {
    const method = options.method ?? 'GET';
    const target = buildUrl(url, options.query);
    const host = new URL(target).host;
    let token = await this.deps.getAccessToken();
    let refreshed = false;
    let retries = 0;

    for (;;) {
      let response: Response;
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: options.text ? '*/*' : 'application/json' };
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';
        response = await this.deps.fetch(target, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new GoogleError(
          timeout ? 'timeout' : 'network',
          timeout
            ? `${GOOGLE_SERVICE_LABELS[service]} n'a pas répondu à temps. Rien n'a été confirmé.`
            : `Impossible de joindre ${GOOGLE_SERVICE_LABELS[service]}. Vérifie la connexion Internet. Rien n'a été confirmé.`,
          { service, technicalDetail: `${method} ${host}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}` },
        );
      }

      if (response.status === 401) {
        await response.text().catch(() => '');
        if (refreshed) throw reconsentRequired(`${method} ${host}: 401 après rafraîchissement`);
        refreshed = true;
        token = await this.deps.getAccessToken(true);
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return undefined;
        const body = await response.text();
        if (options.text) return body;
        if (!body) return undefined;
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw new GoogleError('server', `${GOOGLE_SERVICE_LABELS[service]} a renvoyé une réponse illisible. Rien n'a été confirmé.`, {
            service,
            technicalDetail: `${method} ${host}: JSON invalide`,
          });
        }
      }

      const bodyText = await response.text().catch(() => '');
      const parsed = parseErrorBody(bodyText);
      const detail = redactSecrets(
        `${method} ${host}${new URL(target).pathname} HTTP ${response.status} ${parsed.status ?? ''} [${parsed.reasons.join(',')}] ${parsed.message}`.trim(),
      );
      const isRate =
        response.status === 429 ||
        (response.status === 403 && parsed.reasons.some((reason) => RATE_REASONS.has(reason))) ||
        (response.status === 503 && method === 'GET');

      if (isRate) {
        const wait = parseRetryAfter(response.headers.get('retry-after')) ?? 1_000 * 2 ** retries;
        if (retries < MAX_RETRIES && wait <= (this.deps.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS)) {
          retries += 1;
          await this.sleep(wait);
          continue;
        }
        if (response.status === 503) {
          throw new GoogleError('server', `${GOOGLE_SERVICE_LABELS[service]} est momentanément indisponible. Réessaie dans un instant.`, {
            service,
            technicalDetail: detail,
            status: 503,
          });
        }
        throw rateLimited(service, wait / 1000, detail);
      }

      throw mapHttpError(service, method, response.status, parsed, detail);
    }
  }
}

function mapHttpError(
  service: GoogleService,
  method: HttpMethod,
  status: number,
  body: GoogleErrorBody,
  detail: string,
): GoogleError {
  const label = GOOGLE_SERVICE_LABELS[service];
  const write = method !== 'GET';
  if (status === 403) {
    if (body.reasons.some((reason) => SCOPE_REASONS.has(reason)) || /insufficient (authentication )?scopes?/i.test(body.message)) {
      return scopeMissing(service, write, detail);
    }
    if (body.reasons.some((reason) => DISABLED_REASONS.has(reason)) || /has not been used in project|is disabled/i.test(body.message)) {
      return apiDisabled(service, detail);
    }
    return new GoogleError(
      'forbidden',
      `${label} refuse l'accès à cet élément (il n'est peut-être pas à toi ou pas partagé avec ton compte). Rien n'a été fait.`,
      { service, technicalDetail: detail, status },
    );
  }
  if (status === 404 || status === 410) {
    return new GoogleError(
      'not_found',
      `Introuvable dans ${label} : l'identifiant est peut-être faux, ou l'élément a été supprimé. Rien n'a été fait.`,
      { service, technicalDetail: detail, status },
    );
  }
  if (status === 400 || status === 409 || status === 412 || status === 422) {
    const reason = body.message ? ` (${redactSecrets(body.message).slice(0, 160)})` : '';
    return new GoogleError('invalid_request', `${label} a refusé la demande${reason}. Rien n'a été fait.`, {
      service,
      technicalDetail: detail,
      status,
    });
  }
  return new GoogleError(
    'server',
    `${label} est momentanément indisponible (erreur ${status}). Rien n'a été confirmé : réessaie dans un instant.`,
    { service, technicalDetail: detail, status },
  );
}
