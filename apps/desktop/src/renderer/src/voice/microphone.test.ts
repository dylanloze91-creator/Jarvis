import { describe, expect, it, vi } from 'vitest';
import { MicrophoneService, type AudioGraph, type FrameListener, type MicrophoneDeps } from './microphone';

type Listener = () => void;

class FakeTrack {
  readonly listeners = new Map<string, Set<Listener>>();
  stopped = false;
  muted = false;
  constructor(
    readonly label: string,
    readonly deviceId: string,
  ) {}
  getSettings() {
    return { deviceId: this.deviceId };
  }
  stop() {
    this.stopped = true;
  }
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function fakeStream(track: FakeTrack): MediaStream {
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
}

function domError(name: string, message = ''): Error {
  return Object.assign(new Error(message), { name });
}

interface Device {
  deviceId: string;
  label: string;
}

const GOXLR: Device[] = [
  { deviceId: 'default', label: 'Default - Broadcast Stream Mix (TC-HELICON GoXLR Mini)' },
  { deviceId: 'mix', label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)' },
  { deviceId: 'chat', label: 'Chat Mic (TC-HELICON GoXLR Mini)' },
];

function harness(options: {
  devices?: Device[];
  gum?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  frames?: boolean;
} = {}) {
  let clock = 0;
  let devices = options.devices ?? GOXLR;
  const timers: Array<{ at: number; callback: () => void; id: number }> = [];
  let nextId = 1;
  const tracks: FakeTrack[] = [];
  const graphs: Array<{ onFrame: FrameListener; closed: boolean }> = [];
  const deviceListeners = new Set<Listener>();
  const lines: string[] = [];

  const defaultGum = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    clock += 150;
    const audio = constraints.audio as MediaTrackConstraints & { deviceId?: { exact: string } };
    const wanted = audio.deviceId?.exact;
    if (wanted && !devices.some((device) => device.deviceId === wanted)) {
      throw domError('OverconstrainedError', '');
    }
    const id = wanted ?? 'default';
    const label = devices.find((device) => device.deviceId === id)?.label ?? 'Default';
    const track = new FakeTrack(label, id);
    tracks.push(track);
    return fakeStream(track);
  };
  const gum = vi.fn(options.gum ?? defaultGum);

  const deps: MicrophoneDeps = {
    mediaDevices: {
      getUserMedia: gum,
      enumerateDevices: async () =>
        devices.map((device) => ({ ...device, kind: 'audioinput', groupId: '', toJSON: () => ({}) })) as MediaDeviceInfo[],
      addEventListener: (_type, listener) => deviceListeners.add(listener),
      removeEventListener: (_type, listener) => deviceListeners.delete(listener),
    },
    queryPermission: async () => 'granted',
    openGraph: async (_stream, onFrame): Promise<AudioGraph> => {
      const graph = { onFrame, closed: false };
      graphs.push(graph);
      return {
        close: () => {
          graph.closed = true;
        },
        resume: async () => undefined,
      };
    },
    closeGraphs: () => undefined,
    now: () => clock,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.push({ at: clock + ms, callback, id });
      return id;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    log: (line) => lines.push(line),
    getUserMediaTimeoutMs: 10_000,
    enumerateTimeoutMs: 3_000,
    firstFrameTimeoutMs: 4_000,
  };

  const service = new MicrophoneService(deps);
  /** Une trame de 256 ms sur chaque graphe encore branché (le worklet en envoie ~4 par seconde). */
  const emit = (): void => {
    if (options.frames === false) return;
    for (const graph of graphs) if (!graph.closed) graph.onFrame(new Float32Array(4096), 16000);
  };
  const advance = async (ms: number): Promise<void> => {
    const target = clock + ms;
    for (;;) {
      await flush();
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      clock = next.at;
      next.callback();
    }
    clock = target;
    await flush();
  };
  return {
    service,
    gum,
    tracks,
    graphs,
    lines,
    advance,
    emit,
    setDevices: (next: Device[]) => {
      devices = next;
    },
    fireDeviceChange: () => {
      for (const listener of deviceListeners) listener();
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('micro partagé', () => {
  it('ouvre l’entrée par défaut sans deviceId, en brut, et mesure chaque étape', async () => {
    const h = harness();
    h.service.acquire('écoute');
    await h.service.settled();
    h.emit();
    const status = h.service.getStatus();
    expect(status.phase).toBe('open');
    expect(status.label).toBe('Default - Broadcast Stream Mix (TC-HELICON GoXLR Mini)');
    expect(h.gum).toHaveBeenCalledTimes(1);
    expect(h.gum.mock.calls[0]?.[0]).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } },
    });
    expect(status.timings).toMatchObject({ permission: 'granted', inputCount: 3, getUserMediaMs: 150 });
    expect(status.timings.firstFrameMs).toBeDefined();
    expect(h.lines.join('\n')).toMatch(/ouvert « Default - Broadcast Stream Mix/);
    expect(h.lines.join('\n')).toMatch(/getUserMedia 150 ms/);
  });

