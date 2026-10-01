import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GOOGLE_OAUTH_PORT, GOOGLE_REDIRECT_PATH, parseGrantedScopes } from '@jarvis/core';
import { GoogleError, reconsentRequired } from './errors.js';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const AUTH_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleOAuthDeps {
  fetch: typeof fetch;
  /** Ouvre le navigateur système (jamais une fenêtre Electron). */
  openExternal: (url: string) => Promise<unknown>;
  port?: number;
  authTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes: string[];
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  challenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(' '),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    // Garantit un jeton de rafraîchissement, même après une première connexion.
    prompt: 'consent',
  }).toString();
  return url.toString();
}

const PAGE_STYLE =
  'font-family:Segoe UI,system-ui,sans-serif;background:#070b14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0';

function page(title: string, text: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Jarvis — Google</title></head><body style="${PAGE_STYLE}"><main style="max-width:28rem;text-align:center"><h1 style="font-size:1.25rem;color:#67e8ff">${title}</h1><p>${text}</p></main></body></html>`;
}

interface PendingAuthorization {
  cancel: () => void;
}

/**
 * Autorisation OAuth 2.0 « application de bureau » : PKCE S256, retour sur
 * l'adresse de bouclage 127.0.0.1 (port 53125, ou un port libre si 53125 est
 * pris — Google l'accepte pour un client de bureau), consentement dans le
 * navigateur système.
 */
export class GoogleOAuth {
  private pending: PendingAuthorization | null = null;

  constructor(private readonly deps: GoogleOAuthDeps) {}

  isAuthorizing(): boolean {
    return this.pending !== null;
  }

  cancel(): void {
    this.pending?.cancel();
  }

  async authorize(config: OAuthClientConfig, scopes: string[]): Promise<GoogleTokenResponse> {
    if (this.pending) {
      throw new GoogleError(
        'auth_in_progress',
        'Une connexion Google est déjà en cours : termine-la dans le navigateur, ou clique sur « Annuler ».',
      );
    }
    const { verifier, challenge } = createPkcePair();
    const state = randomBytes(24).toString('base64url');

    let cancel: () => void = () => undefined;
    this.pending = { cancel: () => cancel() };
    try {
      const listener = await this.listen();
      const redirectUri = `http://127.0.0.1:${listener.port}${GOOGLE_REDIRECT_PATH}`;
      const codePromise = this.waitForCode(listener.server, state, (abort) => {
        cancel = abort;
      });
      try {
        await this.deps.openExternal(
          buildAuthorizationUrl({ clientId: config.clientId, redirectUri, scopes, state, challenge }),
        );
      } catch (error) {
        cancel();
        await codePromise.catch(() => undefined);
        throw new GoogleError(
          'auth_cancelled',
          "Impossible d'ouvrir le navigateur pour la connexion Google.",
          { technicalDetail: error instanceof Error ? error.message : String(error) },
        );
      }
      const code = await codePromise;
      return await this.exchange(config, code, verifier, redirectUri);
    } finally {
      this.pending = null;
    }
  }

  async refresh(config: OAuthClientConfig, refreshToken: string): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
    return this.tokenRequest(body, 'refresh');
  }

  /** Révoque côté Google. Vrai si Google confirme, ou si le jeton n'était déjà plus valable. */
  async revoke(token: string): Promise<boolean> {
    const response = await this.post(GOOGLE_REVOKE_URL, new URLSearchParams({ token }));
    if (response.ok) return true;
    const error = await readOAuthError(response);
    return response.status === 400 && error.error === 'invalid_token';
  }

  private async exchange(
    config: OAuthClientConfig,
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
    return this.tokenRequest(body, 'exchange');
  }

  private async tokenRequest(body: URLSearchParams, step: 'exchange' | 'refresh'): Promise<GoogleTokenResponse> {
    const response = await this.post(GOOGLE_TOKEN_URL, body);
    if (!response.ok) {
      const error = await readOAuthError(response);
      throw describeTokenError(response.status, error, step);
    }
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    };
    if (typeof data.access_token !== 'string' || !data.access_token) {
      throw new GoogleError('server', "Google n'a pas renvoyé de jeton d'accès. Réessaie dans un instant.", {
        technicalDetail: `réponse ${step} sans access_token`,
      });
    }
    return {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined,
      expiresIn: typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600,
      scopes: parseGrantedScopes(typeof data.scope === 'string' ? data.scope : ''),
    };
  }

  private async post(url: string, body: URLSearchParams): Promise<Response> {
    try {
      return await this.deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(this.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new GoogleError(
        timeout ? 'timeout' : 'network',
        timeout
          ? "Google n'a pas répondu à temps. Vérifie la connexion Internet et réessaie."
          : 'Impossible de joindre Google. Vérifie la connexion Internet et réessaie.',
        { technicalDetail: `${new URL(url).host}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}` },
      );
    }
  }

  private listen(): Promise<{ server: Server; port: number }> {
    const preferred = this.deps.port ?? GOOGLE_OAUTH_PORT;
    const attempt = (port: number): Promise<{ server: Server; port: number }> =>
      new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve({ server, port: (server.address() as AddressInfo).port });
        });
      });
    return attempt(preferred)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE' || preferred === 0) throw error;
        return attempt(0);
      })
      .catch((error: unknown) => {
        throw new GoogleError(
          'network',
          "Impossible d'ouvrir l'adresse locale de retour (127.0.0.1) pour la connexion Google. Un pare-feu bloque peut-être Jarvis.",
          { technicalDetail: error instanceof Error ? error.message : String(error) },
        );
      });
  }

  private waitForCode(server: Server, expectedState: string, onCancel: (abort: () => void) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: GoogleError | null, code?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        // Laisser partir la page « tu peux fermer cet onglet » avant de couper.
        setTimeout(() => server.closeAllConnections?.(), 2_000).unref();
        if (error) reject(error);
        else resolve(code ?? '');
      };

      const timer = setTimeout(
        () =>
          finish(
            new GoogleError(
              'auth_timeout',
              "Pas de réponse de Google en 5 minutes. Si Google affichait « Accès bloqué » ou « access_denied », ajoute ton adresse Gmail dans Google Auth Platform → Audience → Utilisateurs test. Si c'était « redirect_uri_mismatch », le client n'est pas de type « Application de bureau ». Puis relance « Se connecter ».",
            ),
          ),
        this.deps.authTimeoutMs ?? AUTH_TIMEOUT_MS,
      );

      onCancel(() =>
        finish(new GoogleError('auth_cancelled', 'Connexion Google annulée. Rien n’a été enregistré.')),
      );

      server.on('request', (request: IncomingMessage, response: ServerResponse) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== GOOGLE_REDIRECT_PATH) {
          response.writeHead(404).end();
          return;
        }
        const reply = (status: number, title: string, text: string): void => {
          response
            .writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' })
            .end(page(title, text));
        };
        if (url.searchParams.get('state') !== expectedState) {
          reply(400, 'Lien invalide', 'Cette réponse ne correspond pas à la connexion lancée par Jarvis. Relance « Se connecter ».');
          return;
        }
        const error = url.searchParams.get('error');
        if (error) {
          reply(200, 'Connexion annulée', 'Jarvis n’a reçu aucun accès. Tu peux fermer cet onglet.');
          finish(
            new GoogleError(
              'auth_cancelled',
              error === 'access_denied'
                ? "Connexion refusée dans Google (bouton « Annuler », ou ton adresse n'est pas dans les utilisateurs test). Rien n'a été enregistré."
                : `Google a refusé la connexion (${error}). Rien n'a été enregistré.`,
              { technicalDetail: `callback error=${error}` },
            ),
          );
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          reply(400, 'Réponse incomplète', 'Google n’a pas transmis de code. Relance « Se connecter ».');
          return;
        }
        reply(200, 'Google est connecté à Jarvis', 'Tu peux fermer cet onglet et revenir à Jarvis.');
        finish(null, code);
      });
    });
  }
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
}

