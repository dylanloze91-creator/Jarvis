import type { CodeTaskState } from '../../../../../shared/developerIpc';

/** Passages du manuel technique consultés pour la tâche en cours. */
export function ManualPassagesCard({ task }: { task: CodeTaskState }) {
  const passages = task.manualPassages;
  if (!passages?.length) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-cyan-400/15 bg-cyan-950/20 px-3.5 py-3"
      data-manual-passages
    >
      <p className="text-[11px] font-medium tracking-wide text-cyan-200/90 uppercase">
        Manuel pertinent ({passages.length} passage{passages.length > 1 ? 's' : ''})
      </p>
      <ul className="flex flex-col gap-2 text-[12px] text-slate-200">
        {passages.map((p) => (
          <li key={p.id} className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
            <div className="font-medium text-slate-100">{p.section}</div>
            <div className="text-[11px] text-slate-400">{p.source}</div>
            <p className="mt-1 text-slate-300">{p.excerpt}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
