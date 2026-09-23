import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const control =
  'no-drag w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/25';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-9 py-0', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'resize-none', className)} {...props} />;
}

export function Range({ className, style, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type="range"
      className={cn(
        'no-drag h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10',
        className,
      )}
      style={{ accentColor: 'var(--color-accent)', ...style }}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(control, 'h-9 py-0', className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs leading-snug text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="no-drag flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-slate-200">{label}</span>
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-white/15',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white transition-all',
            checked ? 'left-4.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