  it('change de micro en un seul getUserMedia, sans couper l’écoute avant', async () => {
    const h = harness();
    const frames: number[] = [];
    h.service.onFrame((frame) => frames.push(frame.length));
    h.service.acquire('écoute');
    await h.service.settled();
    h.emit();
    await h.service.setPreferredDevice('chat');
    h.emit();
    expect(h.gum).toHaveBeenCalledTimes(2);
    expect(h.gum.mock.calls[1]?.[0]).toMatchObject({ audio: { deviceId: { exact: 'chat' } } });
    expect(h.service.getStatus()).toMatchObject({ phase: 'open', label: 'Chat Mic (TC-HELICON GoXLR Mini)', deviceId: 'chat' });
    expect(h.service.getStatus().timings.getUserMediaMs).toBe(150);
    expect(h.tracks[0]!.stopped).toBe(true);
    expect(h.graphs[0]!.closed).toBe(true);
    expect(frames.length).toBeGreaterThanOrEqual(2);
  });

  it('un identifiant enregistré périmé (0.4.13) ouvre le défaut et le signale', async () => {
    const h = harness();
    await h.service.setPreferredDevice('ancien-id');
    h.service.acquire('écoute');
    await h.service.settled();
    expect(h.gum).toHaveBeenCalledTimes(1);
    expect(h.service.getStatus()).toMatchObject({ phase: 'open', usingFallback: true, failure: null });
  });

