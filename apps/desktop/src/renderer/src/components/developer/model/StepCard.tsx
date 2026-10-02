import type { ReactNode } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FlowStatus = 'done' | 'current' | 'locked';

/** Une étape numérotée du parcours « modèle de code ». Verrouillée tant que la précédente n’est pas faite. */
export function StepCard({
  number,
  title,
  status,
  hint,
  children,
}: {
  number: number;
  title: string;
  status: FlowStatus;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={`Étape ${number} : ${title}`}
      data-flow-step={number}
      data-flow-status={status}
      className={cn(
        'flex flex-col gap-2.5 rounded-xl border px-3.5 py-3',
        status === 'current'
          ? 'border-cyan-300/25 bg-cyan-300/[0.04]'
          : 'border-white/8 bg-white/[0.02]',
      )}
    >
      <header className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            status === 'done' && 'bg-emerald-400/15 text-emerald-300',
            status === 'current' && 'bg-cyan-300/15 text-cyan-200',
            status === 'locked' && 'bg-white/5 text-slate-500',
          )}
        >
          {status === 'done' ? <CheckCircle2 className="size-4" /> : number}
        </span>
        <span
          className={cn(
            'text-[13px] font-medium',
            status === 'locked' ? 'text-slate-500' : 'text-slate-100',
          )}
        >
          {title}
        </span>
        {status === 'locked' ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
            <Lock className="size-3" /> {hint ?? 'après l’étape précédente'}
          </span>
        ) : hint ? (
          <span className="ml-auto text-[11px] text-slate-400">{hint}</span>
        ) : null}
      </header>
      {status !== 'locked' && children ? (
        <div className="flex flex-col gap-2.5 pl-8.5">{children}</div>
      ) : null}
    </section>
  );
}

export function EstimateBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300/30 bg-amber-300/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-amber-200 uppercase">
      Estimation
    </span>
  );
}

export function MeasureBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-emerald-200 uppercase">
      Mesuré
    </span>
  );
}
