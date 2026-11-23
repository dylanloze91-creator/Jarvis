/**
 * Faux Moonraker pour les tests. Aucune adresse réelle, aucune clé réelle.
 * Les exemples portent la marque synthetique-test.
 */
import type { PrintStatus } from './moonraker.js';

export class FakeMoonraker {
  status: PrintStatus = {
    state: 'standby',
    filename: '',
    progress: 0,
    printDuration: 0,
    totalDuration: 0,
    bed: 20,
    bedTarget: 0,
    extruder: 21,
    extruderTarget: 0,
  };
  files: { path: string; size: number }[] = [{ path: 'synthetique-test.gcode', size: 12 }];
  calls: string[] = [];
  apiKeys: string[] = [];
  /** Vrai : l'imprimante est éteinte, aucun appel ne répond. */
  stopped = false;
  /**
   * File d'attente, comme `job_queue.py` de Moonraker : `null` = pas de section `[job_queue]`
   * (les adresses de la file répondent 404). Valeurs en texte, comme dans moonraker.conf.
   */
  jobQueue: { automatic_transition?: string; load_on_startup?: string } | null = {};
  queue: { filename: string; job_id: string }[] = [];
  queueState = 'paused';
  private pauseRequested = false;
  private nextJob = 1;

  fetch: typeof fetch = async (input, init) => {
    if (this.stopped) throw new Error('imprimante éteinte');
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}`);
    const headers = new Headers(init?.headers);
    const key = headers.get('X-Api-Key');
    if (key) this.apiKeys.push(key);
    if (url.pathname === '/printer/objects/query') return json({ result: { status: this.tree() } });
    if (url.pathname === '/server/files/list') return json({ result: this.files });
    if (url.pathname === '/server/files/upload' && method === 'POST') {
      const form = init?.body instanceof FormData ? init.body : null;
      const file = form?.get('file');
      const name = file instanceof File ? file.name : 'synthetique-test.gcode';
      if (this.status.state === 'printing' && this.status.filename === name) return new Response('fichier en cours', { status: 400 });
      if (!this.files.some((f) => f.path === name)) this.files.push({ path: name, size: file instanceof File ? file.size : 0 });
      if (form?.get('print') !== 'false') this.status = { ...this.status, state: 'printing', filename: name, progress: 0.1 };
      return json({ result: 'ok' });
    }
    if (url.pathname === '/server/config') {
      return json({ result: { config: this.jobQueue ? { job_queue: this.jobQueue } : {} } });
    }
    if (url.pathname.startsWith('/server/job_queue/')) {
      if (!this.jobQueue) return new Response('inconnu', { status: 404 });
      if (url.pathname === '/server/job_queue/status' && method === 'GET') return this.queueBody();
      if (url.pathname === '/server/job_queue/pause' && method === 'POST') {
        this.queueState = 'paused';
        this.pauseRequested = true;
        return this.queueBody();
      }
      if (url.pathname === '/server/job_queue/start' && method === 'POST') {
        this.pauseRequested = false;
        this.queueState = this.automatic() ? 'ready' : 'paused';
        if (this.queue.length && !['printing', 'paused'].includes(this.status.state)) this.popJob();
        return this.queueBody();
      }
      if (url.pathname === '/server/job_queue/job' && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { filenames?: string[] };
        const names = body.filenames ?? [];
        if (names.some((name) => !this.files.some((f) => f.path === name))) return new Response('fichier absent', { status: 400 });
        for (const filename of names) this.queue.push({ filename, job_id: String(this.nextJob++).padStart(16, '0') });
        if (this.automatic() && !this.pauseRequested && ['printing', 'paused'].includes(this.status.state)) this.queueState = 'ready';
        return this.queueBody();
      }
      if (url.pathname === '/server/job_queue/job' && method === 'DELETE') {
        const ids = (url.searchParams.get('job_ids') ?? '').split(',');
        this.queue = this.queue.filter((job) => !ids.includes(job.job_id));
        return this.queueBody();
      }
    }
    if (url.pathname === '/printer/print/start') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { filename?: string };
      this.status = { ...this.status, state: 'printing', filename: body.filename ?? '', progress: 0.01 };
      return json({ result: 'ok' });
    }
    if (url.pathname === '/printer/print/pause') {
      this.status = { ...this.status, state: 'paused' };
      return json({ result: 'ok' });
    }
    if (url.pathname === '/printer/print/resume') {
      this.status = { ...this.status, state: 'printing' };
      return json({ result: 'ok' });
    }
    if (url.pathname === '/printer/print/cancel') {
      this.status = { ...this.status, state: 'cancelled' };
      return json({ result: 'ok' });
    }
    return new Response('inconnu', { status: 404 });
  };

  /** Fin de l'impression en cours, comme `_on_job_complete` de Moonraker. */
  finishPrint(): void {
    this.status = { ...this.status, state: 'complete', progress: 1 };
    if (this.automatic() && this.queueState === 'ready' && this.queue.length) this.popJob();
  }

  /** Klipper redémarre, comme `_handle_ready` de Moonraker. */
  klipperReady(): void {
    this.status = { ...this.status, state: 'standby' };
    if (this.vrai(this.jobQueue?.load_on_startup) && this.queue.length && ['ready', 'paused'].includes(this.queueState)) this.popJob();
  }

  private automatic(): boolean {
    return this.vrai(this.jobQueue?.automatic_transition);
  }

  private vrai(value: string | undefined): boolean {
    return /^(?:true|yes|on|1)$/i.test(value ?? '');
  }

  private popJob(): void {
    const job = this.queue.shift();
    if (!job) return;
    this.status = { ...this.status, state: 'printing', filename: job.filename, progress: 0.01 };
    this.queueState = this.queue.length && this.automatic() ? 'ready' : 'paused';
  }

  private queueBody(): Response {
    return json({
      result: {
        queued_jobs: this.queue.map((job) => ({ ...job, time_added: 1, time_in_queue: 1 })),
        queue_state: this.queueState,
      },
    });
  }

  private tree() {
    return {
      print_stats: {
        state: this.status.state,
        filename: this.status.filename,
        print_duration: this.status.printDuration,
        total_duration: this.status.totalDuration,
      },
      virtual_sdcard: { progress: this.status.progress },
      heater_bed: { temperature: this.status.bed, target: this.status.bedTarget },
      extruder: { temperature: this.status.extruder, target: this.status.extruderTarget },
    };
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