async function readOAuthError(response: Response): Promise<OAuthErrorBody> {
  try {
    const value = (await response.json()) as OAuthErrorBody;
    return typeof value === 'object' && value ? value : {};
  } catch {
    return {};
  }
}

function describeTokenError(status: number, body: OAuthErrorBody, step: 'exchange' | 'refresh'): GoogleError {
  const detail = `token ${step} HTTP ${status}: ${body.error ?? '?'} ${body.error_description ?? ''}`.trim();
  if (body.error === 'invalid_request' && /client_secret/i.test(body.error_description ?? '')) {
    return new GoogleError(
      'client_secret_missing',
      "Google demande le secret du client. Colle-le dans Réglages → Google. Il ne s'affiche qu'à la création du client ; s'il est perdu, ajoute un secret dans Google Auth Platform → Clients → ton client.",
      { technicalDetail: detail, status },
    );
  }
  if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
    return new GoogleError(
      'invalid_client',
      "Google ne reconnaît pas cet identifiant client ou ce secret. Vérifie qu'ils viennent du même client « Application de bureau », puis reconnecte-toi.",
      { technicalDetail: detail, status },
    );
  }
  if (body.error === 'invalid_grant') {
    if (step === 'refresh') return reconsentRequired(detail);
    return new GoogleError('auth_cancelled', 'Le code de Google a expiré avant la fin de la connexion. Relance « Se connecter ».', {
      technicalDetail: detail,
      status,
    });
  }
  if (status >= 500) {
    return new GoogleError('server', 'Le service de connexion Google est indisponible. Réessaie dans un instant.', {
      technicalDetail: detail,
      status,
    });
  }
  return new GoogleError('invalid_request', `Google a refusé la connexion (${body.error ?? `HTTP ${status}`}).`, {
    technicalDetail: detail,
    status,
  });
}
