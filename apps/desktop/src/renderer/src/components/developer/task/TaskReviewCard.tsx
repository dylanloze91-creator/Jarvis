import { AlertTriangle, Info, Lightbulb, ShieldAlert } from 'lucide-react';
import type { CodeTaskState } from '../../../../../shared/developerIpc';
import { cn } from '@/lib/utils';

const BUCKET_LABEL: Record<string, string> = {
  bloquant: 'Bloquant',
  important: 'Important',
  mineur: 'Mineur',
  suggestion: 'Suggestion',
};

const BUCKET_ICON = {
  bloquant: ShieldAlert,
  important: AlertTriangle,
  mineur: Info,
  suggestion: Lightbulb,
} as const;

/** Revue structurée du REVIEWER (affichée dans le panneau Tâche). */
export function TaskReviewCard({ task }: { task: CodeTaskState }) {
  const review = task.review;
  if (!review?.findings?.length && !review?.summary) return null;
  const groups = ['bloquant', 'important', 'mineur', 'suggestion'] as const;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
      data-task-review
    >
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-slate-100">Revue du diff</span>
        {review.verdict ? (
          <span className="text-[11px] text-slate-400">verdict : {review.verdict}</span>
        ) : null}
        {review.blocking.length ? (
          <span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] text-rose-200">
            {review.blocking.length} bloquant(s) — Appliquer refusé
          </span>
        ) : null}
      </header>
      <p className="text-[12px] text-slate-300">{review.summary}</p>
      {groups.map((bucket) => {
        const items = review.findings.filter((f) => f.bucket === bucket);
        if (!items.length) return null;
        const Icon = BUCKET_ICON[bucket];
        return (
          <div key={bucket} className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {BUCKET_LABEL[bucket]}
            </span>
            <ul className="flex flex-col gap-1">
              {items.map((item, index) => (
                <li
                  key={`${bucket}-${index}`}
                  className={cn(
                    'flex gap-2 rounded-md px-2 py-1 text-[11px]',
                    bucket === 'bloquant' ? 'bg-rose-400/10 text-rose-100' : 'bg-white/[0.03] text-slate-300',
                  )}
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {item.file ? (
                      <span className="font-mono text-slate-400">
                        {item.file}
                        {item.line ? `:${item.line}` : ''} —{' '}
                      </span>
                    ) : null}
                    {item.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
