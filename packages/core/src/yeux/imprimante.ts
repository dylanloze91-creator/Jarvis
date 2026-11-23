/**
 * Les yeux de Jarvis, étape 1 : la caméra de l'imprimante, en LECTURE SEULE.
 * Cahier : `docs/specs/yeux-etape-1.md`.
 *
 * - liste des caméras : `GET /server/webcams/list` (Moonraker) ;
 * - image : `snapshot_url` de la caméra (relative : même machine que Moonraker, port 80) ;
 * - état : `GET /printer/objects/query` ; file d'attente : `GET /server/job_queue/status`.
 *
 * Aucune autre méthode que GET ne peut partir d'ici : `lectureSeule` refuse tout le reste avant
 * même l'appel réseau. Réseau local seulement (`checkRoverBaseUrl`), jamais de redirection suivie,
 * chaque appel borné (5 s), image de 5 Mo au plus, `image/jpeg` ou `image/png` seulement.
 * L'image reste en mémoire : rien n'est écrit sur le disque ici.
 */
import { readWatchStatus, snapshotAddress, SNAPSHOT_MAX_BYTES, type Webcam } from '../impression/printerWatch.js';
import type { KlippyState } from '../impression/surveillance.js';
import type { PrintStatus } from '../quotidien/moonraker.js';
import { checkRoverBaseUrl } from '../rover/url.js';

export const YEUX_DELAI_MS = 5_000;
export const YEUX_IMAGE_MAX = SNAPSHOT_MAX_BYTES;

export type TypeImage = 'image/jpeg' | 'image/png';

export interface PhotoYeux {
  octets: Uint8Array;
  type: TypeImage;
  /** Heure de la prise (millisecondes depuis 1970), toujours montrée avec l'image. */
  prisA: number;
  taille: number;
  camera: string;
}

export type ResultatPhoto = { ok: true; photo: PhotoYeux } | { ok: false; raison: string };

export interface EtatYeux {
  status: PrintStatus;
  klippy: KlippyState;
  /** Couche en cours et nombre de couches, si le fichier les donne à Klipper. */
  couche: number | null;
  couches: number | null;
}

export interface TravailEnFile {
  fichier: string;
}

export class YeuxErreur extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YeuxErreur';
  }
}

/** Enveloppe `fetch` : seule une requête GET peut partir. Tout le reste est refusé sans appel. */
export function lectureSeule(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const methode = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (methode !== 'GET') {
      return Promise.reject(new YeuxErreur(`Requête ${methode} refusée : les yeux de Jarvis ne font que regarder.`));
    }
    return fetchImpl(input, init);
  };
}

/** Type réel d'une image d'après ses premiers octets (le type annoncé ne suffit pas). */
export function typeDesOctets(octets: Uint8Array): TypeImage | null {
  if (octets.length >= 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length >= png.length && png.every((octet, i) => octets[i] === octet)) return 'image/png';
  return null;
}

function raisonReseau(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? ` ${error.cause.name} ${error.cause.message}` : '';
  const texte = (error instanceof Error ? `${error.name} ${error.message}` : String(error)) + cause;
  if (/timeout|abort/i.test(texte)) return 'La caméra ne répond pas (plus de 5 secondes).';
  if (/redirect/i.test(texte)) return 'La caméra a renvoyé ailleurs : refusé.';
  return 'La caméra ne répond pas.';
}

/** Lit un corps de réponse sans jamais garder plus que `max` octets. */
async function lireBorne(response: Response, max: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const octets = new Uint8Array(await response.arrayBuffer());
    return octets.byteLength > max ? null : octets;
  }
  const lecteur = response.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lecteur.cancel().catch(() => undefined);
      return null;
    }
    morceaux.push(value);
  }
  const octets = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    octets.set(morceau, position);
    position += morceau.byteLength;
  }
  return octets;
}

/**
 * Une image par `GET`, bornée : délai, aucune redirection, 5 Mo, JPEG ou PNG vérifié aux octets.
 * Partagée par tous les yeux qui passent par le réseau (Klipper, œil réseau). Jamais d'exception.
 */
