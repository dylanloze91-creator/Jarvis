import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Archive, GitMerge, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeTaskState } from '../../../../../shared/developerIpc';

/**
 * Rapport de fin de tâche et décisions : appliquer à la copie (fusion après la
 * carte) ou annuler l'application, garder la branche, revenir à un point de
 * reprise, jeter.
 */
export function TaskReport({
  task,
  busy,
  onKeep,
  onRollback,
  onDiscard,
  onApply,
  onRevert,
}: {
  task: CodeTaskState;
  busy: boolean;
  onKeep: () => void;
  onRollback: (checkpoint: string) => void;
  onDiscard: () => void;
  onApply: () => void;
  onRevert: () => void;
}) {
  const [target, setTarget] = useState(task.checkpoints[0]?.sha ?? '');
  if (!task.report) return null;
  const open = !task.closed && Boolean(task.worktreePath);
  const applied = task.applied && task.applied.revertedAt === null ? task.applied : null;
  const canApply =
    task.report.verdict === 'success' &&
    task.closed !== 'discarded' &&
    Boolean(task.worktreePath) &&
    !applied;
  return (
    <section className="flex flex-col gap-3" data-task-report>
      <article className="markdown developer-report rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-[13px] leading-relaxed text-slate-200">
        <Markdown remarkPlugins={[remarkGfm]}>{task.report.markdown}</Markdown>
      </article>
      {canApply || applied ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] px-3 py-2"
          data-task-apply={applied ? 'applied' : 'ready'}
        >
          {applied ? (
            <>
              <span className="text-xs text-slate-200">
                Appliquée dans « {applied.branch} » ({applied.merge.slice(0, 7)}). Rien n’est
                publié.
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRevert}>
                <Undo2 className="size-3.5" /> Annuler l’application
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={onApply}>
                <GitMerge className="size-3.5" /> Appliquer à ta copie
              </Button>
              <span className="text-[11px] text-slate-400">
                Fusion de {task.branch} dans ta copie (git merge --no-ff), après ta confirmation. Ta
                copie doit être propre ; en cas de conflit, rien ne change. Jamais de push.
              </span>
            </>
          )}
        </div>
      ) : task.applied?.revertedAt ? (
        <p className="text-xs text-slate-400">
          Application annulée par le commit {task.applied.revert?.slice(0, 7)}.
        </p>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={onKeep}>
            <Archive className="size-3.5" /> Garder la branche
          </Button>
          {task.checkpoints.length ? (
            <span className="flex items-center gap-1.5">
              <select
                className="no-drag rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-200"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                aria-label="Point de reprise"
              >
                {task.checkpoints.map((c) => (
                  <option key={c.sha} value={c.sha}>
                    {c.sha.slice(0, 7)} — {c.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !target}
                onClick={() => onRollback(target)}
              >
                <RotateCcw className="size-3.5" /> Revenir à ce point
              </Button>
            </span>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
            <Trash2 className="size-3.5" /> Jeter la tâche
          </Button>
          <span className="text-[11px] text-slate-500">
            Retour arrière et « jeter » demandent toujours ta confirmation.
          </span>
        </div>
      ) : task.closed ? (
        <p className="text-xs text-slate-400">
          {task.closed === 'kept'
            ? `Branche ${task.branch} gardée dans ${task.worktreePath}.`
            : `Tâche jetée : dossier et branche ${task.branch} supprimés.`}
        </p>
      ) : null}
    </section>
  );
}
