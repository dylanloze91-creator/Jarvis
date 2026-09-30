/**
 * Propriétaire unique du micro dans le renderer. Un seul flux
 * `getUserMedia` à la fois, partagé par l'écoute permanente, « Tester la
 * voix », le test du mot de réveil et l'enregistrement d'échantillons.
 *
 * - ouverture mesurée étape par étape (autorisation, liste, getUserMedia,
 *   Web Audio, première trame), bornée dans le temps ;
 * - changement de micro sur place : l'ancien flux continue tant que le
 *   nouveau n'est pas ouvert ;
 * - reprise automatique si le périphérique s'arrête (`ended`), revient
 *   (`devicechange`) ou si Windows le libère plus tard ;
 * - l'échec garde le nom exact de l'erreur (`NotAllowedError`…).
 */
import {
  CAPTURE_DEVICE_LOST_ERROR,
  CAPTURE_NO_AUDIO_ERROR,
  CAPTURE_TIMEOUT_ERROR,
  CAPTURE_UNSUPPORTED_ERROR,
  actionOnDeviceChange,
  captureConstraints,
  captureFailureText,
  describeCaptureFailure,
  formatCaptureTimings,
  isSystemDefaultInput,
  recoveryDelayMs,
  redactDeviceId,
  resolveCaptureTarget,
  shouldFallbackToDefault,
  type AudioInputOption,
  type CaptureFailure,
  type CaptureStep,
  type CaptureTimings,
} from '@jarvis/core';

export type MicrophonePhase = 'off' | 'opening' | 'open' | 'recovering' | 'error';

const DEVICE_POLL_MS = 5_000;

export interface MicrophoneStatus {
  phase: MicrophonePhase;
  /** Choix enregistré (`''` = entrée par défaut de Windows). */
  preferredId: string;
  /** Périphérique réellement ouvert (identifiant Chromium). */
  deviceId: string;
  /** Libellé du périphérique réellement ouvert. */
  label: string;
  /** Le micro choisi est absent : on écoute l'entrée par défaut en attendant. */
  usingFallback: boolean;
  /** Dernier échec (ouverture ou perte). `null` si tout va bien. */
  failure: CaptureFailure | null;
  /** Durées de la dernière ouverture. */
  timings: CaptureTimings;
  /** Dernière liste d'entrées lue. */
  inputs: AudioInputOption[];
  /** Le système a coupé la piste (`mute`). */
  muted: boolean;
  /** Nombre d'ouvertures réussies depuis le démarrage. */
  opens: number;
}

export type FrameListener = (frame: Float32Array, sampleRate: number) => void;

export interface AudioGraph {
  close(): void;
  /** Relance le contexte Web Audio s'il est suspendu. */
  resume(): Promise<void>;
}

export interface MicrophoneDeps {
  mediaDevices: MediaDevicesLike | undefined;
  queryPermission: () => Promise<string>;
  openGraph: (stream: MediaStream, onFrame: FrameListener) => Promise<AudioGraph>;
  closeGraphs: () => void;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  log: (line: string) => void;
  getUserMediaTimeoutMs: number;
  enumerateTimeoutMs: number;
  firstFrameTimeoutMs: number;
}

export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  addEventListener?(type: 'devicechange', listener: () => void): void;
  removeEventListener?(type: 'devicechange', listener: () => void): void;
}

class StepError extends Error {
  constructor(
    readonly step: CaptureStep,
    readonly original: unknown,
  ) {
    super((original as Error | null)?.message ?? String(original));
    this.name = (original as Error | null)?.name ?? 'Error';
  }
}

function namedError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  deps: Pick<MicrophoneDeps, 'setTimer' | 'clearTimer'>,
  message: string,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = deps.setTimer(() => {
      if (settled) return;
      settled = true;
      reject(namedError(CAPTURE_TIMEOUT_ERROR, message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) {
          onLate?.(value);
          return;
        }
        settled = true;
        deps.clearTimer(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        deps.clearTimer(timer);
        reject(error);
      },
    );
  });
}

function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

interface OpenCapture {
  stream: MediaStream;
  graph: AudioGraph;
  track: MediaStreamTrack | null;
  deviceId: string;
  label: string;
  detach: () => void;
}

