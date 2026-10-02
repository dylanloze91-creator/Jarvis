import type { BenchResult } from '@jarvis/core';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { codeModelById } from '@jarvis/core';
import { dateTime, gb, tokValue, verdict } from './format';
import { MeasureBadge } from './StepCard';

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-slate-500" />;
  return ok ? (
    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
  ) : (
    <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
  );
}

/** Résultat mesuré d’un banc : les cinq tâches, puis vitesse, RAM et carte graphique. */
export function BenchResults({ bench }: { bench: BenchResult }) {
  const label = codeModelById(bench.model)?.label ?? bench.model;
  const m = bench.metrics;
  const metrics: Array<[string, string]> = [
    ['Écriture', tokValue(m.outputTokPerSec)],
    ['Lecture du contexte', tokValue(m.promptTokPerSec)],
    [
      'Chargement à froid',
      m.loadMs === null
        ? '—'
        : `${(m.loadMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`,
    ],
    ['Modèle sur la carte', gb(m.sizeVramBytes)],
    [
      'Carte graphique occupée',
      m.gpuUsedMiB === null
        ? '—'
        : `${(m.gpuUsedMiB / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Gio`,
    ],
    ['Modèle en RAM', gb(m.ramUsedBytes)],
  ];
  return (
    <div
      data-bench={bench.model}
      className="flex flex-col gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2.5 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-100">
          {label}
          {bench.expertsInRam ? ' · experts en RAM' : ''}
        </span>
        <MeasureBadge />
        <span
          className={
            bench.summary.passed
              ? 'rounded-full bg-emerald-400/15 px-2 py-px text-[11px] text-emerald-200'
              : 'rounded-full bg-rose-500/15 px-2 py-px text-[11px] text-rose-200'
          }
        >
          {bench.summary.passed ? 'Banc réussi' : 'Banc raté'}
        </span>
        <span className="ml-auto text-[11px] text-slate-500">{dateTime(bench.finishedAt)}</span>
      </div>
      <p className="text-slate-300">
        Appels d’outils {bench.summary.toolCalls} · modification exacte{' '}
        {verdict(bench.summary.edit)} · correction {verdict(bench.summary.fix)}
      </p>
      <ul className="flex flex-col gap-1">
        {bench.tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2">
            <Mark ok={task.ok} />
            <span>
              <span className="text-slate-200">{task.label}</span>{' '}
              <span className="text-slate-400">— {task.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {metrics.map(([name, value]) => (
          <div key={name} className="flex flex-col">
            <dt className="text-[11px] text-slate-500">{name}</dt>
            <dd className="text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
