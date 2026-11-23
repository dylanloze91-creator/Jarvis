/**
 * Ce que la surveillance lit et fait sur l'imprimante, par Moonraker (sans Electron).
 * Documentation officielle :
 * - état des objets : https://moonraker.readthedocs.io/en/latest/web_api/#query-printer-object-status
 *   (`webhooks.state` : ready, startup, shutdown, error ; https://www.klipper3d.org/Status_Reference.html)
 * - caméras : https://moonraker.readthedocs.io/en/latest/web_api/#list-webcams
 *   (`snapshot_url` absolu, ou relatif à l'hôte de Moonraker et servi en HTTP sur le port 80)
 * - pause, annulation, arrêt d'urgence : https://moonraker.readthedocs.io/en/latest/external_api/printer/
 *
 * Réseau local seulement, jamais de redirection suivie, chaque appel borné dans le temps.
 * La surveillance ne lance, ne reprend et ne chauffe jamais rien : ce client n'en a pas le moyen.
 */
import type { PrintStatus } from '../quotidien/moonraker.js';
import { checkRoverBaseUrl } from '../rover/url.js';
import type { KlippyState } from './surveillance.js';
import { nomObjetSur } from './objets.js';
import type { Point2, Point3 } from './camera3d.js';

/** Objets de l'impression vus par Klipper (`exclude_object`), position de la tête et zone palpée. */
export interface ObjetsKlipper {
  objets: { nom: string; polygone: Point2[]; centre: Point2 | null }[];
  exclus: string[];
  courant: string | null;
  tete: Point3 | null;
  maillage: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

interface ObjetsTree {
  exclude_object?: {
    objects?: { name?: string; center?: number[]; polygon?: number[][] }[];
    excluded_objects?: string[];
    current_object?: string | null;
  };
  toolhead?: { position?: number[] };
  bed_mesh?: { mesh_min?: number[]; mesh_max?: number[] };
}

export function lireObjetsKlipper(tree: ObjetsTree): ObjetsKlipper {
  const ex = tree.exclude_object ?? {};
  const objets = (ex.objects ?? [])
    .filter((o) => typeof o.name === 'string' && o.name)
    .map((o) => ({
      nom: o.name!,
      polygone: (o.polygon ?? []).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Number(p[0]), Number(p[1])] as Point2),
      centre: Array.isArray(o.center) && o.center.length >= 2 ? ([Number(o.center[0]), Number(o.center[1])] as Point2) : null,
    }));
  const pos = tree.toolhead?.position;
  const mn = tree.bed_mesh?.mesh_min;
  const mx = tree.bed_mesh?.mesh_max;
  return {
    objets,
    exclus: (ex.excluded_objects ?? []).filter((n): n is string => typeof n === 'string'),
    courant: typeof ex.current_object === 'string' ? ex.current_object : null,
    tete: Array.isArray(pos) && pos.length >= 3 ? [Number(pos[0]), Number(pos[1]), Number(pos[2])] : null,
    maillage:
      Array.isArray(mn) && Array.isArray(mx) && mn.length >= 2 && mx.length >= 2 && (mx[0]! > mn[0]! || mx[1]! > mn[1]!)
        ? { minX: mn[0]!, minY: mn[1]!, maxX: mx[0]!, maxY: mx[1]! }
        : null,
  };
}

export class PrinterWatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterWatchError';
  }
}

export interface Webcam {
  name: string;
  snapshotUrl: string;
}

/** Une image au plus : 5 Mo. */
export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;

interface StatusTree {
  print_stats?: { state?: string; filename?: string; print_duration?: number; total_duration?: number };
  virtual_sdcard?: { progress?: number };
  heater_bed?: { temperature?: number; target?: number };
  extruder?: { temperature?: number; target?: number };
  webhooks?: { state?: string };
}

const KLIPPY: readonly KlippyState[] = ['ready', 'startup', 'shutdown', 'error'];

export function readWatchStatus(tree: StatusTree): { status: PrintStatus; klippy: KlippyState } {
  const klippyRaw = tree.webhooks?.state ?? 'unknown';
  return {
    status: {
      state: tree.print_stats?.state ?? 'unknown',
      filename: tree.print_stats?.filename ?? '',
      progress: tree.virtual_sdcard?.progress ?? 0,
      printDuration: tree.print_stats?.print_duration ?? 0,
      totalDuration: tree.print_stats?.total_duration ?? 0,
      bed: tree.heater_bed?.temperature ?? 0,
      bedTarget: tree.heater_bed?.target ?? 0,
      extruder: tree.extruder?.temperature ?? 0,
      extruderTarget: tree.extruder?.target ?? 0,
    },
    klippy: (KLIPPY as readonly string[]).includes(klippyRaw) ? (klippyRaw as KlippyState) : 'unknown',
  };
}

/**
 * Adresse de l'image d'une caméra. Relative : même machine que Moonraker, en HTTP sur le port 80
 * (règle de la documentation). Absolue : acceptée seulement sur le réseau local.
 */