const INITIAL_STATUS: MicrophoneStatus = {
  phase: 'off',
  preferredId: '',
  deviceId: '',
  label: '',
  usingFallback: false,
  failure: null,
  timings: {},
  inputs: [],
  muted: false,
  opens: 0,
};

export class MicrophoneService {
  private status: MicrophoneStatus = { ...INITIAL_STATUS };
  private readonly statusListeners = new Set<(status: MicrophoneStatus) => void>();
  private readonly frameListeners = new Set<FrameListener>();
  private readonly leases = new Set<symbol>();
  private current: OpenCapture | null = null;
  /** Chaque ouverture reçoit un numéro ; une ouverture dépassée s'arrête d'elle-même. */
  private generation = 0;
  /** Génération du flux branché : seules ses trames sont distribuées. */
  private activeGeneration = -1;
  private opening: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private frameTimer: unknown = null;
  private recoveryAttempt = 0;
  private deviceChangeTimer: unknown = null;
  private pollTimer: unknown = null;
  private watchingDevices = false;
  private openStartedAt = 0;
  private firstFrameSeen = false;
  private firstWakeScoreSeen = false;
  private noAudioRetried = false;

  constructor(private readonly deps: MicrophoneDeps) {}

  getStatus(): MicrophoneStatus {
    return this.status;
  }

