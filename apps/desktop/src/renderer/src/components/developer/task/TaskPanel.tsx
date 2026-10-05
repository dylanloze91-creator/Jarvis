import { useState, type ReactNode } from 'react';
import { GitBranch, Pause, Sparkles } from 'lucide-react';
import { codeModelById } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState } from '../../../../../shared/developerIpc';
import { DiffView } from './DiffView';
import { PlanCard } from './PlanCard';
import { SandboxList } from './SandboxList';
import { TaskReport } from './TaskReport';
import { ManualPassagesCard } from './ManualPassagesCard';
import { TestResults } from './TestResults';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

const STATUS: Record<string, string> = {
  planning: 'Plan en préparation',
  'awaiting-approval': 'En attente de ta validation',
  running: 'En cours',
  paused: 'En pause : la discussion a la priorité',
  finished: 'Terminée',
  failed: 'Arrêtée',
  refused: 'Plan refusé',
  cancelled: 'Annulée',
};

const EXAMPLES = [
  'Ajoute un outil qui donne la version de Jarvis, avec son test.',
  'Ajoute un test pour la fonction formatSeconds.',
];

/** Onglet « Tâche » : demande → plan → validation → modification dans la copie isolée → tests → rapport. */
export function TaskPanel({
  state,
  act,
  codeModel,
  onOpenModelTab,
  timeline,
  showRequest = true,
}: {
  state: DeveloperState;
  act: Act;
  codeModel: string;
  onOpenModelTab: () => void;
  /** Étapes de la tâche en cours, affichées sous le plan. */
  timeline: ReactNode;
  /** Faux dans l'onglet Missions : la demande vient de la mission. */
  showRequest?: boolean;
}) {
  const [request, setRequest] = useState('');
  const task = state.codeTask;
  const active = task && !task.closed && task.status !== 'refused' && task.finishedAt === null;
  const repoReady = state.repo?.ok ?? Boolean(state.repoPath);
  const coreTags = Object.fromEntries(
    (task?.plan?.files ?? []).filter((f) => f.core).map((f) => [f.path.toLowerCase(), 'cœur']),
  );
  for (const file of task?.diff ?? [])
    if (
      task?.plan &&
      !task.plan.files.some((f) => f.path.toLowerCase() === file.path.toLowerCase())
    )
      coreTags[file.path.toLowerCase()] = 'hors plan';
  return (
    <div className="flex flex-col gap-3" data-task-panel>
      {showRequest && !active ? (
        <section className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3">
          <label htmlFor="dev-task-request" className="text-[13px] font-medium text-slate-100">
            Que dois-je modifier dans Jarvis ?
          </label>
          <textarea
            id="dev-task-request"
            className="no-drag min-h-20 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
            placeholder={EXAMPLES[0]}
            value={request}
            maxLength={2000}
            onChange={(event) => setRequest(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={state.busy || !codeModel || !repoReady || request.trim().length < 8}
              onClick={() => act((api) => api.startTask(request))}
            >
              <Sparkles className="size-3.5" /> Préparer un plan
            </Button>
            {codeModel ? (
              <span className="text-[11px] text-slate-400">
                Modèle de code : {codeModelById(codeModel)?.label ?? codeModel} · rien n’est écrit
                avant ta validation.
              </span>
            ) : (
              <span className="text-[11px] text-amber-200">
                Choisis d’abord un modèle de code.{' '}
                <button type="button" className="no-drag underline" onClick={onOpenModelTab}>
                  Onglet « Modèle de code »
                </button>
              </span>
            )}
          </div>
        </section>
      ) : null}

      {task ? (
        <header
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
          data-task-status={task.status}
        >
          <span className="font-medium text-slate-100">{STATUS[task.status]}</span>
          {task.status === 'paused' ? <Pause className="size-3.5 text-amber-300" /> : null}
          <span className="flex items-center gap-1 font-mono text-[11px] text-slate-400">
            <GitBranch className="size-3.5" /> {task.branch}
          </span>
          {task.worktreePath ? (
            <span className="font-mono text-[11px] text-slate-500">{task.worktreePath}</span>
          ) : null}
          <span className="text-[11px] text-slate-500">
            {task.planApproved.length} action(s) validée(s) par le plan · {task.asked}{' '}
            confirmation(s)
          </span>
        </header>
      ) : null}

      {task?.plan ? (
        <PlanCard task={task} onRespond={(ok) => act((api) => api.approvePlan(ok))} />
      ) : null}

      {task ? <ManualPassagesCard task={task} /> : null}

      {timeline}

      {task && task.diff.length ? (
        <section className="flex flex-col gap-2">
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            Modifications dans la copie isolée ({task.diff.length} fichier(s))
          </p>
          <DiffView files={task.diff} tags={coreTags} />
        </section>
      ) : null}

      {task ? <TestResults task={task} /> : null}

      {task?.report ? (
        <TaskReport
          task={task}
          busy={state.busy}
          onKeep={() => act((api) => api.keepTask())}
          onRollback={(sha) => act((api) => api.rollbackTask(sha))}
          onDiscard={() => act((api) => api.discardTask())}
          onApply={() => act((api) => api.applyTask())}
          onRevert={() => act((api) => api.revertTask())}
        />
      ) : null}

      <SandboxList
        sandboxes={state.sandboxes}
        root={state.worktreeRoot}
        busy={state.busy}
        onRefresh={() => act((api) => api.listSandboxes())}
        onClean={(paths) => act((api) => api.cleanSandboxes(paths))}
      />
    </div>
  );
}
