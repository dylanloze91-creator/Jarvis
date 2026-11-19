import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeShelly } from './fakeShelly.testkit.js';
import { CameraWatch, fnv1a, PrinterWatchClient, PrinterWatchError, snapshotAddress } from './printerWatch.js';
import { digestResponse, ShellyError, ShellyPlug } from './shelly.js';

const PLUG = 'http://192.168.1.60';
const PRINTER = 'http://printer.local:7125';

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('prise Shelly', () => {
  it('une adresse Internet est refusée sans aucun appel', () => {
    const fake = new FakeShelly();
    expect(() => new ShellyPlug('https://example.com', '', fake.fetch)).toThrow('Adresse de la prise refusée');
    expect(fake.calls).toEqual([]);
  });

  it('lit l’état et la puissance mesurée', async () => {
    const fake = new FakeShelly();
    fake.watts = 245.3;
    const plug = new ShellyPlug(PLUG, '', fake.fetch);
    expect(await plug.status()).toEqual({ on: true, watts: 245.3, temperatureC: 31.5, errors: [] });
    expect(fake.calls).toEqual(['/rpc/Switch.GetStatus?id=0']);
    expect(fake.redirects).toEqual(['error']);
  });

  it('couper : la commande, puis l’état relu', async () => {
    const fake = new FakeShelly();
    fake.watts = 300;
    const plug = new ShellyPlug(PLUG, '', fake.fetch);
    expect(await plug.off()).toMatchObject({ on: false, watts: 0 });
    expect(fake.calls).toEqual(['/rpc/Switch.Set?id=0&on=false', '/rpc/Switch.GetStatus?id=0']);
  });

  it('mot de passe : un seul défi, puis le même nonce avec un compteur qui monte', async () => {
    const fake = new FakeShelly();
    fake.password = 'synthetique-test-mdp';
    const plug = new ShellyPlug(PLUG, 'synthetique-test-mdp', fake.fetch);
    expect((await plug.status()).on).toBe(true);
    expect((await plug.status()).on).toBe(true);
    expect(fake.challenges).toBe(1);
    expect(fake.calls).toHaveLength(3);
  });

  it('mauvais mot de passe, ou mot de passe absent : erreur claire', async () => {
    const fake = new FakeShelly();
    fake.password = 'synthetique-test-mdp';
    await expect(new ShellyPlug(PLUG, 'faux', fake.fetch).status()).rejects.toThrow('Mot de passe de la prise refusé.');
    await expect(new ShellyPlug(PLUG, '', fake.fetch).status()).rejects.toThrow('protégée par un mot de passe');
  });

  it('la fiche se lit sans mot de passe', async () => {
    const fake = new FakeShelly();
    fake.password = 'synthetique-test-mdp';
    expect(await new ShellyPlug(PLUG, '', fake.fetch).info()).toEqual({ model: 'S3PL-00112EU', gen: 3, authEnabled: true });
  });

  it('prise éteinte : ShellyError « injoignable »', async () => {
    const fake = new FakeShelly();
    fake.unreachable = true;
    const error = await new ShellyPlug(PLUG, '', fake.fetch).status().catch((e: unknown) => e);
    expect(error instanceof ShellyError).toBe(true);
    expect(String((error as Error).message)).toContain('Prise injoignable');
  });

  it('le digest suit les formules de la documentation', async () => {
    const input = { user: 'admin', realm: 'r', password: 'p', method: 'GET', uri: '/rpc/Switch.GetStatus?id=0', nonce: 'n', nc: '00000001', cnonce: 'c' };
    const expected = sha(`${sha('admin:r:p')}:n:00000001:c:auth:${sha('GET:/rpc/Switch.GetStatus?id=0')}`);
    expect(await digestResponse(input)).toBe(expected);
  });
});

function fakePrinter(tree: Record<string, unknown>, webcams: unknown[] = []) {
  const calls: { url: string; method: string; key: string | null }[] = [];
  const image = new Uint8Array(30_000).fill(7);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', key: new Headers(init?.headers).get('X-Api-Key') });
    const path = new URL(url).pathname;
    if (path === '/printer/objects/query') return new Response(JSON.stringify({ result: { status: tree } }));
    if (path === '/server/webcams/list') return new Response(JSON.stringify({ result: { webcams } }));
    if (path === '/webcam/') return new Response(image);
    if (path.startsWith('/printer/')) return new Response(JSON.stringify({ result: 'ok' }));
    return new Response('inconnu', { status: 404 });
  };
  return { calls, fetchImpl };
}

