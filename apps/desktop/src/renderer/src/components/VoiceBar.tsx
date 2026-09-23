import { AlertCircle, Ear, Mic, Send, Square, Volume2 } from 'lucide-react';
import { useState } from 'react';
import type { UseVoiceResult } from '@/voice/useVoice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VoiceBarProps {
  voice: UseVoiceResult;
  voiceEnabled: boolean;
}

const STATE_LABEL: Record<UseVoiceResult['state'], string> = {
  idle: 'Commande vocale désactivée',
  sleeping: 'En veille — dis « Jarvis »',
  listening: 'À l’écoute…',
  speaking: 'Jarvis parle…',
  error: 'Micro indisponible',
};

/**
 * Retour visuel de la commande vocale : état d'écoute, niveau sonore,
 * transcription en direct, et bouton pour couper la réponse parlée. Le champ
 * de simulation reste toujours accessible : c'est la façon de démontrer le
 * chemin voix → conversation → réponse sur une machine sans microphone.
 */
export function VoiceBar({ voice, voiceEnabled }: VoiceBarProps) {
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const active = voice.state === 'listening' || voice.state === 'speaking';
  const showSimulate = simulateOpen || voice.micError !== null;

  const submitSimulation = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    voice.simulate(trimmed);
    setDraft('');
  };

  if (!voiceEnabled && !showSimulate) {
    return (
      <div className="no-drag flex items-center justify-between border-t border-white/8 px-3 py-1.5">
        <span className="text-[11px] text-slate-500">Commande vocale désactivée</span>
        <button
          type="button"
          onClick={() => setSimulateOpen(true)}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/8 hover:text-slate-200"
        >
          <Mic className="size-3" />
          Simuler une commande vocale
        </button>
      </div>
    );
  }

  return (
    <div className="no-drag flex flex-col gap-1.5 border-t border-white/8 px-3 py-2">
      <div className="flex items-center gap-2">
        <StateIcon state={voice.state} />
        <span
          className={cn(
            'flex-1 truncate text-[12px]',
            voice.state === 'listening' && 'text-accent',
            voice.state === 'speaking' && 'text-slate-200',
            voice.state === 'sleeping' && 'text-slate-500',
            voice.state === 'idle' && 'text-slate-500',
            voice.state === 'error' && 'text-rose-300',
          )}
        >
          {voice.micError ?? (voice.liveTranscript || STATE_LABEL[voice.state])}
        </span>

        {active ? <LevelMeter level={voice.level} /> : null}

        {voice.state === 'speaking' ? (
          <Button
            size="icon"
            variant="subtle"
            title="Couper la réponse"
            onClick={voice.stopSpeaking}
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => setSimulateOpen((value) => !value)}
            title="Simuler une commande vocale"
            className="rounded-full p-1.5 text-slate-500 transition-colors hover:bg-white/8 hover:text-slate-200"
          >
            <Mic className="size-3.5" />
          </button>
        )}
      </div>

      {showSimulate ? (
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitSimulation();
            }}
            placeholder="Écrire ce que tu « dirais » à Jarvis…"
            className="h-7 flex-1 rounded-full border border-white/10 bg-black/25 px-3 text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-accent/60"
          />
          <Button
            size="icon"
            variant="subtle"
            onClick={submitSimulation}
            title="Envoyer comme entrée vocale"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StateIcon({ state }: { state: UseVoiceResult['state'] }) {
  const common = 'size-3.5 shrink-0';
  switch (state) {
    case 'listening':
      return <Mic className={cn(common, 'animate-pulse text-accent')} />;
    case 'speaking':
      return <Volume2 className={cn(common, 'text-slate-200')} />;
    case 'sleeping':
      return <Ear className={cn(common, 'text-slate-500')} />;
    case 'error':
      return <AlertCircle className={cn(common, 'text-rose-400')} />;
    default:
      return <Mic className={cn(common, 'text-slate-600')} />;
  }
}

function LevelMeter({ level }: { level: number }) {
  const bars = [0.15, 0.3, 0.5, 0.75];
  return (
    <div className="flex items-end gap-0.5" aria-hidden>
      {bars.map((threshold, index) => (
        <span
          key={index}
          className={cn(
            'w-0.5 rounded-full bg-white/15 transition-colors',
            level >= threshold && 'bg-accent',
          )}
          style={{ height: `${6 + index * 3}px` }}
        />
      ))}
    </div>
  );
}
