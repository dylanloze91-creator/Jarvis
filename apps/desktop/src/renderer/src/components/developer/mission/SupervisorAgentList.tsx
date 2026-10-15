import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { MissionAgentState } from '@jarvis/core';
import { cn } from '@/lib/utils';

const STATUS: Record<
  MissionAgentState['status'],
  { label: string; tone: string }
> = {
  pending: { label: 'en attente', tone: 'text-slate-500' },
  running: { label: 'en cours', tone: 'text-cyan-300' },
  done: { label: 'terminé', tone: 'text-emerald-300' },
  failed: { label: 'échec', tone: 'text-rose-300' },
  cancelled: { label: 'annulé', tone: 'text-slate-400' },
};

function StatusIcon({ status }: { status: MissionAgentState['status'] }) {
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-cyan-300" />;
  if (status === 'done') return <CheckCircle2 className="size-3.5 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="size-3.5 text-rose-400" />;
  if (status === 'cancelled') return <Circle className="size-3.5 text-slate-400" />;
  return <Circle className="size-3.5 text-slate-600" />;
}

/** Liste dynamique créée par le Superviseur ; chaque ligne ouvre le résultat réel de l'agent. */
export function SupervisorAgentList({ agents }: { agents: MissionAgentState[] }) {
  if (!agents.length) return null;
  return (
    <section
      className="rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-2"
      data-supervisor-agents
      aria-live="polite"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200/80">
        Superviseur · {agents.length} agent(s)
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {agents.map((agent) => {
          const status = STATUS[agent.status];
          return (
            <li key={agent.id}>
              <details className="group rounded-lg border border-white/8 bg-black/20 px-2.5 py-1.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
                  <StatusIcon status={agent.status} />
                  <span className="font-semibold text-slate-100">{agent.name}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-400">{agent.brief}</span>
                  <span className={cn('text-[10px]', status.tone)}>{status.label}</span>
                </summary>
                <div className="mt-2 space-y-1 border-t border-white/8 pt-2 pl-5 text-[11px] text-slate-400">
                  <p>
                    Rôle : {agent.role}
                    {agent.modelRequired
                      ? ` · modèle : ${agent.model ?? 'sélection en cours'}`
                      : ' · sans modèle'}
                  </p>
                  <p>Contexte : {agent.context}</p>
                  {agent.detail ? <p>Résultat : {agent.detail}</p> : null}
                  {agent.files?.length ? (
                    <p className="font-mono text-[10px]">{agent.files.join(' · ')}</p>
                  ) : null}
                  {agent.error ? <p className="text-rose-200">{agent.error}</p> : null}
                  {agent.output !== undefined ? (
                    <pre className="max-h-48 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-slate-300">
                      {JSON.stringify(agent.output, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

