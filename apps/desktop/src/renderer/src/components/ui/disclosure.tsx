import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Bloc repliable (replié par défaut) pour les détails techniques. */
export function Disclosure({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn('group rounded-lg border border-white/8 bg-white/[0.02]', className)}>
      <summary className="no-drag flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{title}</span>
          {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-white/8 px-3 py-3">{children}</div>
    </details>
  );
}
