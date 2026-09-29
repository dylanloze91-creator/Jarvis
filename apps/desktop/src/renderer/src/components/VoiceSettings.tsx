import { WHISPER_MODEL_REPO, openWakeWordSensitivityToThreshold } from '@jarvis/core';
import type { VoiceDescriptor, VoiceSettings } from '@jarvis/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Input, Range, Select, Textarea, Toggle } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { listMicrophones } from '@/voice/audioCapture';
import { VoiceDiagnostic } from '@/components/VoiceDiagnostic';
import { createSttRegistry, createTtsRegistry } from '@/voice/registries';
import {
  importWakeWordProfilesFromAudioFile,
  recordWakeWordProfile,
  startWakeWordTest,
  type WakeWordTestHandle,
} from '@/voice/trainWakeWord';
import {
  describeWhisperProgress,
  getWhisperPipeline,
  lastWhisperProgress,
  subscribeWhisperProgress,
  type WhisperLoadProgress,
} from '@/voice/whisper/pipelineLoader';

interface VoiceSettingsSectionProps {
  voice: VoiceSettings;
  voiceKeyConfigured: boolean;
  onChange: (patch: Partial<VoiceSettings>) => void;
}

type RecordingState = 'idle' | 'recording' | 'error';

const MIN_SAMPLES_RECOMMENDED = 3;

/**
 * Section « Commande vocale » des réglages. Un seul mot de réveil
 * (openWakeWord + « Jarvis » nu confirmé par Whisper) et un seul Whisper
 * local ; « Tester la voix » vérifie toute la chaîne sur ce PC.
 */
