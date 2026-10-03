import { CheckCircle2, Circle, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { ROLE_LABELS, type MissionStep } from '@jarvis/core';
import { cn } from '@/lib/utils';

const STATUS: Record<MissionStep['status'], { label: string; tone: string }> = {
  pending: { label: 'en attente', tone: 'text-slate-500' },
  running: { label: 'en cours', tone: 'text-cyan-300' },
  done: { label: 'terminé', tone: 'text-emerald-300' },
  failed: { label: 'échec', tone: 'text-rose-300' },
  skipped: { label: 'ignoré', tone: 'text-slate-500' },
  waiting: { label: 'attend ta réponse', tone: 'text-amber-200' },
};

function Icon({ status }: { status: MissionStep['status'] }) {
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-cyan-300" />;
  if (status === 'done') return <CheckCircle2 className="size-3.5 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="size-3.5 text-rose-400" />;
  if (status === 'waiting') return <Clock className="size-3.5 text-amber-300" />;
  if (status === 'skipped') return <MinusCircle className="size-3.5 text-slate-500" />;
  return <Circle className="size-3.5 text-slate-600" />;
}

function gb(bytes: number | null | undefined): string | null {
  return bytes === null || bytes === undefined
    ? null
    : `${(bytes / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`;
}

/** Une ligne de mission : spécialiste, état, modèle, tâche, fichiers, erreur, ressources, résultat JSON. */
export function SpecialistRow({ step }: { step: MissionStep }) {
  const status = STATUS[step.status];
  const actor = step.actor === 'USER' ? 'Toi' : ROLE_LABELS[step.actor];
  const seconds =
    step.startedAt && step.finishedAt
      ? Math.round((step.finishedAt - step.startedAt) / 1000)
      : null;
  const vram = gb(step.resources?.vramBytes);
  const ram = gb(step.resources?.ramBytes);
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border border-white/8 bg-black/20 px-3 py-2"
      data-mission-step={step.id}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Icon status={step.status} />
        <span className="w-24 font-semibold tracking-wide text-slate-100 uppercase">{actor}</span>
        <span className="text-slate-300">{step.label}</span>
        <span className={cn('ml-auto text-[11px]', status.tone)}>{status.label}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 pl-5 text-[11px] text-slate-400">
        <span>
          Modèle :{' '}
          <span className="font-mono text-slate-300">{step.model ?? '— (sans modèle)'}</span>
        </span>
        {step.rounds ? <span>{step.rounds} tour(s)</span> : null}
        {step.tokPerSec ? <span>{step.tokPerSec} jetons/s</span> : null}
        {vram || ram ? (
          <span>
            {vram ? `carte ${vram}` : ''}
            {vram && ram ? ' · ' : ''}
            {ram ? `RAM ${ram}` : ''}
          </span>
        ) : null}
        {seconds !== null ? <span>{seconds} s</span> : null}
      </div>
      {step.detail ? <p className="pl-5 text-[11px] text-slate-400">{step.detail}</p> : null}
      {step.files?.length ? (
        <p className="pl-5 font-mono text-[10px] text-slate-500">{step.files.join(' · ')}</p>
      ) : null}
      {step.error ? <p className="pl-5 text-[11px] text-rose-200">{step.error}</p> : null}
      {step.output !== undefined ? (
        <details className="pl-5 text-[11px] text-slate-400">
          <summary className="cursor-pointer">Résultat JSON</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-slate-300">
            {JSON.stringify(step.output, null, 2)}
          </pre>
        </details>
      ) : null}
    </li>
  );
}
