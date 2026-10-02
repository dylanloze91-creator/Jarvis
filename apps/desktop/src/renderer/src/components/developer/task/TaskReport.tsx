import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeTaskState } from '../../../../../shared/developerIpc';

/** Rapport de fin de tâche et décisions : garder la branche, revenir à un point de reprise, jeter. */
export function TaskReport({
  task,
  busy,
  onKeep,
  onRollback,
  onDiscard,
}: {
  task: CodeTaskState;
  busy: boolean;
  onKeep: () => void;
  onRollback: (checkpoint: string) => void;
  onDiscard: () => void;
}) {
  const [target, setTarget] = useState(task.checkpoints[0]?.sha ?? '');
  if (!task.report) return null;
  const open = !task.closed && Boolean(task.worktreePath);
  return (
    <section className="flex flex-col gap-3" data-task-report>
      <article className="markdown developer-report rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-[13px] leading-relaxed text-slate-200">
        <Markdown remarkPlugins={[remarkGfm]}>{task.report.markdown}</Markdown>
      </article>
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
