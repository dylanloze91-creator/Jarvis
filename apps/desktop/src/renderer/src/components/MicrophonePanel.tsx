import {
  COMMUNICATIONS_INPUT_ID,
  DEFAULT_INPUT_ID,
  captureFailureCause,
  computeRms,
  formatSeconds,
  microphoneOptionLabel,
} from '@jarvis/core';
import { AlertTriangle, CheckCircle2, Loader2, MicOff, RefreshCw, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { microphone } from '@/voice/audioCapture';
import type { MicrophoneStatus } from '@/voice/microphone';

const TEST_MS = 6_000;

/**
 * Choix du micro. Le choix s'applique tout de suite (sans « Enregistrer »),
 * la ligne d'état montre le périphérique réellement ouvert et le temps mis,
 * et un échec donne le nom exact de l'erreur et quoi faire.
 */
export function MicrophonePanel({
  voiceEnabled,
  preferredId,
  onChange,
}: {
  voiceEnabled: boolean;
  preferredId: string;
  onChange: (deviceId: string) => void;
}) {
  const [status, setStatus] = useState<MicrophoneStatus>(() => microphone.getStatus());
  const [level, setLevel] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [testing, setTesting] = useState(false);
  const levelRef = useRef(0);
  const testRelease = useRef<(() => void) | null>(null);

  useEffect(() => microphone.subscribe(setStatus), []);
  useEffect(() => {
    void microphone.refreshInputs();
  }, []);
  useEffect(() => {
    const off = microphone.onFrame((frame) => {
      levelRef.current = Math.max(computeRms(frame), levelRef.current * 0.6);
    });
    const timer = window.setInterval(() => setLevel(levelRef.current), 150);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, []);
  useEffect(
    () => () => {
      testRelease.current?.();
      testRelease.current = null;
    },
    [],
  );

  const choose = async (deviceId: string): Promise<void> => {
    onChange(deviceId);
    setSwitching(true);
    try {
      await microphone.setPreferredDevice(deviceId);
    } finally {
      setSwitching(false);
    }
  };

  const test = (): void => {
    if (testRelease.current) return;
    setTesting(true);
    void microphone.setPreferredDevice(preferredId);
    testRelease.current = microphone.acquire('test du micro');
    window.setTimeout(() => {
      testRelease.current?.();
      testRelease.current = null;
      setTesting(false);
    }, TEST_MS);
  };

  const inputs = status.inputs.filter(
    (input) => input.deviceId && input.deviceId !== DEFAULT_INPUT_ID && input.deviceId !== COMMUNICATIONS_INPUT_ID,
  );
  const defaultEntry = status.inputs.find((input) => input.deviceId === DEFAULT_INPUT_ID);
  const listedPreferred = !preferredId || preferredId === DEFAULT_INPUT_ID || inputs.some((input) => input.deviceId === preferredId);
  const active = status.phase !== 'off';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-3" data-testid="microphone-panel">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-medium tracking-wide text-slate-500 uppercase" htmlFor="jarvis-microphone">
          Micro
        </label>
        <Button size="sm" variant="ghost" onClick={() => void microphone.refreshInputs()} title="Relire la liste des entrées">
          <RefreshCw className="size-3.5" /> Actualiser
        </Button>
      </div>
      <Select
        id="jarvis-microphone"
        value={preferredId === DEFAULT_INPUT_ID ? '' : preferredId}
        onChange={(event) => void choose(event.target.value)}
      >
        <option value="">
          Entrée par défaut de Windows{defaultEntry?.label ? ` (${defaultEntry.label.replace(/^[^-]{1,24}\s-\s/, '')})` : ''}
        </option>
        {inputs.map((input) => (
          <option key={input.deviceId} value={input.deviceId}>
            {microphoneOptionLabel(input.label)}
          </option>
        ))}
        {!listedPreferred ? <option value={preferredId}>Micro choisi (non branché)</option> : null}
      </Select>

      <MicrophoneStatusLine status={status} switching={switching} level={level} voiceEnabled={voiceEnabled} />

      {!voiceEnabled && !active ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Écoute coupée : le micro n’est ouvert que pendant un test.</p>
          <Button size="sm" variant="subtle" onClick={test} disabled={testing}>
            {testing ? 'Test…' : 'Tester ce micro'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MicrophoneStatusLine({
  status,
  switching,
  level,
  voiceEnabled,
}: {
  status: MicrophoneStatus;
  switching: boolean;
  level: number;
  voiceEnabled: boolean;
}) {
  const failure = status.failure;
  if (status.phase === 'off') {
    return voiceEnabled ? <p className="text-xs text-slate-500">Micro fermé.</p> : null;
  }
  if (status.phase === 'opening' || (switching && status.phase !== 'error')) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-cyan-200" role="status">
        <Loader2 className="size-3.5 animate-spin" /> Ouverture du micro…
      </p>
    );
  }
  if (status.phase === 'error' || status.phase === 'recovering') {
    return (
      <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs leading-snug text-rose-100" role="alert">
        <p className="flex items-center gap-1.5 font-medium">
          <MicOff className="size-3.5" />
          {status.phase === 'recovering' ? 'Micro perdu — reprise automatique…' : (failure?.title ?? 'Micro en erreur')}
        </p>
        {failure ? (
          <>
            <p className="mt-1 font-mono text-[11px] break-words text-rose-200/90">{captureFailureCause(failure)}</p>
            <p className="mt-1 text-rose-100/90">{failure.action}</p>
          </>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="subtle" onClick={() => void microphone.retry()}>
            Réessayer
          </Button>
          {failure?.privacySettings ? (
            <Button size="sm" variant="ghost" onClick={() => void window.jarvis.voice.openMicrophonePrivacy()}>
              <Settings2 className="size-3.5" /> Ouvrir les réglages Windows
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  const opened = status.timings.getUserMediaMs;
  const firstFrame = status.timings.firstFrameMs;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-xs text-emerald-200" role="status" data-testid="microphone-opened">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          Ouvert : « {status.label || 'micro sans nom'} »
          {opened !== undefined ? ` en ${formatSeconds(opened)}` : ''}
          {firstFrame !== undefined ? ` · son reçu à ${formatSeconds(firstFrame)}` : ''}
        </span>
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-label="Niveau du micro">
        <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-150" style={{ width: `${Math.min(100, Math.round(level * 400))}%` }} />
      </div>
      {status.usingFallback ? (
        <p className="text-xs text-amber-200">
          Le micro choisi n’est pas branché : écoute sur l’entrée par défaut de Windows. Il sera repris dès qu’il revient.
        </p>
      ) : null}
      {status.muted ? <p className="text-xs text-amber-200">Le système a coupé ce micro (mute).</p> : null}
      {failure ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-200" role="alert">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span className="break-words">
            {failure.title} ({captureFailureCause(failure)}). {failure.action} L’écoute continue sur « {status.label || 'le micro précédent'} ».
          </span>
        </p>
      ) : null}
    </div>
  );
}
