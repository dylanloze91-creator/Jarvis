import {
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_TOTAL_TIMEOUT_MS,
  backupFrequencyOf,
  backupPeriodMs,
  buildHealthReport,
  isProbeError,
  missingModelGroups,
  modelInstalled,
  modelsToCheck,
  withModelOpens,
  type HealthFacts,
  type HealthReport,
  type ProbeError,
  type Settings,
} from '@jarvis/core';

export interface OllamaProbe {
  reachable: boolean;
  models: readonly string[];
}

export interface HealthProbeSet {
  /** Un seul appel : joignable et modèles installés. */
  ollama: (signal: AbortSignal) => Promise<OllamaProbe>;
  voiceMissing: (signal: AbortSignal) => Promise<number>;
  piperReady: (signal: AbortSignal) => Promise<boolean>;
  spotify: (signal: AbortSignal) => Promise<{ tokenOk: boolean; speakerVisible: boolean | null }>;
  google: (signal: AbortSignal) => Promise<{ connected: boolean; needsReconsent: boolean }>;
  phonePublished: (signal: AbortSignal) => Promise<boolean>;
  speakersHeard: () => Promise<boolean>;
  robotReachable: (signal: AbortSignal) => Promise<boolean>;
  printerReachable: (signal: AbortSignal) => Promise<boolean>;
  diskFree: () => Promise<number>;
  backupState: () => Promise<{ lastAt: number | null; ok: boolean }>;
  vaultReady: () => Promise<{ encryptionAvailable: boolean; unreadable: boolean }>;
  phoneEnabled: () => boolean;
  speakersEnabled: () => boolean;
  /** Lot B : faux tant qu'aucune imprimante n'est réglée. */
  printerConfigured: () => boolean;
}

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, ms: number): Promise<T | 'timeout' | ProbeError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onParent = (): void => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener('abort', onParent, { once: true });
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<'timeout'>((resolve) => {
        if (controller.signal.aborted) resolve('timeout');
        else controller.signal.addEventListener('abort', () => resolve('timeout'), { once: true });
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted || parent.aborted) return 'timeout';
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParent);
  }
}

export async function collectHealthReport(
  settings: Settings,
  probes: HealthProbeSet,
  now = Date.now(),
  limits: { each: number; total: number } = { each: HEALTH_CHECK_TIMEOUT_MS, total: HEALTH_TOTAL_TIMEOUT_MS },
): Promise<HealthReport> {
  const parent = new AbortController();
  const totalTimer = setTimeout(() => parent.abort(), limits.total);
  const duties = modelsToCheck(settings);
  const facts: HealthFacts = {
    ollama: 'skip',
    models: 'skip',
    voice: 'skip',
    piper: 'skip',
    spotify: 'skip',
    google: 'skip',
    phone: 'skip',
    speakers: 'skip',
    robot: 'skip',
    printer: 'skip',
    disk: 'skip',
    backup: 'skip',
    vault: 'skip',
    now,
  };

  const jobs: Array<Promise<void>> = [];
  const run = (job: () => Promise<void>): void => {
    jobs.push(job());
  };

  if (duties.length > 0) {
    run(async () => {
      const status = await bounded((signal) => probes.ollama(signal), parent.signal, limits.each);
      if (status === 'timeout' || isProbeError(status)) {
        facts.ollama = status;
        facts.models = status;
        return;
      }
      facts.ollama = { reachable: status.reachable };
      if (!status.reachable) {
        facts.models = 'skip';
        return;
      }
      const installedNames = new Set(duties.filter((duty) => modelInstalled(duty.name, status.models)).map((duty) => duty.name));
      facts.models = { missing: missingModelGroups(duties, installedNames) };
    });
  }

  if (settings.voice.enabled) {
    run(async () => {
      const missing = await bounded((signal) => probes.voiceMissing(signal), parent.signal, limits.each);
      facts.voice = missing === 'timeout' || isProbeError(missing) ? missing : { missing };
    });
  }
  if (settings.voice.ttsProvider === 'local-piper') {
    run(async () => {
      const ready = await bounded((signal) => probes.piperReady(signal), parent.signal, limits.each);
      facts.piper = ready === 'timeout' || isProbeError(ready) ? ready : { ready };
    });
  }
  if (settings.spotifyClientId.trim()) {
    run(async () => {
      const spotify = await bounded((signal) => probes.spotify(signal), parent.signal, limits.each);
      facts.spotify =
        spotify === 'timeout' || isProbeError(spotify)
          ? spotify
          : { tokenOk: spotify.tokenOk, speakerName: (settings.spotifyDeviceName ?? '').trim(), speakerVisible: spotify.speakerVisible };
    });
  }
  if (settings.googleClientId.trim()) {
    run(async () => {
      const google = await bounded((signal) => probes.google(signal), parent.signal, limits.each);
      facts.google = google === 'timeout' || isProbeError(google) ? google : google;
    });
  }
  if (probes.phoneEnabled()) {
    run(async () => {
      const published = await bounded((signal) => probes.phonePublished(signal), parent.signal, limits.each);
      facts.phone = published === 'timeout' || isProbeError(published) ? published : { published };
    });
  }
  if (probes.speakersEnabled()) {
    run(async () => {
      const heard = await bounded(() => probes.speakersHeard(), parent.signal, limits.each);
      facts.speakers = heard === 'timeout' || isProbeError(heard) ? heard : { heard };
    });
  }
  if ((settings.roverBaseUrl ?? '').trim()) {
    run(async () => {
      const reachable = await bounded((signal) => probes.robotReachable(signal), parent.signal, limits.each);
      facts.robot = reachable === 'timeout' || isProbeError(reachable) ? reachable : { reachable };
    });
  }
  if (probes.printerConfigured()) {
    run(async () => {
      const reachable = await bounded((signal) => probes.printerReachable(signal), parent.signal, limits.each);
      facts.printer = reachable === 'timeout' || isProbeError(reachable) ? reachable : { reachable };
    });
  }
  run(async () => {
    const free = await bounded(() => probes.diskFree(), parent.signal, limits.each);
    facts.disk = free === 'timeout' || isProbeError(free) ? free : { freeBytes: free };
  });
  if ((settings.backup?.directory ?? '').trim()) {
    run(async () => {
      const state = await bounded(() => probes.backupState(), parent.signal, limits.each);
      if (state === 'timeout' || isProbeError(state)) facts.backup = state;
      else {
        const frequency = backupFrequencyOf(settings.backup?.frequency);
        const stale = state.lastAt !== null && now - state.lastAt >= backupPeriodMs(frequency);
        facts.backup = { configured: true, lastAt: state.lastAt, ok: state.ok, stale };
      }
    });
  }
  run(async () => {
    const ready = await bounded(() => probes.vaultReady(), parent.signal, limits.each);
    facts.vault = ready === 'timeout' || isProbeError(ready) ? ready : ready;
  });

  await Promise.all(jobs);
  clearTimeout(totalTimer);
  const report = buildHealthReport(facts, now);
  const opens = duties.length
    ? report.items.filter((entry) => entry.id === 'models' && entry.level === 'red').map((entry) => entry.open)
    : [];
  return { ...report, items: withModelOpens(report.items, opens) };
}
