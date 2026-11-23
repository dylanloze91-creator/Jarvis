/**
 * Fausse prise Shelly (2e génération et plus) pour les tests. Aucune adresse réelle, aucun mot de
 * passe réel. Elle vérifie le digest SHA-256 comme la vraie prise.
 */
import { digestResponse, parseDigestChallenge } from './shelly.js';

export class FakeShelly {
  on = true;
  watts = 0;
  temperatureC = 31.5;
  errors: string[] = [];
  /** Vide : pas de mot de passe. */
  password = '';
  realm = 'shellyplugsg3-synthetique-test';
  /** Vrai : la prise ne répond plus. */
  unreachable = false;
  calls: string[] = [];
  challenges = 0;
  redirects: (RequestRedirect | undefined)[] = [];
  private nonce = 'nonce-synthetique-1';

  fetch: typeof fetch = async (input, init) => {
    if (this.unreachable) throw new Error('prise éteinte');
    this.redirects.push(init?.redirect);
    const url = new URL(String(input));
    const uri = `${url.pathname}${url.search}`;
    this.calls.push(uri);
    const method = url.pathname.replace('/rpc/', '');
    if (this.password && method !== 'Shelly.GetDeviceInfo') {
      const header = new Headers(init?.headers).get('Authorization') ?? '';
      if (!(await this.authorized(header, uri))) {
        this.challenges += 1;
        return new Response('401', {
          status: 401,
          headers: {
            'WWW-Authenticate': `Digest qop="auth", realm="${this.realm}", nonce="${this.nonce}", algorithm=SHA-256`,
          },
        });
      }
    }
    if (method === 'Shelly.GetDeviceInfo') {
      return json({ id: this.realm, model: 'S3PL-00112EU', gen: 3, auth_en: Boolean(this.password), auth_domain: this.password ? this.realm : null });
    }
    if (method === 'Switch.GetStatus') {
      return json({
        id: 0,
        source: 'synthetique',
        output: this.on,
        apower: this.on ? this.watts : 0,
        voltage: 231.2,
        current: 0,
        temperature: { tC: this.temperatureC, tF: null },
        errors: this.errors,
      });
    }
    if (method === 'Switch.Set') {
      const wasOn = this.on;
      this.on = url.searchParams.get('on') === 'true';
      return json({ was_on: wasOn });
    }
    return new Response('inconnu', { status: 404 });
  };

  private async authorized(header: string, uri: string): Promise<boolean> {
    const params = parseDigestChallenge(header);
    if (!params || params.username !== 'admin' || params.realm !== this.realm || params.nonce !== this.nonce) return false;
    if (params.uri !== uri || params.algorithm !== 'SHA-256' || params.qop !== 'auth') return false;
    const expected = await digestResponse({
      user: 'admin',
      realm: this.realm,
      password: this.password,
      method: 'GET',
      uri,
      nonce: this.nonce,
      nc: params.nc ?? '',
      cnonce: params.cnonce ?? '',
    });
    return expected === params.response;
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
