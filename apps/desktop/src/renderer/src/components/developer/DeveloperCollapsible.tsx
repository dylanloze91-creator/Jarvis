import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Bloc repliable (session) dans l’onglet Développeur. */
export function DeveloperCollapsible({
  title,
  open,
  onToggle,
  children,
  dataAttr,
  headerExtra,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  dataAttr?: string;
  headerExtra?: ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-black/10"
      data-dev-collapsible={dataAttr}
      data-dev-collapsible-open={open ? 'yes' : 'no'}
    >
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="no-drag flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-slate-400 transition-transform', !open && '-rotate-90')}
          />
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</span>
        </button>
        {headerExtra}
      </div>
      {open ? (
        <div className="developer-collapsible-body max-h-[min(28vh,220px)] overflow-y-auto px-2 pb-2">
          {children}
        </div>
      ) : null}
    </section>
  );
}