  it('garde le nom exact de l’erreur et réessaie seul quand Windows bloque le micro', async () => {
    let blocked = true;
    const h = harness({
      gum: async () => {
        if (blocked) throw domError('NotAllowedError', 'Permission denied by system');
        const track = new FakeTrack('Default - Chat Mic', 'default');
        return fakeStream(track);
      },
    });
    h.service.acquire('écoute');
    await h.service.settled();
    const failed = h.service.getStatus();
    expect(failed.phase).toBe('error');
    expect(failed.failure).toMatchObject({ name: 'NotAllowedError', message: 'Permission denied by system', privacySettings: true });
    expect(h.lines.join('\n')).toMatch(/échec à l'étape getUserMedia : NotAllowedError : Permission denied by system/);

    blocked = false;
    await h.advance(300);
    await h.service.settled();
    expect(h.service.getStatus()).toMatchObject({ phase: 'open', failure: null });
  });

  it('borne un getUserMedia qui ne répond pas (TimeoutError) au lieu d’attendre sans fin', async () => {
    const h = harness({ gum: () => new Promise<MediaStream>(() => undefined) });
    h.service.acquire('écoute');
    await h.advance(10_000);
    expect(h.service.getStatus()).toMatchObject({ phase: 'error' });
    expect(h.service.getStatus().failure?.name).toBe('TimeoutError');
  });

  it('rouvre tout seul après un débranchement (ended), puis au retour du périphérique', async () => {
    const h = harness();
    h.service.acquire('écoute');
    await h.service.settled();
    h.setDevices([]);
    h.tracks[0]!.emit('ended');
    expect(h.service.getStatus().phase).toBe('recovering');
    expect(h.service.getStatus().failure?.name).toBe('DeviceLostError');

    h.setDevices(GOXLR);
    h.fireDeviceChange();
    await h.advance(250);
    await h.service.settled();
    expect(h.service.getStatus()).toMatchObject({ phase: 'open', failure: null });
    expect(h.gum).toHaveBeenCalledTimes(2);
  });

  it('revient au micro choisi quand il est rebranché', async () => {
    const h = harness({ devices: GOXLR.filter((device) => device.deviceId !== 'chat') });
    await h.service.setPreferredDevice('chat');
    h.service.acquire('écoute');
    await h.service.settled();
    expect(h.service.getStatus().usingFallback).toBe(true);
    h.setDevices(GOXLR);
    h.fireDeviceChange();
    await h.advance(250);
    await h.service.settled();
    expect(h.service.getStatus()).toMatchObject({ deviceId: 'chat', usingFallback: false });
  });

  it('sans devicechange (PulseAudio, certains pilotes), le contrôle toutes les 5 s suit le débranchement', async () => {
    const h = harness();
    await h.service.setPreferredDevice('chat');
    h.service.acquire('écoute');
    await h.service.settled();
    h.emit();
    expect(h.service.getStatus().deviceId).toBe('chat');

    h.setDevices(GOXLR.filter((device) => device.deviceId !== 'chat'));
    await h.advance(5_000);
    await h.service.settled();
    h.emit();
    expect(h.service.getStatus()).toMatchObject({ phase: 'open', usingFallback: true, deviceId: 'default' });
    expect(h.lines.join('\n')).toMatch(/contrôle : 2 entrées → reopen/);

    h.setDevices(GOXLR);
    await h.advance(5_000);
    await h.service.settled();
    expect(h.service.getStatus()).toMatchObject({ phase: 'open', usingFallback: false, deviceId: 'chat' });
    expect(h.lines.join('\n')).toMatch(/contrôle : 3 entrées → return-to-preferred/);
  });

  it('un changement raté garde l’ancien micro et montre la cause', async () => {
    let fail = false;
    const h = harness();
    const base = h.gum.getMockImplementation()!;
    h.gum.mockImplementation(async (constraints) => {
      if (fail) throw domError('NotReadableError', 'Could not start audio source');
      return base(constraints);
    });
    h.service.acquire('écoute');
    await h.service.settled();
    fail = true;
    await h.service.setPreferredDevice('chat');
    const status = h.service.getStatus();
    expect(status.phase).toBe('open');
    expect(status.label).toMatch(/Broadcast Stream Mix/);
    expect(status.failure).toMatchObject({ name: 'NotReadableError', message: 'Could not start audio source' });
    expect(h.tracks[0]!.stopped).toBe(false);
  });

  it('un seul flux pour plusieurs utilisateurs, fermé au dernier bail', async () => {
    const h = harness();
    const releaseListen = h.service.acquire('écoute');
    const releaseDiagnostic = h.service.acquire('diagnostic');
    await h.service.settled();
    expect(h.gum).toHaveBeenCalledTimes(1);
    releaseDiagnostic();
    expect(h.service.getStatus().phase).toBe('open');
    releaseListen();
    expect(h.service.getStatus().phase).toBe('off');
    expect(h.tracks[0]!.stopped).toBe(true);
  });

  it('sans trame reçue, relance puis déclare NoAudioError', async () => {
    const h = harness({ frames: false });
    h.service.acquire('écoute');
    await h.service.settled();
    await h.advance(4_000);
    expect(h.lines.join('\n')).toMatch(/aucune trame en 4000 ms : on relance Web Audio et on rouvre/);
    await h.service.settled();
    // Le second chien de garde tombe ~4 s après la réouverture, la reprise auto 300 ms plus tard.
    await h.advance(4_300);
    expect(h.service.getStatus().phase).toBe('error');
    expect(h.service.getStatus().failure?.name).toBe('NoAudioError');
    expect(h.gum).toHaveBeenCalledTimes(2);
  });

  it('un flux arrivé après un changement plus récent est refermé', async () => {
    let resolveFirst: ((stream: MediaStream) => void) | null = null;
    const first = new FakeTrack('Default - Mix', 'default');
    const h = harness();
    const base = h.gum.getMockImplementation()!;
    h.gum.mockImplementationOnce(() => new Promise<MediaStream>((resolve) => (resolveFirst = resolve)));
    h.gum.mockImplementation(base);
    h.service.acquire('écoute');
    await flush();
    const switched = h.service.setPreferredDevice('chat');
    await switched;
    resolveFirst!(fakeStream(first));
    await flush();
    expect(first.stopped).toBe(true);
    expect(h.service.getStatus().deviceId).toBe('chat');
  });
});
