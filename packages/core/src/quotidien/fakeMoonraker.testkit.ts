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

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}`);
    const headers = new Headers(init?.headers);
    const key = headers.get('X-Api-Key');
    if (key) this.apiKeys.push(key);
    if (url.pathname === '/printer/objects/query') return json({ result: { status: this.tree() } });
    if (url.pathname === '/server/files/list') return json({ result: this.files });
    if (url.pathname === '/server/files/upload' && method === 'POST') {
      this.status = { ...this.status, state: 'printing', filename: 'synthetique-test.gcode', progress: 0.1 };
      return json({ result: 'ok' });
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
