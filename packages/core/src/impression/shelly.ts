/**
 * Prise connectée Shelly de 2e génération et plus (Shelly Plug S Gen3), par son interface
 * locale. Le PC lui parle directement, jamais par Moonraker : si l'ordinateur de Klipper ne
 * répond plus, la prise doit rester joignable (cahier `docs/specs/imprimante-surveillance.md`, 2).
 *
 * Documentation officielle (relevée le 19 novembre 2026) :
 * - appels : https://shelly-api-docs.shelly.cloud/gen2/General/RPCChannels
 *   (`GET http://<ip>/rpc/Switch.GetStatus?id=0`, `GET http://<ip>/rpc/Switch.Set?id=0&on=false`)
 * - prise : https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch
 *   (`output`, `apower` en W, `temperature.tC`, `errors` ; `Switch.Set` rend `was_on`)
 * - mot de passe : https://shelly-api-docs.shelly.cloud/gen2/General/Authentication
 *   (digest RFC 7616, SHA-256, utilisateur `admin`, royaume = identifiant de la prise)
 * - fiche : https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Shelly
 *   (`Shelly.GetDeviceInfo`, sans mot de passe : `model`, `gen`, `auth_en`)
 *
 * Réseau local seulement, aucune redirection suivie, chaque appel borné dans le temps. Le mot de
 * passe ne quitte jamais le PC en clair : seule l'empreinte du digest part.
 */
import { checkRoverBaseUrl } from '../rover/url.js';

export class ShellyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellyError';
  }
}

export interface PlugStatus {
  on: boolean;
  /** Puissance mesurée, en watts. */
  watts: number;
  temperatureC: number | null;
  /** Erreurs signalées par la prise : overtemp, overpower, overvoltage, undervoltage. */
  errors: string[];
}

export interface PlugInfo {
  model: string;
  gen: number;
  authEnabled: boolean;
}

export function readPlugStatus(raw: unknown): PlugStatus {
  const value = (raw ?? {}) as {
    output?: unknown;
    apower?: unknown;
    temperature?: { tC?: unknown };
    errors?: unknown;
  };
  if (typeof value.output !== 'boolean') throw new ShellyError('Réponse de la prise illisible (état absent).');
  return {
    on: value.output,
    watts: typeof value.apower === 'number' && Number.isFinite(value.apower) ? value.apower : 0,
    temperatureC: typeof value.temperature?.tC === 'number' ? value.temperature.tC : null,
    errors: Array.isArray(value.errors) ? value.errors.filter((e): e is string => typeof e === 'string') : [],
  };
}

/** Paramètres d'un en-tête `WWW-Authenticate: Digest …`. */
export function parseDigestChallenge(header: string): Record<string, string> | null {
  const match = header.match(/^\s*Digest\s+(.*)$/i);
  if (!match) return null;
  const out: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/g;
  for (let m = re.exec(match[1]!); m; m = re.exec(match[1]!)) out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? '';
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Réponse digest (formules de la documentation Shelly) :
 * ha1 = SHA256(user:realm:password), ha2 = SHA256(method:uri),
 * response = SHA256(ha1:nonce:nc:cnonce:auth:ha2).
 */
export async function digestResponse(input: {
  user: string;
  realm: string;
  password: string;
  method: string;
  uri: string;
  nonce: string;
  nc: string;
  cnonce: string;
}): Promise<string> {
  const ha1 = await sha256Hex(`${input.user}:${input.realm}:${input.password}`);
  const ha2 = await sha256Hex(`${input.method}:${input.uri}`);
  return sha256Hex(`${ha1}:${input.nonce}:${input.nc}:${input.cnonce}:auth:${ha2}`);
}

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class ShellyPlug {
  readonly origin: string;
  private challenge: { realm: string; nonce: string; count: number } | null = null;

  constructor(
    baseUrl: string,
    private readonly password: string = '',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
    private readonly switchId = 0,
  ) {
    const check = checkRoverBaseUrl(baseUrl);
    if (!check.ok) throw new ShellyError(`Adresse de la prise refusée. ${check.reason.replace(/robot/g, 'la prise')}`);
    this.origin = check.origin;
  }

  /** Fiche de la prise (sans mot de passe). */
  async info(): Promise<PlugInfo> {
    const body = (await this.rpc('Shelly.GetDeviceInfo', '')) as { model?: unknown; gen?: unknown; auth_en?: unknown };
    return {
      model: typeof body.model === 'string' ? body.model : 'inconnu',
      gen: typeof body.gen === 'number' ? body.gen : 0,
      authEnabled: body.auth_en === true,
    };
  }

  async status(): Promise<PlugStatus> {
    return readPlugStatus(await this.rpc('Switch.GetStatus', `id=${this.switchId}`));
  }

  /** Coupe la prise, puis relit son état : le résultat dit ce que la prise mesure vraiment. */
  async off(): Promise<PlugStatus> {
    await this.rpc('Switch.Set', `id=${this.switchId}&on=false`);
    return this.status();
  }

  /** Rallume la prise. Seulement après une carte de l'utilisateur, jamais depuis une enceinte (c'est à l'outil de le garantir). */
  async on(): Promise<PlugStatus> {
    await this.rpc('Switch.Set', `id=${this.switchId}&on=true`);
    return this.status();
  }

  private async rpc(method: string, query: string): Promise<unknown> {
    const uri = `/rpc/${method}${query ? `?${query}` : ''}`;
    let response = await this.send(uri, await this.authorization(uri));
    if (response.status === 401) {
      const params = parseDigestChallenge(response.headers.get('www-authenticate') ?? '');
      if (!params?.nonce || !params.realm) throw new ShellyError('La prise demande un mot de passe dans une forme inconnue.');
      if (!this.password) throw new ShellyError('La prise est protégée par un mot de passe : indique-le dans les réglages.');
      this.challenge = { realm: params.realm, nonce: params.nonce, count: 0 };
      response = await this.send(uri, await this.authorization(uri));
      if (response.status === 401) throw new ShellyError('Mot de passe de la prise refusé.');
    }
    if (!response.ok) throw new ShellyError(`La prise a répondu ${response.status}.`);
    return response.json();
  }

  private async authorization(uri: string): Promise<string | null> {
    if (!this.challenge || !this.password) return null;
    this.challenge.count += 1;
    const nc = this.challenge.count.toString(16).padStart(8, '0');
    const cnonce = randomHex(8);
    const response = await digestResponse({
      user: 'admin',
      realm: this.challenge.realm,
      password: this.password,
      method: 'GET',
      uri,
      nonce: this.challenge.nonce,
      nc,
      cnonce,
    });
    return `Digest username="admin", realm="${this.challenge.realm}", nonce="${this.challenge.nonce}", uri="${uri}", algorithm=SHA-256, response="${response}", qop=auth, nc=${nc}, cnonce="${cnonce}"`;
  }

  private async send(uri: string, authorization: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (authorization) headers.Authorization = authorization;
    try {
      return await this.fetchImpl(`${this.origin}${uri}`, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ShellyError(`Prise injoignable (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
}
