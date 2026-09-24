import { WHISPER_STT_MODELS, WHISPER_WAKE_WORD_MODEL, sensitivityToThreshold } from '@jarvis/core';
import type { VoiceDescriptor, VoiceSettings } from '@jarvis/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Input, Range, Select, Textarea, Toggle } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { listMicrophones } from '@/voice/audioCapture';
import {
  createSttRegistry,
  createTtsRegistry,
  createWakeWordEngineRegistry,
} from '@/voice/registries';
import {
  recordWakeWordProfile,
  startWakeWordTest,
  type WakeWordTestHandle,
} from '@/voice/trainWakeWord';
import {
  describeWhisperProgress,
  getWhisperPipeline,
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
 * Section « Commande vocale » des réglages. Chaque sélecteur de moteur lit
 * directement les registres assemblés dans `voice/registries.ts` : ajouter
 * un moteur à ces registres le fait apparaître ici sans aucun autre
 * changement d'interface.
 */
export function VoiceSettingsSection({
  voice,
  voiceKeyConfigured,
  onChange,
}: VoiceSettingsSectionProps) {
  const sttRegistry = useMemo(() => createSttRegistry(), []);
  const ttsRegistry = useMemo(() => createTtsRegistry(), []);
  const wakeWordRegistry = useMemo(() => createWakeWordEngineRegistry(), []);

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [recording, setRecording] = useState<RecordingState>('idle');
  const [ttsVoices, setTtsVoices] = useState<VoiceDescriptor[]>([]);

  const [testing, setTesting] = useState(false);
  const [testScore, setTestScore] = useState(0);
  const [testFlash, setTestFlash] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const testHandleRef = useRef<WakeWordTestHandle | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const usingPorcupine = voice.wakeWordEngine === 'porcupine';
  const usingWhisperWakeWord = voice.wakeWordEngine === 'whisper-transcript';
  const usingLocalTemplate = voice.wakeWordEngine === 'local-template';
  const usingLocalWhisperStt = voice.sttProvider === 'local-whisper';
  const sampleCount = voice.wakeWordProfiles.length;
  const threshold = sensitivityToThreshold(voice.wakeWordSensitivity);
  const selectedSttModel =
    WHISPER_STT_MODELS.find((model) => model.id === voice.sttModel) ?? WHISPER_STT_MODELS[1]!;

  const [whisperProgress, setWhisperProgress] = useState<Record<string, WhisperLoadProgress>>({});
  useEffect(() => {
    return subscribeWhisperProgress((info) => {
      setWhisperProgress((current) => ({ ...current, [info.repo]: info }));
    });
  }, []);

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
    try {
      const profile = await recordWakeWordProfile(voice.microphoneId || undefined);
      onChange({ wakeWordProfiles: [...voice.wakeWordProfiles, profile.envelope] });
      setRecording('idle');
    } catch {
      setRecording('error');
    }
  };

  const clearSamples = (): void => {
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
        voice.wakeWordProfiles.length > 0
          ? {
              profiles: voice.wakeWordProfiles.map((envelope) => ({ envelope })),
              matchStrategy: voice.wakeWordMatchStrategy,
            }
          : null,
        voice.wakeWordSensitivity,
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

      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
        <p className="mb-3 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          Mot de réveil — calibration guidée
        </p>

        <div className="flex flex-col gap-3">
          <Field label="Moteur de détection">
            <Select
              value={voice.wakeWordEngine}
              onChange={(event) => onChange({ wakeWordEngine: event.target.value })}
            >
              {wakeWordRegistry.list().map((descriptor) => (
                <option key={descriptor.id} value={descriptor.id}>
                  {descriptor.label}
                </option>
              ))}
            </Select>
          </Field>

          {usingPorcupine ? (
            <>
              <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
                Porcupine reconnaît « jarvis » sans calibration, mais sa formule personnelle{' '}
                <strong>n'est plus gratuite depuis le 30 juin 2026</strong> (Picovoice a mis fin à
                son offre gratuite et n'a pas prévu de palier non commercial). Une carte bancaire et
                un abonnement payant sont nécessaires pour obtenir une clé valide — voir le README
                pour le détail. Sans clé, l'application repasse automatiquement sur Whisper local.
              </p>
              <Field label="Clé d'accès Picovoice">
                <Input
                  type="password"
                  value={voice.wakeWordAccessKey}
                  placeholder="AccessKey Picovoice…"
                  onChange={(event) => onChange({ wakeWordAccessKey: event.target.value })}
                />
              </Field>
            </>
          ) : usingLocalTemplate ? (
            <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100">
              Gratuit, sans compte, mais <strong>peu fiable</strong> : ce moteur ne compare que le
              volume du son dans le temps, sans aucune analyse de la parole elle-même — il rate
              souvent la détection en conditions réelles. Whisper local (moteur par défaut) est
              recommandé à la place.
            </p>
          ) : (
            <p className="text-xs leading-snug text-slate-500">
              Gratuit, sans compte : Whisper (le même modèle local que pour la dictée, mais toujours
              le plus petit qui fonctionne correctement) transcrit de courtes fenêtres audio en
              continu et cherche le mot de réveil dans le texte obtenu. C'est le moteur par défaut
              de l'application — aucun audio ne quitte jamais la machine.
            </p>
          )}

          {usingWhisperWakeWord ? (
            <WhisperModelStatus
              label="Modèle du mot de réveil (toujours le plus petit qui fonctionne)"
              repo={WHISPER_WAKE_WORD_MODEL.repo}
              progress={whisperProgress[WHISPER_WAKE_WORD_MODEL.repo]}
            />
          ) : null}

          {!usingPorcupine ? (
            <Field label="Mot de réveil">
              <Input
                value={voice.wakeWord}
                onChange={(event) => onChange({ wakeWord: event.target.value })}
              />
            </Field>
          ) : null}

          {usingWhisperWakeWord ? (
            <Field
              label="Variantes orthographiques supplémentaires (une par ligne)"
              hint="En plus des variantes déjà connues (« jarviss », « djarvis »…) et de la tolérance automatique aux petites fautes de transcription. Utile pour un mot de réveil personnalisé mal reconnu."
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
          ) : null}

          {!usingPorcupine ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  Sensibilité
                </span>
                <span className="text-xs text-slate-400">
                  {Math.round(voice.wakeWordSensitivity * 100)}%
                  {usingLocalTemplate ? ` · seuil ${Math.round(threshold * 100)}%` : ''}
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
                <span>
                  {usingWhisperWakeWord
                    ? 'Économe en CPU (moins réactif)'
                    : 'Stricte (peu de faux positifs)'}
                </span>
                <span>
                  {usingWhisperWakeWord
                    ? 'Réactif (analyse plus souvent, plus de CPU)'
                    : 'Sensible (se déclenche facilement)'}
                </span>
              </div>
            </div>
          ) : null}

          {usingLocalTemplate ? (
            <>
              <Field label="Comparaison des échantillons">
                <Select
                  value={voice.wakeWordMatchStrategy}
                  onChange={(event) =>
                    onChange({
                      wakeWordMatchStrategy: event.target
                        .value as VoiceSettings['wakeWordMatchStrategy'],
                    })
                  }
                >
                  <option value="best">
                    Meilleur gabarit (tolère la variabilité entre essais)
                  </option>
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
                      ? "Aucun gabarit : dis le mot de réveil pendant l'enregistrement."
                      : sampleCount < MIN_SAMPLES_RECOMMENDED
                        ? `Recommandé : au moins ${MIN_SAMPLES_RECOMMENDED} échantillons pour bien couvrir ta voix.`
                        : 'Bonne base : tu peux tester la détection ci-dessous.'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {sampleCount > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearSamples}
                      disabled={recording === 'recording'}
                    >
                      Effacer
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={() => void addSample()}
                    disabled={recording === 'recording'}
                  >
                    {recording === 'recording'
                      ? 'Dis « ' + voice.wakeWord + ' »…'
                      : 'Ajouter un échantillon'}
                  </Button>
                </div>
              </div>
              {recording === 'error' ? (
                <p className="text-xs text-rose-300">
                  Impossible d'accéder au microphone (normal sur une machine sans micro).
                </p>
              ) : null}

              <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-200">Tester la détection</p>
                    <p className="text-xs text-slate-500">
                      Dis le mot de réveil et observe le score : il doit dépasser le seuil pour
                      déclencher.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={testing ? 'danger' : 'subtle'}
                    onClick={() => void toggleTest()}
                  >
                    {testing ? 'Arrêter le test' : 'Tester'}
                  </Button>
                </div>
                {testing ? (
                  <ScoreMeter score={testScore} threshold={threshold} flash={testFlash} />
                ) : null}
                {testError ? <p className="text-xs text-rose-300">{testError}</p> : null}
              </div>
            </>
          ) : null}
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
        hint="Whisper local (transformers.js, WebAssembly/WebGPU) est le moteur gratuit par défaut : aucune clé, hors ligne après le premier téléchargement du modèle. La reconnaissance intégrée du navigateur a été retirée : elle ne fonctionne structurellement pas dans Electron (dépend de serveurs Google absents des builds Electron)."
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

      {usingLocalWhisperStt ? (
        <>
          <Field
            label="Taille du modèle Whisper (dictée)"
            hint={`${selectedSttModel.sizeLabel} · ${selectedSttModel.speedLabel}`}
          >
            <Select
              value={voice.sttModel}
              onChange={(event) =>
                onChange({ sttModel: event.target.value as VoiceSettings['sttModel'] })
              }
            >
              {WHISPER_STT_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} — {model.sizeLabel}
                </option>
              ))}
            </Select>
          </Field>
          <WhisperModelStatus
            label={`Modèle de dictée (${selectedSttModel.label})`}
            repo={selectedSttModel.repo}
            progress={whisperProgress[selectedSttModel.repo]}
          />
        </>
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
        hint="Laisse vide pour réutiliser la clé du fournisseur OpenAI ci-dessus, si configuré. Facultative : toute la chaîne vocale par défaut (mot de réveil + réponse) fonctionne sans elle."
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
 * Statut de chargement d'un modèle Whisper (téléchargé au premier usage,
 * mis en cache localement ensuite — voir `whisper/pipelineLoader.ts`).
 * Le bouton permet de le préparer à l'avance, plutôt que de découvrir le
 * téléchargement au premier « Jarvis » prononcé.
 */
function WhisperModelStatus({
  label,
  repo,
  progress,
}: {
  label: string;
  repo: string;
  progress?: WhisperLoadProgress;
}) {
  const [preparing, setPreparing] = useState(false);

  const prepare = async (): Promise<void> => {
    setPreparing(true);
    try {
      await getWhisperPipeline(repo);
    } catch {
      // L'erreur est déjà remontée via subscribeWhisperProgress (status 'error').
    } finally {
      setPreparing(false);
    }
  };

  const percent = progress?.status === 'loading' ? Math.round(progress.progress ?? 0) : null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200">{label}</p>
        <p className="truncate text-xs text-slate-500">
          {progress ? describeWhisperProgress(progress) : `${repo} — pas encore préparé`}
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
        {progress?.status === 'ready' ? 'Prêt' : 'Préparer maintenant'}
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
