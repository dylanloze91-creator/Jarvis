import { chooseMicrophone, microphoneOptionLabel, type VoiceSettings } from '@jarvis/core';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ClipboardCopy,
  FileAudio,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { prepareMicrophoneList } from '@/voice/audioCapture';
import {
  DIAGNOSTIC_STEPS,
  formatDiagnosticReport,
  runVoiceDiagnostic,
  type DiagnosticStatus,
  type DiagnosticStep,
  type VoiceDiagnosticResult,
} from '@/voice/voiceDiagnostic';
import {
  analyzeAudioFile,
  createVoiceDiagnosticDeps,
  type AudioFileAnalysis,
} from '@/voice/voiceDiagnosticRuntime';

const initialSteps = (): DiagnosticStep[] =>
  DIAGNOSTIC_STEPS.map((step) => ({ ...step, status: 'pending' }));

/**
 * « Tester la voix » : vérifie chaque maillon (fichiers, protocole,
 * WebAssembly, openWakeWord, Whisper, micro) et affiche la première étape
 * en échec. « Copier le détail » donne le texte à renvoyer.
 */
export function VoiceDiagnostic({
  voice,
  onMicrophoneChange,
}: {
  voice: VoiceSettings;
  onMicrophoneChange?: (microphoneId: string) => void;
}) {
  const [steps, setSteps] = useState<DiagnosticStep[]>(initialSteps);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<VoiceDiagnosticResult | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [files, setFiles] = useState<AudioFileAnalysis[]>([]);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const runId = useRef(0);
  const deviceIdRef = useRef(voice.microphoneId);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [pickedId, setPickedId] = useState(voice.microphoneId);

  useEffect(() => {
    let cancelled = false;
    void prepareMicrophoneList()
      .then((list) => {
        if (cancelled) return;
        setDevices(list);
        const choice = chooseMicrophone(
          list.map((device) => ({ deviceId: device.deviceId, label: device.label })),
          voice.microphoneId,
        );
        if (!choice) return;
        setPickedId(choice.deviceId);
        deviceIdRef.current = choice.deviceId;
      })
      .catch(() => {
        if (!cancelled) setDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [voice.microphoneId]);

  const listenLocked = steps.some((step) => step.id === 'microphone' && step.status !== 'pending');
  const picked = devices.find((device) => device.deviceId === pickedId);

  const start = async (): Promise<void> => {
    const id = runId.current + 1;
    runId.current = id;
    setRunning(true);
    setCopied(false);
    setResult(null);
    setSteps(initialSteps());
    try {
      const outcome = await runVoiceDiagnostic(
        createVoiceDiagnosticDeps(
          voice,
          (message) => {
            if (runId.current === id) setPrompt(message);
          },
          () => deviceIdRef.current || undefined,
        ),
        (next) => {
          if (runId.current === id) setSteps(next);
        },
      );
      if (runId.current === id) setResult(outcome);
    } finally {
      if (runId.current === id) {
        setRunning(false);
        setPrompt(null);
      }
    }
  };

  const copy = async (): Promise<void> => {
    if (!result) return;
    await window.jarvis.voice.copyReport(formatDiagnosticReport(result, files));
    setCopied(true);
  };

  const analyzeFiles = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    setFileBusy(true);
    setFileError(null);
    try {
      for (const file of Array.from(list)) {
        const analysis = await analyzeAudioFile(file, voice);
        setFiles((current) => [...current, analysis]);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    } finally {
      setFileBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const failure = result?.firstFailure ?? null;
  const allGood = result !== null && failure === null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3" data-testid="voice-diagnostic">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-200">Tester la voix</p>
          <p className="text-xs leading-snug text-slate-500">
            Vérifie les fichiers, le moteur, Whisper et le micro, puis t’écoute une phrase. Tu pourras copier le détail.
          </p>
        </div>
        <Button size="sm" variant={running ? 'ghost' : 'default'} onClick={() => void start()} disabled={running}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {running ? 'Test en cours…' : result ? 'Relancer' : 'Tester la voix'}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5" data-testid="voice-diagnostic-device">
        <label className="text-xs text-slate-400" htmlFor="voice-diagnostic-mic">
          Micro utilisé pour l’écoute
        </label>
        <Select
          id="voice-diagnostic-mic"
          value={pickedId}
          disabled={running && listenLocked}
          onChange={(event) => {
            const id = event.target.value;
            setPickedId(id);
            deviceIdRef.current = id;
            onMicrophoneChange?.(id);
          }}
        >
          {pickedId === '' ? <option value="">Périphérique par défaut de Windows</option> : null}
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {microphoneOptionLabel(device.label)}
              {device.deviceId === pickedId ? ' — en cours' : ''}
            </option>
          ))}
        </Select>
        <p className="text-xs leading-snug text-slate-500">
          {picked
            ? `L’étape d’écoute ouvrira « ${picked.label.trim() || 'ce périphérique'} ». Un mixage (Broadcast Stream Mix, Stereo Mix, mixage stéréo) est conservé s’il est choisi ou s’il est l’entrée par défaut de Windows.`
            : 'Choisis le périphérique avant l’étape d’écoute. Le choix est mémorisé avec les réglages.'}
        </p>
      </div>

      {prompt ? (
        <p className="rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100" role="status">
          {prompt}
        </p>
      ) : null}

      {failure ? (
        <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs leading-snug text-rose-100" role="alert">
          <p className="font-medium">Échec à l’étape « {failure.label} »</p>
          <p className="mt-0.5 text-rose-200/90">{failure.summary}</p>
        </div>
      ) : null}
      {allGood ? (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100" role="status">
          Toutes les étapes sont passées : la voix fonctionne sur ce PC.
        </p>
      ) : null}

      <ol className="flex flex-col gap-1.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-2 text-xs">
            <StatusIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <p className={cn('text-slate-300', step.status === 'failed' && 'text-rose-200')}>
                {step.label}
                {step.durationMs !== undefined && step.status !== 'skipped' ? (
                  <span className="text-slate-500"> · {(step.durationMs / 1000).toFixed(1).replace('.', ',')} s</span>
                ) : null}
              </p>
              {step.summary ? (
                <p className={cn('break-words text-slate-500', step.status === 'failed' && 'text-rose-300/90')}>
                  {step.summary}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {files.length > 0 ? (
        <ul className="flex flex-col gap-1.5" data-testid="voice-diagnostic-files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
              <p className="text-slate-300">
                {file.name} · {file.durationS.toFixed(1).replace('.', ',')} s ·{' '}
                <span className={file.analysis.detected ? 'text-emerald-300' : 'text-amber-300'}>
                  {file.analysis.detected ? 'réveil reconnu' : 'réveil non reconnu'}
                </span>
              </p>
              <p className="text-slate-500">
                openWakeWord {file.analysis.wakeWordScore.toFixed(2)} (seuil {file.analysis.wakeWordThreshold.toFixed(2)}) ·
                « Jarvis » nu {file.analysis.bareJarvisConfirmed ? 'confirmé' : 'non confirmé'}
                {file.analysis.bareJarvisText !== null ? ` (Whisper : « ${file.analysis.bareJarvisText} »)` : ''}
              </p>
              <p className="break-words text-slate-400">« {file.analysis.transcript || '(rien)'} »</p>
            </li>
          ))}
        </ul>
      ) : null}
      {fileError ? <p className="text-xs text-rose-300">{fileError}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {copied ? <span className="text-xs text-emerald-300">Copié dans le presse-papiers.</span> : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileInput.current?.click()}
          disabled={running || fileBusy}
        >
          {fileBusy ? <Loader2 className="size-3.5 animate-spin" /> : <FileAudio className="size-3.5" />}
          {fileBusy ? 'Analyse…' : 'Analyser un fichier audio'}
        </Button>
        {result ? (
          <Button size="sm" variant="subtle" onClick={() => void copy()}>
            <ClipboardCopy className="size-3.5" />
            Copier le détail
          </Button>
        ) : null}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="audio/wav,audio/mpeg,audio/mp3,.wav,.mp3"
        multiple
        className="hidden"
        data-testid="voice-diagnostic-file"
        onChange={(event) => void analyzeFiles(event.target.files)}
      />
    </div>
  );
}

function StatusIcon({ status }: { status: DiagnosticStatus }) {
  const common = 'mt-px size-3.5 shrink-0';
  if (status === 'ok') return <CheckCircle2 className={cn(common, 'text-emerald-400')} aria-label="OK" />;
  if (status === 'failed') return <XCircle className={cn(common, 'text-rose-400')} aria-label="Échec" />;
  if (status === 'warning') return <AlertTriangle className={cn(common, 'text-amber-300')} aria-label="À vérifier" />;
  if (status === 'running') return <Loader2 className={cn(common, 'animate-spin text-cyan-300')} aria-label="En cours" />;
  if (status === 'skipped') return <MinusCircle className={cn(common, 'text-slate-600')} aria-label="Non lancée" />;
  return <CircleDashed className={cn(common, 'text-slate-600')} aria-label="En attente" />;
}
