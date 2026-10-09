import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { setupGuideImageUrl } from '@/setupGuide/setupGuideImages';
import { SETUP_GUIDE_STEPS } from '@/setupGuide/setupGuideSteps';
import { cn } from '@/lib/utils';

interface SetupGuideViewProps {
  onClose: () => void;
}

/** Tuto image pas à pas (Ollama, Spotify, Google) — ouverture manuelle uniquement. */
export function SetupGuideView({ onClose }: SetupGuideViewProps) {
  const [index, setIndex] = useState(0);
  const step = SETUP_GUIDE_STEPS[index]!;
  const total = SETUP_GUIDE_STEPS.length;
  const imageSrc = useMemo(() => setupGuideImageUrl(step.image), [step.image]);

  const go = (next: number): void => {
    setIndex(Math.max(0, Math.min(total - 1, next)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-300/80">Comment tout brancher</p>
          <h2 className="text-lg font-semibold text-slate-50">{step.section}</h2>
          <p className="text-xs text-slate-400">
            Étape {step.id} · {index + 1} / {total}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="no-drag shrink-0" onClick={onClose}>
          <X className="size-4" /> Fermer
        </Button>
      </div>

      <p className="text-[15px] leading-snug text-slate-100">{step.text}</p>

      <div
        className={cn(
          'no-drag min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/30',
          'flex items-center justify-center p-2',
        )}
      >
        <img
          src={imageSrc}
          alt={`Schéma étape ${step.id}`}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-3">
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronLeft className="size-4" /> Précédent
        </Button>
        {index < total - 1 ? (
          <Button type="button" size="sm" onClick={() => go(index + 1)}>
            Suivant <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onClose}>
            Terminer
          </Button>
        )}
      </div>
    </div>
  );
}