export async function lireImage(
  fetchImpl: typeof fetch,
  adresse: string,
  headers: Record<string, string>,
  delaiMs: number,
  maintenant: () => number,
  camera: string,
): Promise<ResultatPhoto> {
  let response: Response;
  try {
    response = await lectureSeule(fetchImpl)(adresse, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(delaiMs),
    });
  } catch (error) {
    return { ok: false, raison: raisonReseau(error) };
  }
  if (response.status >= 300 && response.status < 400) return { ok: false, raison: 'La caméra a renvoyé ailleurs : refusé.' };
  if (response.status === 401 || response.status === 403) return { ok: false, raison: 'La caméra a refusé la clé.' };
  if (!response.ok) return { ok: false, raison: `La caméra a répondu ${response.status}.` };
  const annonce = Number(response.headers.get('content-length') ?? '0');
  if (annonce > YEUX_IMAGE_MAX) return { ok: false, raison: "L'image de la caméra est trop grande (plus de 5 Mo)." };
  let octets: Uint8Array | null;
  try {
    octets = await lireBorne(response, YEUX_IMAGE_MAX);
  } catch (error) {
    return { ok: false, raison: raisonReseau(error) };
  }
  if (!octets) return { ok: false, raison: "L'image de la caméra est trop grande (plus de 5 Mo)." };
  const typeAnnonce = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const type = typeDesOctets(octets);
  if (!type || (typeAnnonce && typeAnnonce !== type)) {
    return { ok: false, raison: "La caméra n'a pas envoyé une image (JPEG ou PNG)." };
  }
  return { ok: true, photo: { octets, type, prisA: maintenant(), taille: octets.byteLength, camera } };
}

export class YeuxImprimante {
  readonly origin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl: string,
    private readonly apiKey = '',
    fetchImpl: typeof fetch = fetch,
    private readonly delaiMs = YEUX_DELAI_MS,
    private readonly maintenant: () => number = Date.now,
  ) {
    const check = checkRoverBaseUrl(baseUrl);
    if (!check.ok) throw new YeuxErreur(`Adresse de l'imprimante refusée. ${check.reason}`);
    this.origin = check.origin;
    this.fetchImpl = lectureSeule(fetchImpl);
  }

  private async lire(url: string, cle: boolean): Promise<Response> {
    const headers: Record<string, string> = {};
    if (cle && this.apiKey) headers['X-Api-Key'] = this.apiKey;
    return this.fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(this.delaiMs),
    });
  }

  private async lireJson<T>(chemin: string): Promise<T> {
    let response: Response;
    try {
      response = await this.lire(`${this.origin}${chemin}`, true);
    } catch {
      throw new YeuxErreur("L'imprimante ne répond pas.");
    }
    if (!response.ok) throw new YeuxErreur(`L'imprimante a répondu ${response.status}.`);
    return (await response.json()) as T;
  }

  async cameras(): Promise<Webcam[]> {
    const body = await this.lireJson<{
      result?: { webcams?: { name?: string; enabled?: boolean; snapshot_url?: string }[] };
    }>('/server/webcams/list');
    return (body.result?.webcams ?? [])
      .filter((cam) => cam.enabled !== false && typeof cam.snapshot_url === 'string' && cam.snapshot_url.trim())
      .map((cam) => ({ name: cam.name ?? 'caméra', snapshotUrl: cam.snapshot_url! }));
  }

  /**
   * Une photo, en mémoire. `nomCamera` : celle choisie dans les réglages ; absente ou introuvable,
   * la première caméra activée. Jamais d'exception : un échec rend une raison en mots simples.
   */
  async prendrePhoto(nomCamera?: string): Promise<ResultatPhoto> {
    let liste: Webcam[];
    try {
      liste = await this.cameras();
    } catch (error) {
      return { ok: false, raison: error instanceof YeuxErreur ? error.message : "L'imprimante ne répond pas." };
    }
    const choisie = (nomCamera && liste.find((cam) => cam.name === nomCamera)) || liste[0];
    if (!choisie) return { ok: false, raison: 'Aucune caméra activée dans Mainsail.' };
    const adresse = snapshotAddress(this.origin, choisie.snapshotUrl);
    if (!adresse) return { ok: false, raison: "L'adresse de la caméra n'est pas sur le réseau local : refusée." };
    return lireImage(this.fetchImpl, adresse, {}, this.delaiMs, this.maintenant, choisie.name);
  }

  async etat(): Promise<EtatYeux> {
    const body = await this.lireJson<{
      result?: {
        status?: Parameters<typeof readWatchStatus>[0] & {
          print_stats?: { info?: { current_layer?: number | null; total_layer?: number | null } };
        };
      };
    }>('/printer/objects/query?print_stats&virtual_sdcard&extruder&heater_bed&webhooks');
    const tree = body.result?.status ?? {};
    const { status, klippy } = readWatchStatus(tree);
    const info = tree.print_stats?.info;
    return {
      status,
      klippy,
      couche: typeof info?.current_layer === 'number' ? info.current_layer : null,
      couches: typeof info?.total_layer === 'number' ? info.total_layer : null,
    };
  }

  async file(): Promise<TravailEnFile[]> {
    const body = await this.lireJson<{ result?: { queued_jobs?: { filename?: string }[] } }>('/server/job_queue/status');
    return (body.result?.queued_jobs ?? [])
      .filter((job) => typeof job.filename === 'string' && job.filename)
      .map((job) => ({ fichier: job.filename! }));
  }
}