export function snapshotAddress(moonrakerOrigin: string, snapshotUrl: string): string | null {
  const raw = snapshotUrl.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const check = checkRoverBaseUrl(raw);
    if (!check.ok) return null;
    return new URL(raw).toString();
  }
  if (raw.startsWith('//')) return null;
  const host = new URL(moonrakerOrigin).hostname;
  const hostPart = host.includes(':') ? `[${host}]` : host;
  return new URL(raw.startsWith('/') ? raw : `/${raw}`, `http://${hostPart}`).toString();
}

export class PrinterWatchClient {
  readonly origin: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
  ) {
    const check = checkRoverBaseUrl(baseUrl);
    if (!check.ok) throw new PrinterWatchError(`Adresse Moonraker refusée. ${check.reason}`);
    this.origin = check.origin;
  }

  async read(): Promise<{ status: PrintStatus; klippy: KlippyState }> {
    const response = await this.call(
      `${this.origin}/printer/objects/query?print_stats&heater_bed&extruder&virtual_sdcard&webhooks`,
      'GET',
    );
    const body = (await response.json()) as { result?: { status?: StatusTree } };
    return readWatchStatus(body.result?.status ?? {});
  }

  async webcams(): Promise<Webcam[]> {
    const response = await this.call(`${this.origin}/server/webcams/list`, 'GET');
    const body = (await response.json()) as {
      result?: { webcams?: { name?: string; enabled?: boolean; snapshot_url?: string }[] };
    };
    return (body.result?.webcams ?? [])
      .filter((cam) => cam.enabled !== false && typeof cam.snapshot_url === 'string' && cam.snapshot_url.trim())
      .map((cam) => ({ name: cam.name ?? 'caméra', snapshotUrl: cam.snapshot_url! }));
  }

  /** Une image fixe de la caméra choisie (la première sinon). Rien n'est écrit sur le disque. */
  async snapshot(webcam?: Webcam): Promise<Uint8Array> {
    const cam = webcam ?? (await this.webcams())[0];
    if (!cam) throw new PrinterWatchError('Aucune caméra déclarée dans Moonraker.');
    const address = snapshotAddress(this.origin, cam.snapshotUrl);
    if (!address) throw new PrinterWatchError('Adresse de la caméra refusée : elle doit être sur le réseau local.');
    const response = await this.call(address, 'GET', false);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > SNAPSHOT_MAX_BYTES) throw new PrinterWatchError('Image de la caméra trop grande.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > SNAPSHOT_MAX_BYTES) throw new PrinterWatchError('Image de la caméra trop grande.');
    return bytes;
  }

  /** Objets de l'impression, position de la tête et zone palpée. */
  async readObjets(): Promise<ObjetsKlipper> {
    const response = await this.call(`${this.origin}/printer/objects/query?exclude_object&toolhead&bed_mesh`, 'GET');
    const body = (await response.json()) as { result?: { status?: ObjetsTree } };
    return lireObjetsKlipper(body.result?.status ?? {});
  }

  /**
   * Arrête UN objet (`EXCLUDE_OBJECT`), les autres continuent. Le nom doit venir de Klipper et
   * ne contenir que lettres, chiffres, « _ », « . », « - » : rien ne peut glisser une autre commande.
   */
  async excludeObject(nom: string): Promise<void> {
    if (!nomObjetSur(nom)) throw new PrinterWatchError("Nom d'objet refusé.");
    await this.call(`${this.origin}/printer/gcode/script`, 'POST', true, { script: `EXCLUDE_OBJECT NAME=${nom}` });
  }

  async pause(): Promise<void> {
    await this.call(`${this.origin}/printer/print/pause`, 'POST');
  }

  async cancel(): Promise<void> {
    await this.call(`${this.origin}/printer/print/cancel`, 'POST');
  }

  /** Arrêt d'urgence de Klipper (`M112`) : il passe en « shutdown » et coupe ses chauffes. */
  async emergencyStop(): Promise<void> {
    await this.call(`${this.origin}/printer/emergency_stop`, 'POST');
  }

  private async call(url: string, method: 'GET' | 'POST', withKey = true, body: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (withKey && this.apiKey) headers['X-Api-Key'] = this.apiKey;
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new PrinterWatchError(`Imprimante injoignable (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (!response.ok) throw new PrinterWatchError(`Moonraker a répondu ${response.status}.`);
    return response;
  }
}

/** Empreinte rapide d'une image (FNV-1a 32 bits), pour voir si elle est figée. Pas de chiffrement. */
export function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-${bytes.length}`;
}

/**
 * Regarde les images une à une, sans les décoder (aucune dépendance). Une image JPEG noire ou
 * vide est beaucoup plus petite que les images normales de la même caméra : moins de 2 Ko, ou
 * moins du quart de la taille habituelle des dernières images. L'image figée se voit à une
 * empreinte identique (la surveillance compte les répétitions).
 */
export class CameraWatch {
  private readonly sizes: number[] = [];

  look(bytes: Uint8Array): { dark: boolean; signature: string } {
    const size = bytes.byteLength;
    const sorted = [...this.sizes].sort((a, b) => a - b);
    const median = sorted.length >= 3 ? sorted[Math.floor(sorted.length / 2)]! : null;
    const dark = size < 2_048 || (median !== null && size < median / 4);
    if (!dark) {
      this.sizes.push(size);
      if (this.sizes.length > 10) this.sizes.shift();
    }
    return { dark, signature: fnv1a(bytes) };
  }
}
