import { AlertTriangle, BadgeCheck, FileMinus2, FilePen, FilePlus2, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeTaskState } from '../../../../../shared/developerIpc';
import { cn } from '@/lib/utils';

const ACTION = {
  create: { icon: FilePlus2, label: 'créer', tone: 'text-emerald-300' },
  edit: { icon: FilePen, label: 'modifier', tone: 'text-sky-300' },
  delete: { icon: FileMinus2, label: 'supprimer', tone: 'text-rose-300' },
} as const;

/** Plan proposé : ce que la validation autorise, et ce qui redemandera toujours (décision 9). */
export function PlanCard({
  task,
  onRespond,
}: {
  task: CodeTaskState;
  onRespond?: (approved: boolean) => void;
}) {
  const plan = task.plan!;
  const waiting = task.status === 'awaiting-approval';
  const covered = plan.files.filter((f) => f.action !== 'delete' && !f.core && !f.problem);
  return (
    <section
      data-plan-card
      className={cn(
        'flex flex-col gap-3 rounded-xl border px-3.5 py-3',
        waiting ? 'border-cyan-300/30 bg-cyan-300/[0.05]' : 'border-white/8 bg-white/[0.02]',
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-slate-100">Plan proposé</span>
        {task.approvedAt ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            <BadgeCheck className="size-3.5" /> validé
          </span>
        ) : task.status === 'refused' ? (
          <span className="text-[11px] text-rose-300">refusé : rien n’a été écrit</span>
        ) : null}
      </header>
      <p className="text-[13px] leading-snug text-slate-200">{plan.summary || '—'}</p>
      {plan.criteria.length ? (
        <p className="text-xs text-slate-400">Réussi si : {plan.criteria.join(' · ')}</p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {plan.files.map((file) => {
          const action = ACTION[file.action];
          const Icon = action.icon;
          return (
            <li
              key={file.path}
              className="flex flex-wrap items-center gap-2 text-xs"
              data-plan-file={file.path}
            >
              <Icon className={cn('size-3.5 shrink-0', action.tone)} />
              <span className="text-slate-400">{action.label}</span>
              <span className="font-mono text-[11px] text-slate-100">{file.path}</span>
              {file.core ? (
                <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] text-amber-200">
                  <Lock className="size-2.5" /> cœur : redemandera ({file.core})
                </span>
              ) : null}
              {file.action === 'delete' ? (
                <span className="rounded-full bg-rose-500/15 px-1.5 py-px text-[10px] text-rose-200">
                  suppression : redemandera
                </span>
              ) : null}
              {file.problem ? (
                <span className="flex items-center gap-1 text-[11px] text-rose-300">
                  <AlertTriangle className="size-3" /> {file.problem}
                </span>
              ) : null}
              {file.reason ? (
                <span className="text-[11px] text-slate-500">— {file.reason}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {plan.dirtyFiles.length ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Ta copie a des modifications non enregistrées dans {plan.dirtyFiles.join(', ')} : la copie
          isolée part du dernier commit, sans elles.
        </p>
      ) : null}
      <div className="grid gap-2 text-[11px] leading-snug sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-2.5 py-2">
          <p className="mb-1 font-medium text-emerald-200">
            Ta validation autorise, sans redemander :
          </p>
          <ul className="flex flex-col gap-0.5 text-slate-300">
            <li>
              • créer la copie isolée : <span className="font-mono">{plan.branchCommand}</span>
            </li>
            <li>• créer ou modifier {covered.length} fichier(s) du plan hors cœur</li>
            <li>
              • lancer {plan.testCommands.map((c) => `« ${c} »`).join(', ')} dans la copie isolée,{' '}
              {plan.maxTestSeries} fois au plus (référence + {plan.maxTestSeries - 1} essais)
            </li>
          </ul>
        </div>
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-2.5 py-2">
          <p className="mb-1 font-medium text-amber-200">
            Redemandera toujours, avec le diff ou la commande :
          </p>
          <ul className="flex flex-col gap-0.5 text-slate-300">
            <li>
              • installer les dépendances (<span className="font-mono">{plan.installCommand}</span>,
              réseau)
            </li>
            <li>• un fichier du cœur, un fichier hors du plan, toute suppression</li>
            <li>
              • les tests si le diff lance un processus, supprime des fichiers ou va sur le réseau
            </li>
            <li>• un retour arrière, jeter la tâche ; jamais de push ni de publication</li>
          </ul>
        </div>
      </div>
      {waiting && onRespond ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => onRespond(true)} data-plan-approve>
            <BadgeCheck className="size-3.5" /> Valider le plan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRespond(false)}>
            <X className="size-3.5" /> Refuser
          </Button>
          <span className="text-[11px] text-slate-400">
            Ta copie de travail ne sera pas touchée.
          </span>
        </div>
      ) : null}
    </section>
  );
}
