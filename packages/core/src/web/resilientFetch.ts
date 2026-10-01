import { classifyThrownError, type ToolOutcomeKind } from '../tools/outcome.js';

export const RETRYABLE_HTTP_STATUSES = [408, 429, 500, 502, 503, 504] as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_REDIRECTS = 5;

export function isRetryableHttpStatus(status: number): boolean {
  return (RETRYABLE_HTTP_STATUSES as readonly number[]).includes(status);
}

/** Honore Retry-After (secondes), borné, sinon un délai exponentiel. */
export function retryAfterMs(header: string | null, attempt: number, capMs = 8_000): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(capMs, Math.round(seconds * 1000));
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.min(capMs, Math.max(0, date - Date.now()));
    }
  }
  return Math.min(capMs, 400 * 2 ** attempt);
}

export function frenchHttpMessage(status: number, subject: string): string {
  if (status === 408) return `${subject} n'a pas répondu à temps. Je peux réessayer.`;
  if (status === 429) return `${subject} limite les requêtes pour le moment. Je peux réessayer.`;
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return `${subject} est temporairement indisponible. Je peux réessayer.`;
  }
  return `${subject} a répondu avec une erreur (HTTP ${status}).`;
}

export function httpOutcome(status: number): ToolOutcomeKind {
  if (status === 408) return 'timeout';
  if (isRetryableHttpStatus(status)) return 'recoverable';
  return 'definitive';
}

export interface FetchTextSuccess {
  ok: true;
  url: string;
  status: number;
  text: string;
  contentType: string;
}

export interface FetchTextFailure {
  ok: false;
  url: string;
  outcome: ToolOutcomeKind;
  userMessage: string;
  technicalDetail: string;
  status?: number;
}

export type FetchTextResult = FetchTextSuccess | FetchTextFailure;

export interface FetchTextOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  guard?: (url: string) => Promise<{ allowed: boolean; reason?: string }>;
  readLimit?: number;
}

/**
 * GET texte public : délai AbortController, statuts 408/429/5xx,
 * Retry-After, retries bornés, redirections bornées.
 */
export async function fetchPublicText(rawUrl: string, options: FetchTextOptions = {}): Promise<FetchTextResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let current = rawUrl;

  try {
    current = new URL(rawUrl).toString();
  } catch {
    return {
      ok: false,
      url: rawUrl,
      outcome: 'definitive',
      userMessage: `Adresse invalide : « ${rawUrl} ».`,
      technicalDetail: 'invalid URL',
    };
  }

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const guard = options.guard ? await options.guard(current) : { allowed: true as const };
    if (!guard.allowed) {
      return {
        ok: false,
        url: current,
        outcome: 'definitive',
        userMessage: `Adresse refusée : ${guard.reason ?? 'non autorisée.'}`,
        technicalDetail: guard.reason ?? 'guard',
      };
    }

    let response: Response | null = null;
    let lastFailure: FetchTextFailure | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (options.signal?.aborted) {
        return {
          ok: false,
          url: current,
          outcome: 'cancelled',
          userMessage: "L'opération a été annulée.",
          technicalDetail: 'AbortSignal',
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
      const onAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        response = await fetchImpl(current, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            accept: 'text/html,application/xhtml+xml,text/plain',
            'user-agent': 'Mozilla/5.0 (compatible; Jarvis/0.4.17; assistant personnel)',
            ...options.headers,
          },
        });
      } catch (error) {
        const classified = classifyThrownError(error);
        lastFailure = {
          ok: false,
          url: current,
          outcome: classified.outcome,
          userMessage:
            classified.outcome === 'timeout'
              ? `La page « ${current} » n'a pas répondu à temps. Je peux réessayer.`
              : classified.userMessage,
          technicalDetail: classified.technicalDetail,
        };
        if (classified.outcome !== 'recoverable' && classified.outcome !== 'timeout') {
          return lastFailure;
        }
        if (attempt >= maxRetries) return lastFailure;
        await delay(retryAfterMs(null, attempt), options.signal);
        continue;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }

      if (response && isRetryableHttpStatus(response.status) && attempt < maxRetries) {
        const wait = retryAfterMs(response.headers.get('retry-after'), attempt);
        await response.body?.cancel().catch(() => undefined);
        await delay(wait, options.signal);
        response = null;
        continue;
      }
      break;
    }

    if (!response) {
      return (
        lastFailure ?? {
          ok: false,
          url: current,
          outcome: 'recoverable',
          userMessage: `La page « ${current} » n'a pas répondu. Je peux réessayer.`,
          technicalDetail: 'no response',
        }
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          ok: false,
          url: current,
          outcome: 'definitive',
          userMessage: `Redirection sans destination reçue pour « ${current} ».`,
          technicalDetail: `HTTP ${response.status}`,
          status: response.status,
        };
      }
      current = new URL(location, current).toString();
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        url: current,
        status: response.status,
        outcome: httpOutcome(response.status),
        userMessage: frenchHttpMessage(response.status, 'La page'),
        technicalDetail: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const textual =
      contentType === '' || contentType.includes('text/') || contentType.includes('application/xhtml');
    if (!textual) {
      return {
        ok: false,
        url: current,
        status: response.status,
        outcome: 'definitive',
        userMessage: `Type de contenu non pris en charge (${contentType.split(';')[0] || 'inconnu'}). Seules les pages HTML ou texte sont lues.`,
        technicalDetail: contentType,
      };
    }

    const text = await readLimited(response, options.readLimit ?? 2_000_000);
    return { ok: true, url: current, status: response.status, text, contentType };
  }

  return {
    ok: false,
    url: rawUrl,
    outcome: 'definitive',
    userMessage: `Trop de redirections en partant de « ${rawUrl} ».`,
    technicalDetail: 'redirect limit',
  };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  text += decoder.decode();
  return text;
}
