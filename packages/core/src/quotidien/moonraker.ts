/**
 * Client Moonraker, sans Electron.
 * Points d'accès (documentation officielle) :
 * - https://moonraker.readthedocs.io/en/latest/web_api/#query-printer-object-status
 * - https://moonraker.readthedocs.io/en/latest/web_api/#list-files
 * - https://moonraker.readthedocs.io/en/latest/web_api/#upload-file
 * - https://moonraker.readthedocs.io/en/latest/web_api/#printer-administration
 */
import { checkRoverBaseUrl } from '../rover/url.js';

export interface PrintStatus {
  state: string;
  filename: string;
  progress: number;
  printDuration: number;
  totalDuration: number;
  bed: number;
  bedTarget: number;
  extruder: number;
  extruderTarget: number;
}

export interface PrinterFile {
  path: string;
  size: number;
}

export class MoonrakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoonrakerError';
  }
}

export class MoonrakerClient {
  readonly origin: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const check = checkRoverBaseUrl(baseUrl);
    if (!check.ok) throw new MoonrakerError(`Adresse Moonraker refusée. ${check.reason}`);
    this.origin = check.origin;
  }

  async status(): Promise<PrintStatus> {
    const body = await this.json<{ result?: { status?: StatusTree } }>(
      '/printer/objects/query?print_stats&heater_bed&extruder&virtual_sdcard',
    );
    return readStatus(body.result?.status ?? {});
  }

  async files(): Promise<PrinterFile[]> {
    const body = await this.json<{ result?: { path?: string; size?: number }[] }>('/server/files/list?root=gcodes');
    return (body.result ?? []).map((file) => ({ path: file.path ?? '', size: file.size ?? 0 })).filter((file) => file.path);
  }

  /** Envoie un gcode. `print` vrai demande à Moonraker de lancer (`print=true`). */
  async upload(name: string, bytes: Uint8Array, print: boolean): Promise<void> {
    const data = new FormData();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    data.set('file', new Blob([copy]), name);
    data.set('root', 'gcodes');
    data.set('print', print ? 'true' : 'false');
    await this.request('/server/files/upload', { method: 'POST', body: data });
  }

  async start(filename: string): Promise<PrintStatus> {
    await this.request('/printer/print/start', { method: 'POST', json: { filename } });
    return this.status();
  }

  async pause(): Promise<PrintStatus> {
    await this.request('/printer/print/pause', { method: 'POST', json: {} });
    return this.status();
  }

  async resume(): Promise<PrintStatus> {
    await this.request('/printer/print/resume', { method: 'POST', json: {} });
    return this.status();
  }

  async cancel(): Promise<PrintStatus> {
    await this.request('/printer/print/cancel', { method: 'POST', json: {} });
    return this.status();
  }

  private async json<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: 'GET' });
    return (await response.json()) as T;
  }

  private async request(path: string, init: { method: string; json?: unknown; body?: FormData }): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['X-Api-Key'] = this.apiKey;
    if (init.json !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      method: init.method,
      headers,
      body: init.body ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    });
    if (!response.ok) throw new MoonrakerError(`Moonraker a répondu ${response.status}.`);
    return response;
  }
}

interface StatusTree {
  print_stats?: { state?: string; filename?: string; print_duration?: number; total_duration?: number };
  virtual_sdcard?: { progress?: number };
  heater_bed?: { temperature?: number; target?: number };
  extruder?: { temperature?: number; target?: number };
}

function readStatus(tree: StatusTree): PrintStatus {
  return {
    state: tree.print_stats?.state ?? 'unknown',
    filename: tree.print_stats?.filename ?? '',
    progress: tree.virtual_sdcard?.progress ?? 0,
    printDuration: tree.print_stats?.print_duration ?? 0,
    totalDuration: tree.print_stats?.total_duration ?? 0,
    bed: Math.round(tree.heater_bed?.temperature ?? 0),
    bedTarget: Math.round(tree.heater_bed?.target ?? 0),
    extruder: Math.round(tree.extruder?.temperature ?? 0),
    extruderTarget: Math.round(tree.extruder?.target ?? 0),
  };
}

export function formatPrintStatus(status: PrintStatus): string {
  const percent = Math.round(status.progress * 100);
  const left = remaining(status);
  const file = status.filename || 'aucun fichier';
  return `Impression ${status.state}, fichier ${file}, ${percent} %.${left} Buse ${status.extruder}° (consigne ${status.extruderTarget}°), plateau ${status.bed}° (consigne ${status.bedTarget}°).`;
}

function remaining(status: PrintStatus): string {
  if (status.progress <= 0 || status.progress >= 1 || status.printDuration <= 0) return '';
  const seconds = status.printDuration * ((1 - status.progress) / status.progress);
  return ` Reste environ ${formatPrintDuration(seconds)}.`;
}

export function formatPrintDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes}`;
  return `${minutes} min`;
}

export function printFinishedSentence(filename: string, seconds: number): string {
  return `L'impression de ${filename} est terminée (${formatPrintDuration(seconds)}).`;
}

export type PrinterPlace = 'fenetre' | 'telephone' | 'enceinte';

export type PrinterIntent =
  | { kind: 'status' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'cancel' }
  | { kind: 'start'; filename: string | null };

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, ' ')
    .replace(/[?.!]+$/g, '')
    .trim();
}

/** Phrases express. `null` : le tour continue. */
export function printerIntent(text: string): PrinterIntent | null {
  const raw = text.trim().replace(/^(?:jarvis)[,.\s]+/iu, '');
  const n = fold(raw);
  if (!n) return null;
  if (n === 'ou en est l impression' || n === 'ou en est l impression en cours') return { kind: 'status' };
  if (n === 'mets l impression en pause' || n === 'met l impression en pause') return { kind: 'pause' };
  if (n === 'reprends l impression' || n === 'reprend l impression') return { kind: 'resume' };
  if (n === 'annule l impression') return { kind: 'cancel' };
  if (n === 'imprime' || n === 'lance l impression') return { kind: 'start', filename: null };
  const file = raw.match(/^(?:imprime|lance)\s+(?:le\s+fichier\s+)?(.+\.gcode)$/iu);
  if (file?.[1]) return { kind: 'start', filename: file[1].trim() };
  return null;
}

export const SPEAKER_CANNOT_START = "Le lancement d'une impression se fait sur le PC ou le téléphone.";

const PLATE = 'Vérifie que le plateau est vide.';

export function startConfirmText(filename: string): string {
  return `Lancer l'impression de ${filename}. ${PLATE}`;
}

/**
 * Suit une impression. Le message de fin part une seule fois par impression.
 * `schedule` permet aux tests de ne pas attendre 60 s.
 */
export function startPrintWatch(options: {
  intervalMs: number;
  read: () => Promise<PrintStatus | null>;
  onDone: (message: string) => void;
  schedule?: (run: () => void, ms: number) => { cancel(): void };
}): { stop(): void } {
  const schedule = options.schedule ?? ((run, ms) => {
    const id = setInterval(run, ms);
    return { cancel: () => clearInterval(id) };
  });
  let printing = false;
  let announced = false;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    void options.read().then((status) => {
      if (!status || stopped) return;
      if (status.state === 'printing') {
        printing = true;
        announced = false;
        return;
      }
      if (printing && !announced && (status.state === 'complete' || status.state === 'completed')) {
        announced = true;
        printing = false;
        options.onDone(printFinishedSentence(status.filename || 'fichier', status.printDuration || status.totalDuration));
      }
    }).catch(() => undefined);
  };
  const timer = schedule(tick, options.intervalMs);
  return { stop: () => { stopped = true; timer.cancel(); } };
}
