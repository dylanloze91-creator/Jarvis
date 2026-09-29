import { AlertCircle, Ear, Mic, Square, Volume2 } from 'lucide-react';
import type { UseVoiceResult } from '@/voice/useVoice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { voiceBarStatusLines } from '@/components/voiceBarStatus';

interface VoiceBarProps {
  voice: UseVoiceResult;
  voiceEnabled: boolean;
}

/**
 * Retour visuel de la commande vocale sous le champ de saisie : état
 * d'écoute, niveau sonore, transcription en direct, et bouton pour couper
 * la réponse parlée. Aucun champ de texte ici : le seul champ est celui du
 * composer.
 */
export function VoiceBar({ voice, voiceEnabled }: VoiceBarProps) {
  if (!voiceEnabled) {
    return (
      <div className="voice-strip">
        <span>
          <Mic className="size-3" /> Commande vocale désactivée
        </span>
      </div>
    );
  }

  const lines = voiceBarStatusLines({
    state: voice.state,
    micError: voice.micError,
    whisperStatus: voice.whisperStatus,
    liveTranscript: voice.liveTranscript,
  });
  const active = voice.state === 'listening' || voice.state === 'speaking';

  return (
    <div className="voice-strip voice-strip-active">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <StateIcon state={voice.state} />
        <span
          className={cn(
            'flex min-w-0 flex-1 flex-col text-[12px]',
            voice.state === 'listening' && 'text-cyan-200',
            voice.state === 'speaking' && 'text-cyan-200',
            voice.state === 'sleeping' && 'text-slate-500',
            voice.state === 'idle' && 'text-slate-500',
            lines.primaryIsError && 'text-rose-300',
          )}
        >
          <span className={lines.primaryIsError ? 'break-words' : 'truncate'}>{lines.primary}</span>
          {lines.detail ? (
            <span
              className={cn(
                'break-words text-[11px]',
                lines.detailIsError ? 'text-rose-300/90' : 'text-slate-500',
              )}
            >
              {lines.detail}
            </span>
          ) : null}
        </span>
      </div>
      {active ? <LevelMeter level={voice.level} /> : null}
      {voice.state === 'speaking' ? (
        <Button size="icon" variant="subtle" title="Couper la réponse" onClick={voice.stopSpeaking}>
          <Square className="size-3 fill-current" />
        </Button>
      ) : null}
    </div>
  );
}

function StateIcon({ state }: { state: UseVoiceResult['state'] }) {
  const common = 'size-3.5 shrink-0';
  if (state === 'listening') return <Mic className={cn(common, 'animate-pulse text-cyan-300')} />;
  if (state === 'speaking') return <Volume2 className={cn(common, 'text-cyan-200')} />;
  if (state === 'sleeping') return <Ear className={cn(common, 'text-slate-500')} />;
  if (state === 'error') return <AlertCircle className={cn(common, 'text-rose-400')} />;
  return <Mic className={cn(common, 'text-slate-600')} />;
}

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="level-meter" aria-hidden>
      {[0.15, 0.3, 0.5, 0.75].map((threshold, index) => (
        <span
          key={index}
          className={level >= threshold ? 'on' : ''}
          style={{ height: `${5 + index * 3}px` }}
        />
      ))}
    </div>
  );
}
