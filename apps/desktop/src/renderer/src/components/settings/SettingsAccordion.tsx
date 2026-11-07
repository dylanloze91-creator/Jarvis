import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SettingsAccordion({
  id,
  title,
  hint,
  open,
  onToggle,
  highlight,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={`settings-section-${id}`}
      data-settings-section={id}
      className={cn(
        'flex flex-col gap-1 rounded-xl border bg-white/[0.02]',
        highlight ? 'border-accent/40 ring-1 ring-accent/20' : 'border-white/8',
      )}
    >
      <button
        type="button"
        className="no-drag flex w-full items-start gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronDown
          className={cn('mt-0.5 size-3.5 shrink-0 text-slate-400 transition-transform', !open && '-rotate-90')}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium text-slate-200">{title}</span>
          {hint ? <span className="text-[11px] leading-snug text-slate-500">{hint}</span> : null}
        </span>
      </button>
      {open ? <div className="flex flex-col gap-4 border-t border-white/8 px-3 py-3">{children}</div> : null}
    </section>
  );
}