export function VoiceSettingsSection({
  voice,
  voiceKeyConfigured,
  onChange,
}: VoiceSettingsSectionProps) {
  const sttRegistry = useMemo(() => createSttRegistry(), []);
  const ttsRegistry = useMemo(() => createTtsRegistry(), []);

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [recording, setRecording] = useState<RecordingState>('idle');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [ttsVoices, setTtsVoices] = useState<VoiceDescriptor[]>([]);

  const [testing, setTesting] = useState(false);
  const [testScore, setTestScore] = useState(0);
  const [testFlash, setTestFlash] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const testHandleRef = useRef<WakeWordTestHandle | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const usingLocalWhisperStt = voice.sttProvider === 'local-whisper';
  const sampleCount = voice.wakeWordProfiles.length;
  const threshold = openWakeWordSensitivityToThreshold(voice.wakeWordSensitivity);

  const [whisperProgress, setWhisperProgress] = useState<WhisperLoadProgress | null>(
    () => lastWhisperProgress(),
  );
  useEffect(() => subscribeWhisperProgress(setWhisperProgress), []);

  useEffect(() => {
    void listMicrophones()
      .then(setMicrophones)
      .catch(() => setMicrophones([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const provider = ttsRegistry.create({ provider: voice.ttsProvider });
    void provider.listVoices().then((list) => {
      if (!cancelled) setTtsVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, [voice.ttsProvider, ttsRegistry]);

  // Coupe le test en cours si l'utilisateur change de panneau ou d'onglet.
  useEffect(() => {
    return () => {
      testHandleRef.current?.stop();
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const addSample = async (): Promise<void> => {
    setRecording('recording');
    setImportError(null);
    try {
      const profile = await recordWakeWordProfile(voice.microphoneId || undefined);
      onChange({ wakeWordProfiles: [...voice.wakeWordProfiles, profile.envelope] });
      setRecording('idle');
    } catch {
      setRecording('error');
    }
  };

  const importSamples = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setImporting(true);
    setImportError(null);
    const added: number[][] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const profiles = await importWakeWordProfilesFromAudioFile(file);
        added.push(...profiles.map((profile) => profile.envelope));
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (added.length > 0) {
      onChange({ wakeWordProfiles: [...voice.wakeWordProfiles, ...added] });
    }
    if (failures.length > 0) setImportError(failures.join(' '));
    setImporting(false);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const resetSamples = (): void => {
    onChange({ wakeWordProfiles: [] });
  };

  const toggleTest = async (): Promise<void> => {
    if (testing) {
      testHandleRef.current?.stop();
      testHandleRef.current = null;
      setTesting(false);
      return;
    }

    setTestError(null);
    setTestScore(0);
    try {
      const handle = await startWakeWordTest(
        voice.microphoneId || undefined,
        {
          keyword: voice.wakeWord,
          variants: voice.wakeWordVariants,
          sensitivity: voice.wakeWordSensitivity,
          detectorConfig:
            voice.wakeWordProfiles.length > 0
              ? {
                  profiles: voice.wakeWordProfiles.map((envelope) => ({ envelope })),
                  matchStrategy: voice.wakeWordMatchStrategy,
                }
              : null,
        },
        (score, detected) => {
          setTestScore(score);
          if (detected) {
            setTestFlash(true);
            if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
            flashTimerRef.current = window.setTimeout(() => setTestFlash(false), 600);
          }
        },
        (message) => setTestError(message),
      );
      testHandleRef.current = handle;
      setTesting(true);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex flex-col gap-4 border-t border-white/8 pt-4">
      <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        Commande vocale
      </p>

      <Toggle
        label="Écoute permanente"
        hint="Jarvis écoute en continu et n'envoie rien avant d'avoir détecté le mot de réveil, localement."
        checked={voice.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      <VoiceDiagnostic voice={voice} />

      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
        <p className="mb-3 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          Mot de réveil
        </p>

        <div className="flex flex-col gap-3">
          <p className="text-xs leading-snug text-slate-500">
            Local et gratuit : openWakeWord reconnaît « Hey Jarvis », et un déclencheur
            « Jarvis » tout court tourne à côté (tes échantillons, confirmés par Whisper).
            Aucune clé, aucun compte, aucun audio ne quitte le PC.
          </p>

          <WhisperModelStatus progress={whisperProgress} />

          <Field label="Mot de réveil">
            <Input
              value={voice.wakeWord}
              onChange={(event) => onChange({ wakeWord: event.target.value })}
            />
          </Field>

          <Field
            label="Variantes orthographiques supplémentaires (une par ligne)"
            hint="En plus des variantes déjà connues (« jarviss », « djarvis », « j'avise »…) et de la tolérance automatique aux petites fautes de transcription."
          >
            <Textarea
              rows={2}
              value={voice.wakeWordVariants.join('\n')}
              onChange={(event) =>
                onChange({
                  wakeWordVariants: event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0),
                })
              }
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                Sensibilité
              </span>
              <span className="text-xs text-slate-400">
                {Math.round(voice.wakeWordSensitivity * 100)}% · seuil {Math.round(threshold * 100)}%
              </span>
            </div>
            <Range
              min={0}
              max={100}
              value={Math.round(voice.wakeWordSensitivity * 100)}
              onChange={(event) =>
                onChange({ wakeWordSensitivity: Number(event.target.value) / 100 })
              }
            />
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Stricte (peu de faux positifs)</span>
              <span>Sensible (se déclenche facilement)</span>
            </div>
          </div>

          <Field label="Comparaison des échantillons">
            <Select
              value={voice.wakeWordMatchStrategy}
              onChange={(event) =>
                onChange({
                  wakeWordMatchStrategy: event.target.value as VoiceSettings['wakeWordMatchStrategy'],
                })
              }
            >
              <option value="best">Meilleur gabarit (tolère la variabilité entre essais)</option>
              <option value="average">Moyenne des gabarits (lisse le bruit)</option>
            </Select>
          </Field>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
            <div>
              <p className="text-sm text-slate-200">
                {sampleCount} échantillon{sampleCount === 1 ? '' : 's'} enregistré
                {sampleCount === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-slate-500">
                {sampleCount === 0
                  ? 'Dis « Jarvis » au micro, ou importe un WAV/MP3 : ça sert au déclencheur « Jarvis » tout court.'
                  : sampleCount < MIN_SAMPLES_RECOMMENDED
                    ? `Recommandé : au moins ${MIN_SAMPLES_RECOMMENDED} échantillons.`
                    : 'Assez de prises pour le déclencheur « Jarvis ».'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {sampleCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetSamples}
                  disabled={recording === 'recording' || importing}
                >
                  Effacer
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="subtle"
                onClick={() => importInputRef.current?.click()}
                disabled={recording === 'recording' || importing}
              >
                {importing ? 'Import…' : 'Importer WAV / MP3'}
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => void addSample()}
                disabled={recording === 'recording' || importing}
              >
                {recording === 'recording' ? 'Dis « ' + voice.wakeWord + ' »…' : 'Ajouter un échantillon'}
              </Button>
            </div>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="audio/wav,audio/mpeg,audio/mp3,.wav,.mp3"
            multiple
            className="hidden"
            onChange={(event) => void importSamples(event.target.files)}
          />
          {recording === 'error' ? (
            <p className="text-xs text-rose-300">
              Impossible d'accéder au microphone (normal sur une machine sans micro).
            </p>
          ) : null}
          {importError ? <p className="text-xs text-rose-300">{importError}</p> : null}

          <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-200">Tester la détection</p>
                <p className="text-xs text-slate-500">
                  Dis « Jarvis » : le score openWakeWord doit dépasser le seuil, ou le
                  déclencheur « Jarvis » tout court s’allume.
                </p>
              </div>
              <Button size="sm" variant={testing ? 'danger' : 'subtle'} onClick={() => void toggleTest()}>
                {testing ? 'Arrêter le test' : 'Tester'}
              </Button>
            </div>
            {testing ? <ScoreMeter score={testScore} threshold={threshold} flash={testFlash} /> : null}
            {testError ? <p className="text-xs text-rose-300">{testError}</p> : null}
          </div>
        </div>
      </div>

      <Field
        label="Microphone"
        hint="La liste se remplit après la première autorisation d'accès au micro."
      >
        <Select
          value={voice.microphoneId}
          onChange={(event) => onChange({ microphoneId: event.target.value })}
        >
          <option value="">Périphérique par défaut</option>
          {microphones.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label || 'Microphone'}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Moteur de reconnaissance vocale (STT)"
        hint="Whisper local est le moteur gratuit par défaut : whisper-base et son runtime WebAssembly sont embarqués dans l’installateur, hors ligne. Le même Whisper sert au mot de réveil et à l’écoute YouTube."
      >
        <Select
          value={voice.sttProvider}
          onChange={(event) => onChange({ sttProvider: event.target.value })}
        >
          {sttRegistry.list().map((descriptor) => (
            <option key={descriptor.id} value={descriptor.id}>
              {descriptor.label}
              {descriptor.requiresApiKey && !voiceKeyConfigured ? ' — clé requise' : ''}
            </option>
          ))}
        </Select>
      </Field>
      {!usingLocalWhisperStt ? (
        <p className="-mt-2 text-xs text-slate-500">
          Le mot de réveil et YouTube utilisent toujours le Whisper local.
        </p>
      ) : null}

      <Toggle
        label="Réponse vocale"
        hint="Jarvis lit ses réponses à voix haute avec les voix du système (Windows/SAPI), gratuitement — même pour un message tapé."
        checked={voice.ttsEnabled}
        onChange={(ttsEnabled) => onChange({ ttsEnabled })}
      />

      {voice.ttsEnabled ? (
        <>
          <Field label="Moteur de synthèse vocale (TTS)">
            <Select
              value={voice.ttsProvider}
              onChange={(event) => onChange({ ttsProvider: event.target.value, ttsVoice: '' })}
            >
              {ttsRegistry.list().map((descriptor) => (
                <option key={descriptor.id} value={descriptor.id}>
                  {descriptor.label}
                  {descriptor.requiresApiKey && !voiceKeyConfigured
                    ? ' — clé requise, repli local'
                    : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Voix">
            <Select
              value={voice.ttsVoice}
              onChange={(event) => onChange({ ttsVoice: event.target.value })}
            >
              <option value="">Voix par défaut</option>
              {ttsVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}

      <Field
        label="Clé API OpenAI dédiée à la voix (optionnel)"
        hint="Laisse vide pour réutiliser la clé du fournisseur OpenAI ci-dessus, si configuré. Facultative : toute la chaîne vocale par défaut fonctionne sans elle."
      >
        <Input
          type="password"
          value={voice.apiKey}
          placeholder="sk-…"
          onChange={(event) => onChange({ apiKey: event.target.value })}
        />
      </Field>
    </div>
  );
}

/**
 * Statut du Whisper embarqué (chargé une fois en mémoire, partagé par la
 * dictée, le mot de réveil et YouTube). Le bouton le prépare à l'avance.
 */
function WhisperModelStatus({ progress }: { progress: WhisperLoadProgress | null }) {
  const [preparing, setPreparing] = useState(false);

  const prepare = async (): Promise<void> => {
    setPreparing(true);
    try {
      await getWhisperPipeline({ force: true });
    } catch {
      // L'erreur est déjà remontée via subscribeWhisperProgress (status 'error').
    } finally {
      setPreparing(false);
    }
  };

  const percent = progress?.status === 'loading' && progress.stage === 'files' ? Math.round(progress.progress ?? 0) : null;
  const failed = progress?.status === 'error';

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200">Whisper local ({WHISPER_MODEL_REPO})</p>
        <p className={failed ? 'text-xs break-words text-rose-300' : 'truncate text-xs text-slate-500'}>
          {progress ? describeWhisperProgress(progress) : 'Pas encore chargé.'}
        </p>
        {percent !== null ? (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="subtle"
        onClick={() => void prepare()}
        disabled={preparing || progress?.status === 'loading'}
      >
        {progress?.status === 'ready' ? 'Prêt' : failed ? 'Réessayer' : 'Préparer maintenant'}
      </Button>
    </div>
  );
}

function ScoreMeter({
  score,
  threshold,
  flash,
}: {
  score: number;
  threshold: number;
  flash: boolean;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const thresholdPercent = Math.round(Math.min(1, Math.max(0, threshold)) * 100);
  const passed = score >= threshold;

  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ${
            flash ? 'bg-emerald-400' : passed ? 'bg-accent' : 'bg-white/30'
          }`}
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-0 h-full w-px bg-rose-300/80"
          style={{ left: `${thresholdPercent}%` }}
          title="Seuil de déclenchement"
        />
      </div>
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>Score : {percent}%</span>
        <span>{flash ? 'Détecté !' : `Seuil : ${thresholdPercent}%`}</span>
      </div>
    </div>
  );
}
