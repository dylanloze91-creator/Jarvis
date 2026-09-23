import { useEffect, useMemo, useState } from 'react';
import type { VoiceDescriptor, VoiceSettings } from '@jarvis/core';
import { Field, Input, Select, Toggle } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { listMicrophones } from '@/voice/audioCapture';
import { createSttRegistry, createTtsRegistry } from '@/voice/registries';
import { recordWakeWordProfile } from '@/voice/trainWakeWord';

interface VoiceSettingsSectionProps {
  voice: VoiceSettings;
  voiceKeyConfigured: boolean;
  onChange: (patch: Partial<VoiceSettings>) => void;
}

type TrainingState = 'idle' | 'recording' | 'done' | 'error';

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

  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [training, setTraining] = useState<TrainingState>('idle');
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

  const trainWakeWord = async (): Promise<void> => {
    setTraining('recording');
    try {
      const profile = await recordWakeWordProfile(voice.microphoneId || undefined);
      onChange({ wakeWordProfile: profile.envelope });
      setTraining('done');
    } catch {
      setTraining('error');
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

      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <div>
          <p className="text-sm text-slate-200">Calibrer le mot de réveil</p>
          <p className="text-xs text-slate-500">
            {voice.wakeWordProfile.length > 0
              ? 'Gabarit enregistré localement.'
              : "Aucun gabarit : dis le mot de réveil pendant l'enregistrement."}
          </p>
        </div>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => void trainWakeWord()}
          disabled={training === 'recording'}
        >
          {training === 'recording' ? 'Enregistrement…' : 'Enregistrer un échantillon'}
        </Button>
      </div>
      {training === 'error' ? (
        <p className="text-xs text-rose-300">
          Impossible d'accéder au microphone (normal sur une machine sans micro).
        </p>
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