describe('lecture de l’imprimante pour la surveillance', () => {
  it('lit l’état de Klipper avec l’impression', async () => {
    const { fetchImpl, calls } = fakePrinter({
      print_stats: { state: 'printing', filename: 'cube.gcode', print_duration: 60 },
      virtual_sdcard: { progress: 0.25 },
      extruder: { temperature: 209.6, target: 210 },
      heater_bed: { temperature: 60, target: 60 },
      webhooks: { state: 'ready' },
    });
    const read = await new PrinterWatchClient(PRINTER, 'synthetique-test-cle', fetchImpl).read();
    expect(read.klippy).toBe('ready');
    expect(read.status).toMatchObject({ state: 'printing', filename: 'cube.gcode', progress: 0.25, extruder: 209.6, extruderTarget: 210 });
    expect(calls[0]!.url).toContain('webhooks');
    expect(calls[0]!.key).toBe('synthetique-test-cle');
  });

  it('un état de Klipper inconnu reste « unknown »', async () => {
    const { fetchImpl } = fakePrinter({ print_stats: { state: 'standby' } });
    expect((await new PrinterWatchClient(PRINTER, '', fetchImpl).read()).klippy).toBe('unknown');
  });

  it('adresse de la caméra : relative = même machine en HTTP port 80 ; Internet refusé', () => {
    expect(snapshotAddress(PRINTER, '/webcam/?action=snapshot')).toBe('http://printer.local/webcam/?action=snapshot');
    expect(snapshotAddress('http://192.168.1.20:7125', 'webcam/?action=snapshot')).toBe('http://192.168.1.20/webcam/?action=snapshot');
    expect(snapshotAddress(PRINTER, 'http://192.168.1.20:8080/?action=snapshot')).toBe('http://192.168.1.20:8080/?action=snapshot');
    expect(snapshotAddress(PRINTER, 'https://example.com/cam.jpg')).toBeNull();
    expect(snapshotAddress(PRINTER, '//example.com/cam.jpg')).toBeNull();
    expect(snapshotAddress(PRINTER, '')).toBeNull();
  });

  it('image de la caméra : la clé de Moonraker ne part pas vers la caméra', async () => {
    const { fetchImpl, calls } = fakePrinter({}, [
      { name: 'éteinte', enabled: false, snapshot_url: '/autre/' },
      { name: 'plateau', enabled: true, snapshot_url: '/webcam/?action=snapshot' },
    ]);
    const client = new PrinterWatchClient(PRINTER, 'synthetique-test-cle', fetchImpl);
    expect(await client.webcams()).toEqual([{ name: 'plateau', snapshotUrl: '/webcam/?action=snapshot' }]);
    const bytes = await client.snapshot();
    expect(bytes.byteLength).toBe(30_000);
    const cam = calls.find((c) => c.url.startsWith('http://printer.local/webcam/'))!;
    expect(cam.key).toBeNull();
  });

  it('sans caméra déclarée : erreur claire', async () => {
    const { fetchImpl } = fakePrinter({}, []);
    await expect(new PrinterWatchClient(PRINTER, '', fetchImpl).snapshot()).rejects.toThrow('Aucune caméra');
  });

  it('pause, annulation et arrêt d’urgence vont aux bonnes adresses ; rien ne lance ni ne reprend', async () => {
    const { fetchImpl, calls } = fakePrinter({});
    const client = new PrinterWatchClient(PRINTER, '', fetchImpl);
    await client.pause();
    await client.cancel();
    await client.emergencyStop();
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /printer/print/pause',
      'POST /printer/print/cancel',
      'POST /printer/emergency_stop',
    ]);
    expect('start' in client).toBe(false);
    expect('resume' in client).toBe(false);
  });

  it('imprimante injoignable : PrinterWatchError', async () => {
    const failing: typeof fetch = async () => {
      throw new Error('hors ligne');
    };
    const error = await new PrinterWatchClient(PRINTER, '', failing).read().catch((e: unknown) => e);
    expect(error instanceof PrinterWatchError).toBe(true);
  });
});

describe('regard sur les images', () => {
  it('image minuscule = noire ; image bien plus petite que d’habitude = noire', () => {
    const watch = new CameraWatch();
    expect(watch.look(new Uint8Array(900)).dark).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(watch.look(new Uint8Array(40_000 + i)).dark).toBe(false);
    expect(watch.look(new Uint8Array(6_000)).dark).toBe(true);
    expect(watch.look(new Uint8Array(38_000)).dark).toBe(false);
  });

  it('même image = même empreinte ; image différente = autre empreinte', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(fnv1a(a)).toBe(fnv1a(new Uint8Array([1, 2, 3, 4])));
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });
});
