import { useEffect, useMemo, useState } from 'react';
import { thresholdForSensitivity, type VoiceDescriptor, type VoiceSettings } from '@jarvis/core';
import { Trash2 } from 'lucide-react';
import { Field, Input, Select, Toggle } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { listMicrophones } from '@/voice/audioCapture';
import { createSttRegistry, createTtsRegistry } from '@/voice/registries';
import { recordWakeWordSample } from '@/voice/trainWakeWord';

interface VoiceSettingsSectionProps {
  voice: VoiceSettings;
  voiceKeyConfigured: boolean;
  /** Score de détection en direct (0 à 1), affiché pour aider au réglage. */
  wakeWordScore: number;
  onChange: (patch: Partial<VoiceSettings>) => void;
}

/** Trois prononciations suffisent à couvrir les variations habituelles de voix. */
const RECOMMENDED_SAMPLES = 3;

/**
 * Section « Commande vocale » des réglages. Chaque sélecteur de moteur lit
 * directement les registres assemblés dans `voice/registries.ts` : ajouter
 * un moteur à ces registres le fait apparaître ici sans aucun autre
 * changement d'interface.
 */
export function VoiceSettingsSection({
  voice,
  voiceKeyConfigured,
  wakeWordScore,
  onChange,
}: VoiceSettingsSectionProps) {
  const sttRegistry = useMemo(() => createSttRegistry(), []);
  const ttsRegistry = useMemo(() => createTtsRegistry(), []);

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<VoiceDescriptor[]>([]);

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

  const addSample = async (): Promise<void> => {
    setRecording(true);
    setRecordError(null);
    try {
      const envelope = await recordWakeWordSample(voice.microphoneId || undefined, (progress) =>
        setRecordingLevel(progress.level),
      );
      onChange({ wakeWordProfiles: [...voice.wakeWordProfiles, envelope] });
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : String(error));
    } finally {
      setRecording(false);
      setRecordingLevel(0);
    }
  };

  const sampleCount = voice.wakeWordProfiles.length;
  const threshold = thresholdForSensitivity(voice.wakeWordSensitivity);

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

      <Field label="Mot de réveil">
        <Input
          value={voice.wakeWord}
          onChange={(event) => onChange({ wakeWord: event.target.value })}
        />
      </Field>

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

      <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-200">Calibrer le mot de réveil</p>
            <p className="text-xs leading-snug text-slate-500">
              {sampleCount === 0
                ? `Dis « ${voice.wakeWord} » à chaque enregistrement. ${RECOMMENDED_SAMPLES} échantillons recommandés.`
                : `${sampleCount} échantillon${sampleCount > 1 ? 's' : ''} enregistré${sampleCount > 1 ? 's' : ''}${
                    sampleCount < RECOMMENDED_SAMPLES
                      ? ` — ${RECOMMENDED_SAMPLES - sampleCount} de plus pour une détection fiable.`
                      : '.'
                  }`}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {sampleCount > 0 ? (
              <Button
                size="icon"
                variant="ghost"
                title="Effacer les échantillons"
                onClick={() => onChange({ wakeWordProfiles: [] })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="subtle"
              onClick={() => void addSample()}
              disabled={recording}
            >
              {recording ? 'Parle…' : 'Enregistrer'}
            </Button>
          </div>
        </div>

        {recording ? <Meter value={recordingLevel * 4} tone="accent" /> : null}

        {recordError ? <p className="text-xs text-rose-300">{recordError}</p> : null}
      </div>

      <Field
        label="Sensibilité de la détection"
        hint="Vers la droite, Jarvis se réveille plus facilement mais se trompe plus souvent."
      >
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={voice.wakeWordSensitivity}
          onChange={(event) => onChange({ wakeWordSensitivity: Number(event.target.value) })}
          className="no-drag w-full accent-[var(--color-accent)]"
        />
      </Field>

      {voice.enabled && sampleCount > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Correspondance en direct</span>
            <span className="font-mono">
              {Math.round(wakeWordScore * 100)} % / {Math.round(threshold * 100)} %
            </span>
          </div>
          <Meter value={wakeWordScore} marker={threshold} tone="accent" />
          <p className="text-xs leading-snug text-slate-500">
            Dis le mot de réveil : si la barre ne franchit pas le repère, augmente la sensibilité ou
            ajoute un échantillon.
          </p>
        </div>
      ) : null}

      <Field label="Moteur de reconnaissance vocale (STT)">
        <Select
          value={voice.sttProvider}
          onChange={(event) => onChange({ sttProvider: event.target.value })}
        >
          {sttRegistry.list().map((descriptor) => (
            <option key={descriptor.id} value={descriptor.id}>
              {descriptor.label}
              {descriptor.requiresApiKey && !voiceKeyConfigured
                ? ' — clé requise, repli local'
                : ''}
            </option>
          ))}
        </Select>
      </Field>

      <Toggle
        label="Réponse vocale"
        hint="Jarvis lit ses réponses à voix haute, même pour un message tapé."
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
        hint="Laisse vide pour réutiliser la clé du fournisseur OpenAI ci-dessus, si configuré."
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

/** Barre de niveau, avec un repère optionnel matérialisant le seuil. */
function Meter({ value, marker, tone }: { value: number; marker?: number; tone: 'accent' }) {
  const width = `${Math.min(100, Math.max(0, value * 100))}%`;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={tone === 'accent' ? 'h-full rounded-full bg-accent transition-[width]' : ''}
        style={{ width }}
      />
      {marker !== undefined ? (
        <span
          className="absolute top-0 h-full w-px bg-white/60"
          style={{ left: `${Math.min(100, Math.max(0, marker * 100))}%` }}
        />
      ) : null}
    </div>
  );
}
