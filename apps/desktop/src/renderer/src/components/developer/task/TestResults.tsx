import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { TestRunSummary } from '@jarvis/core';
import type { CodeTaskState } from '../../../../../shared/developerIpc';

function Cell({ run, baseline }: { run: TestRunSummary; baseline?: TestRunSummary }) {
  const known = new Set(baseline?.failures ?? []);
  const fresh = run.failures.filter((f) => !known.has(f));
  const Icon =
    run.failures.length === 0 ? CheckCircle2 : fresh.length === 0 ? MinusCircle : XCircle;
  const tone =
    run.failures.length === 0
      ? 'text-emerald-400'
      : fresh.length === 0
        ? 'text-amber-300'
        : 'text-rose-400';
  return (
    <td className="px-2 py-1.5 align-top">
      <span className="flex items-start gap-1.5">
        <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} />
        <span className="text-slate-200">{run.summary}</span>
      </span>
    </td>
  );
}

/** Référence prise avant toute modification, puis chaque série : un échec d'avant n'est pas imputé à la tâche. */
export function TestResults({ task }: { task: CodeTaskState }) {
  const baseline = task.baseline;
  if (!baseline) return null;
  const last = task.runs[task.runs.length - 1];
  return (
    <section className="flex flex-col gap-2" data-test-results>
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        Tests · {task.testSeriesUsed} série(s) sur {task.plan?.maxTestSeries ?? 5} · corrections{' '}
        {task.attempts}/{task.maxAttempts}
      </p>
      <div className="overflow-x-auto rounded-lg border border-white/8">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-white/[0.03] text-[11px] text-slate-400">
            <tr>
              <th className="px-2 py-1.5 font-medium">Série</th>
              {baseline.map((r) => (
                <th key={r.suite} className="px-2 py-1.5 font-mono font-medium">
                  {r.command}
                </th>
              ))}
              <th className="px-2 py-1.5 font-medium">Nouveaux échecs</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-white/8">
              <td className="px-2 py-1.5 text-slate-300">Référence (avant)</td>
              {baseline.map((r) => (
                <Cell key={r.suite} run={r} baseline={r} />
              ))}
              <td className="px-2 py-1.5 text-slate-500">—</td>
            </tr>
            {task.runs.map((run) => (
              <tr key={`${run.label}-${run.at}`} className="border-t border-white/8">
                <td className="px-2 py-1.5 text-slate-300">{run.label}</td>
                {run.results.map((r) => (
                  <Cell
                    key={r.suite}
                    run={r}
                    baseline={baseline.find((b) => b.suite === r.suite)}
                  />
                ))}
                <td className={`px-2 py-1.5 ${run.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {run.ok ? 'aucun' : run.newFailures.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {last && !last.ok ? (
        <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-rose-200/90">
          {last.newFailures.slice(0, 6).map((f) => (
            <li key={f}>✗ {f}</li>
          ))}
        </ul>
      ) : null}
      {baseline.some((r) => r.failures.length) ? (
        <p className="text-[11px] text-slate-500">
          Les échecs présents avant la tâche (jaune) ne lui sont pas imputés.
        </p>
      ) : null}
    </section>
  );
}
