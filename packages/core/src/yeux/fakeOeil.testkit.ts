/**
 * Faux œil réseau pour les essais : un `fetch` qui suit le contrat `reseau`
 * (`GET /api/oeil/hello`, `GET /api/oeil/photo` avec jeton Bearer) et rien d'autre.
 * Note chaque requête reçue. Le rover et le hub suivront le même contrat avec leur matériel.
 * Aucune adresse réelle : `http://faux-oeil.local:8770` par défaut.
 */
export const FAUX_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(2500).fill(5), 0xff, 0xd9]);

export class FakeOeil {
  readonly requetes: { methode: string; chemin: string; autorisation: string }[] = [];
  /** Ce que la caméra renvoie : une image (défaut), un 503, une page HTML, ou rien (délai). */
  mode: 'image' | 'muet' | 'erreur' | 'html' | 'redirection' = 'image';
  /** Témoin lumineux : nombre de prises (il s'allume pendant chacune). */
  temoinAllume = 0;

  constructor(
    readonly url = 'http://faux-oeil.local:8770',
    private readonly jeton = 'jeton-oeil',
    private readonly nom = 'Faux œil',
  ) {}

  readonly fetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const chemin = new URL(request.url).pathname;
    const autorisation = request.headers.get('authorization') ?? '';
    this.requetes.push({ methode: request.method, chemin, autorisation });
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    if (autorisation !== `Bearer ${this.jeton}`) return new Response(null, { status: 401 });
    if (chemin === '/api/oeil/hello') return Response.json({ nom: this.nom, version: '1.0.0' });
    if (chemin !== '/api/oeil/photo') return new Response(null, { status: 404 });
    if (this.mode === 'muet') {
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(request.signal.reason ?? new Error('timeout')));
      });
    }
    if (this.mode === 'erreur') return new Response(null, { status: 503 });
    if (this.mode === 'redirection') {
      if (init?.redirect === 'error') throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      return new Response(null, { status: 302, headers: { location: '/ailleurs' } });
    }
    this.temoinAllume += 1;
    if (this.mode === 'html') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    return new Response(FAUX_JPEG, { headers: { 'content-type': 'image/jpeg' } });
  };
}