  subscribe(listener: (status: MicrophoneStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Tant qu'au moins un bail est tenu, le micro reste ouvert. */
  acquire(owner: string): () => void {
    const lease = Symbol(owner);
    const wasIdle = this.leases.size === 0;
    this.leases.add(lease);
    if (wasIdle) {
      this.watchDevices(true);
      void this.open(`ouverture (${owner})`);
      this.schedulePoll();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases.delete(lease);
      if (this.leases.size === 0) this.shutdown();
    };
  }

  /** Change de micro. Si le micro est ouvert, bascule tout de suite. */
  setPreferredDevice(deviceId: string): Promise<void> {
    const next = deviceId === 'default' ? '' : deviceId;
    if (next === this.status.preferredId) return this.opening ?? Promise.resolve();
    this.update({ preferredId: next });
    if (this.leases.size === 0) return Promise.resolve();
    this.log(`changement de micro → ${redactDeviceId(next)}`);
    return this.open('changement de micro');
  }

  /** « Réessayer » : nouvelle tentative immédiate. */
  retry(): Promise<void> {
    if (this.leases.size === 0) return Promise.resolve();
    this.recoveryAttempt = 0;
    return this.open('réessai demandé');
  }

  /** Attend la fin de l'ouverture en cours (ou immédiatement si rien n'est en cours). */
  settled(): Promise<MicrophoneStatus> {
    return (this.opening ?? Promise.resolve()).then(() => this.status);
  }

  /** Relevé du premier score du mot de réveil après une ouverture. */
  markWakeScore(): void {
    if (this.firstWakeScoreSeen || this.status.phase !== 'open') return;
    this.firstWakeScoreSeen = true;
    const firstWakeScoreMs = this.deps.now() - this.openStartedAt;
    this.update({ timings: { ...this.status.timings, firstWakeScoreMs } });
    this.log(`1er score réveil ${Math.round(firstWakeScoreMs)} ms après l'ouverture`);
  }

  /**
   * Relit la liste des entrées (libellés compris une fois l'accès donné) et,
   * si le micro est utilisé, applique les mêmes règles qu'un `devicechange`.
   */
  async refreshInputs(): Promise<AudioInputOption[]> {
    if (this.leases.size > 0) {
      await this.handleDeviceChange('actualisation');
      return this.status.inputs;
    }
    const inputs = await this.enumerate().catch(() => this.status.inputs);
    this.update({ inputs });
    return inputs;
  }

  private open(reason: string): Promise<void> {
    const generation = ++this.generation;
    this.clearRetry();
    const run = this.openNow(generation, reason).finally(() => {
      if (this.opening === run) this.opening = null;
    });
    this.opening = run;
    return run;
  }

  private async openNow(generation: number, reason: string): Promise<void> {
    const { deps } = this;
    const stale = (): boolean => generation !== this.generation || this.leases.size === 0;
    const startedAt = deps.now();
    const timings: CaptureTimings = {};
    const switching = this.current !== null;
    if (!switching) this.update({ phase: this.status.phase === 'recovering' ? 'recovering' : 'opening' });
    this.log(`${reason} : demandé ${redactDeviceId(this.status.preferredId)}`);

    if (!deps.mediaDevices?.getUserMedia) {
      this.fail(generation, new StepError('getUserMedia', namedError(CAPTURE_UNSUPPORTED_ERROR, 'navigator.mediaDevices absent')), timings);
      return;
    }

    const permissionAt = deps.now();
    const permission = deps
      .queryPermission()
      .catch(() => 'inconnu')
      .then((state) => {
        timings.permission = state;
        timings.permissionMs = deps.now() - permissionAt;
      });

    const enumerateAt = deps.now();
    let inputs = this.status.inputs;
    try {
      inputs = await withTimeout(this.enumerate(), deps.enumerateTimeoutMs, deps, 'enumerateDevices sans réponse');
      timings.enumerateMs = deps.now() - enumerateAt;
      timings.inputCount = inputs.length;
    } catch (error) {
      timings.enumerateMs = deps.now() - enumerateAt;
      this.log(`liste des entrées illisible (${(error as Error).name}) : on tente quand même`);
    }
    if (stale()) return;

    const preferred = this.status.preferredId;
    let target = resolveCaptureTarget(inputs, preferred);
    const gumAt = deps.now();
    let stream: MediaStream;
    try {
      stream = await this.getUserMedia(target.deviceId);
    } catch (error) {
      const name = (error as Error | null)?.name ?? 'Error';
      if (!stale() && shouldFallbackToDefault(name, target.deviceId)) {
        this.log(`${name} sur ${redactDeviceId(target.deviceId)} : repli sur l'entrée par défaut`);
        target = { deviceId: '', fallback: true };
        try {
          stream = await this.getUserMedia('');
        } catch (fallbackError) {
          timings.getUserMediaMs = deps.now() - gumAt;
          await permission;
          this.fail(generation, new StepError('getUserMedia', fallbackError), timings);
          return;
        }
      } else {
        timings.getUserMediaMs = deps.now() - gumAt;
        await permission;
        this.fail(generation, new StepError('getUserMedia', error), timings);
        return;
      }
    }
    timings.getUserMediaMs = deps.now() - gumAt;
    if (stale()) {
      stopStream(stream);
      return;
    }

    const track = stream.getAudioTracks?.()[0] ?? null;
    const settings = track?.getSettings?.() ?? {};
    const deviceId = settings.deviceId ?? target.deviceId;
    const label = track?.label || inputs.find((input) => input.deviceId === deviceId)?.label || '';

    const graphAt = deps.now();
    let graph: AudioGraph;
    try {
      graph = await deps.openGraph(stream, (frame, rate) => this.deliver(generation, frame, rate));
    } catch (error) {
      stopStream(stream);
      timings.graphMs = deps.now() - graphAt;
      await permission;
      this.fail(generation, new StepError('audio-graph', error), timings, label);
      return;
    }
    timings.graphMs = deps.now() - graphAt;
    if (stale()) {
      graph.close();
      stopStream(stream);
      return;
    }
    await permission;

    const previous = this.current;
    this.current = { stream, graph, track, deviceId, label, detach: () => undefined };
    this.current.detach = this.watchTrack(generation, track);
    this.activeGeneration = generation;
    this.firstFrameSeen = false;
    this.firstWakeScoreSeen = false;
    if (previous) {
      previous.detach();
      previous.graph.close();
      stopStream(previous.stream);
    }

    this.openStartedAt = startedAt;
    this.recoveryAttempt = 0;
    this.update({
      phase: 'open',
      deviceId,
      label,
      usingFallback: target.fallback,
      failure: null,
      timings,
      inputs,
      muted: track?.muted ?? false,
      opens: this.status.opens + 1,
    });
    this.log(
      `ouvert « ${label || 'sans nom'} » (${redactDeviceId(deviceId)})${target.fallback ? ' — repli : micro choisi absent' : ''} · ${formatCaptureTimings(timings)}`,
    );
    this.armFirstFrameWatchdog(generation);
  }

  private async getUserMedia(deviceId: string): Promise<MediaStream> {
    const { deps } = this;
    return withTimeout(
      deps.mediaDevices!.getUserMedia({ audio: captureConstraints(deviceId) as MediaTrackConstraints }),
      deps.getUserMediaTimeoutMs,
      deps,
      `getUserMedia sans réponse après ${Math.round(deps.getUserMediaTimeoutMs / 1000)} s`,
      (late) => stopStream(late),
    );
  }

  private async enumerate(): Promise<AudioInputOption[]> {
    const devices = (await this.deps.mediaDevices?.enumerateDevices?.()) ?? [];
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  }

  private deliver(generation: number, frame: Float32Array, sampleRate: number): void {
    if (generation !== this.activeGeneration) return;
    if (!this.firstFrameSeen && this.status.phase === 'open') {
      this.firstFrameSeen = true;
      this.noAudioRetried = false;
      this.clearFrameTimer();
      const firstFrameMs = this.deps.now() - this.openStartedAt;
      this.update({ timings: { ...this.status.timings, firstFrameMs } });
      this.log(`1re trame ${Math.round(firstFrameMs)} ms après le début de l'ouverture`);
    }
    for (const listener of this.frameListeners) listener(frame, sampleRate);
  }

  private armFirstFrameWatchdog(generation: number): void {
    this.clearFrameTimer();
    this.frameTimer = this.deps.setTimer(() => {
      if (generation !== this.generation || this.firstFrameSeen || this.leases.size === 0) return;
      const label = this.status.label;
      if (!this.noAudioRetried) {
        this.noAudioRetried = true;
        this.log(`aucune trame en ${this.deps.firstFrameTimeoutMs} ms : on relance Web Audio et on rouvre`);
        void this.current?.graph.resume().catch(() => undefined);
        void this.open('aucune trame reçue');
        return;
      }
      this.noAudioRetried = false;
      this.releaseCurrent();
      this.fail(
        generation,
        new StepError('first-frame', namedError(CAPTURE_NO_AUDIO_ERROR, `aucune trame en ${this.deps.firstFrameTimeoutMs} ms`)),
        this.status.timings,
        label,
      );
    }, this.deps.firstFrameTimeoutMs);
  }

  private watchTrack(generation: number, track: MediaStreamTrack | null): () => void {
    if (!track?.addEventListener) return () => undefined;
    const onEnded = (): void => {
      if (generation !== this.generation || this.leases.size === 0) return;
      this.log(`piste terminée (« ${this.status.label || 'micro'} » débranché, en veille ou pilote relancé)`);
      const failure = describeCaptureFailure(
        namedError(CAPTURE_DEVICE_LOST_ERROR, 'MediaStreamTrack ended'),
        'device-lost',
        this.status.label,
      );
      this.releaseCurrent();
      this.update({ phase: 'recovering', failure });
      this.scheduleRetry();
    };
    const onMute = (): void => {
      if (generation !== this.generation) return;
      this.log('piste coupée par le système (mute)');
      this.update({ muted: true });
    };
    const onUnmute = (): void => {
      if (generation !== this.generation) return;
      this.log('piste rétablie (unmute)');
      this.update({ muted: false });
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    track.addEventListener('unmute', onUnmute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
      track.removeEventListener('unmute', onUnmute);
    };
  }

  private fail(generation: number, error: StepError, timings: CaptureTimings, label = ''): void {
    if (generation !== this.generation || this.leases.size === 0) return;
    const failure = describeCaptureFailure(error.original, error.step, label);
    const keptLabel = this.current?.label ?? '';
    this.log(
      `échec à l'étape ${error.step} : ${failure.name}${failure.message ? ` : ${failure.message}` : ''} · ${formatCaptureTimings(timings)}`,
    );
    if (this.current) {
      // Le micro précédent continue : on ne coupe pas l'écoute pour un changement raté.
      this.update({ failure, timings });
      this.log(`l'écoute continue sur « ${keptLabel || 'le micro précédent'} »`);
      return;
    }
    this.update({ phase: 'error', failure, timings });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (this.leases.size === 0) return;
    const delay = recoveryDelayMs(this.recoveryAttempt);
    this.recoveryAttempt += 1;
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      if (this.leases.size === 0) return;
      void this.open(`reprise automatique n°${this.recoveryAttempt}`);
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.deps.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private clearFrameTimer(): void {
    if (this.frameTimer !== null) this.deps.clearTimer(this.frameTimer);
    this.frameTimer = null;
  }

  private readonly onDeviceChange = (): void => {
    if (this.deviceChangeTimer !== null) this.deps.clearTimer(this.deviceChangeTimer);
    this.deviceChangeTimer = this.deps.setTimer(() => {
      this.deviceChangeTimer = null;
      void this.handleDeviceChange('devicechange');
    }, 250);
  };

  private async handleDeviceChange(source: 'devicechange' | 'contrôle' | 'actualisation'): Promise<void> {
    const inputs = await this.enumerate().catch(() => this.status.inputs);
    this.update({ inputs });
    if (this.opening) return;
    const action = actionOnDeviceChange({
      phase: this.status.phase,
      inputs,
      preferredId: this.status.preferredId,
      openedId: this.status.deviceId,
      openedLabel: this.status.label,
      usingFallback: this.status.usingFallback,
    });
    // Le contrôle périodique ne réessaie pas un échec : la reprise a son propre rythme.
    if (source === 'contrôle' && (action === 'none' || action === 'retry')) return;
    this.log(`${source} : ${inputs.length} entrées → ${action}`);
    if (action === 'none' || this.leases.size === 0) return;
    this.recoveryAttempt = 0;
    void this.open(
      action === 'return-to-preferred' ? 'micro choisi revenu' : action === 'reopen' ? 'micro ouvert disparu' : 'périphériques changés',
    );
  }

  /**
   * Certains pilotes (et Chromium sous Linux avec PulseAudio) ne signalent
   * pas `devicechange` : la liste est relue toutes les 5 s tant que le micro
   * sert, avec les mêmes règles.
   */
  private schedulePoll(): void {
    if (this.pollTimer !== null || this.leases.size === 0) return;
    this.pollTimer = this.deps.setTimer(() => {
      this.pollTimer = null;
      if (this.leases.size === 0) return;
      void this.handleDeviceChange('contrôle').finally(() => this.schedulePoll());
    }, DEVICE_POLL_MS);
  }

  private watchDevices(on: boolean): void {
    const media = this.deps.mediaDevices;
    if (!media?.addEventListener || on === this.watchingDevices) return;
    this.watchingDevices = on;
    if (on) media.addEventListener('devicechange', this.onDeviceChange);
    else media.removeEventListener?.('devicechange', this.onDeviceChange);
  }

  private releaseCurrent(): void {
    const current = this.current;
    this.current = null;
    this.activeGeneration = -1;
    this.clearFrameTimer();
    if (!current) return;
    current.detach();
    current.graph.close();
    stopStream(current.stream);
  }

  private shutdown(): void {
    this.generation += 1;
    this.clearRetry();
    if (this.deviceChangeTimer !== null) this.deps.clearTimer(this.deviceChangeTimer);
    this.deviceChangeTimer = null;
    if (this.pollTimer !== null) this.deps.clearTimer(this.pollTimer);
    this.pollTimer = null;
    this.watchDevices(false);
    this.releaseCurrent();
    this.deps.closeGraphs();
    this.noAudioRetried = false;
    this.update({ phase: 'off', deviceId: '', label: '', failure: null, muted: false, usingFallback: false });
    this.log('micro fermé');
  }

  private update(patch: Partial<MicrophoneStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }

  private log(line: string): void {
    this.deps.log(line);
  }
}

/** Texte d'un échec pour la barre vocale, le tableau de bord et le diagnostic. */
export function microphoneFailureText(status: MicrophoneStatus): string | null {
  return status.failure ? captureFailureText(status.failure) : null;
}

export function isDefaultPreferred(status: MicrophoneStatus): boolean {
  return isSystemDefaultInput(status.preferredId);
}
