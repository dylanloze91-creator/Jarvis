import { FileSearch, Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState } from '../../../../shared/developerIpc';
import { StepTimeline } from './parts';
import { AskPanel } from './ask/AskPanel';
import { DeveloperGuide } from './DeveloperGuide';
import { ProjectsSection } from './project/ProjectsSection';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

/** Onglet « Projet » : copie de travail et « Analyser mon architecture » (lecture seule, 0.4.23). */
export function ProjectActions({
  state,
  act,
  onOpenSettings,
  codeModel,
}: {
  state: DeveloperState;
  act: Act;
  onOpenSettings: () => void;
  codeModel: string;
}) {
  const repoReady = state.repo?.ok ?? false;
  return (
    <>
      {!repoReady ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-3 text-xs text-amber-100">
          Choisis et vérifie d’abord la copie de travail.
          <div>
            <Button size="sm" onClick={onOpenSettings}>
              Réglages → Développeur
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={!repoReady || state.busy}
          onClick={() => act((api) => api.analyze())}
        >
          <FileSearch className="size-3.5" /> Analyser mon architecture
        </Button>
      </div>
      <AskPanel state={state} act={act} codeModel={codeModel} />
      <ProjectsSection state={state} act={act} />
      <DeveloperGuide />
    </>
  );
}

/** Étapes de la tâche en cours ou de la dernière (analyse, clonage, étalonnage, téléchargement, banc). */
export function TaskSection({
  state,
  act,
  showHelp,
}: {
  state: DeveloperState;
  act: Act;
  showHelp: boolean;
}) {
  const task = state.task;
  if (!task) {
    return showHelp ? (
      <p className="text-xs leading-snug text-slate-500">
        « Analyser mon architecture » lit le dépôt sans rien modifier : outils, agent,
        confirmations, réglages, IPC, couches et paquets, avec les vrais chemins. Chaque lecture est
        inscrite au journal.
      </p>
    ) : null;
  }
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-3"
      aria-label="Étapes"
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
        {state.busy ? <Loader2 className="size-3.5 animate-spin text-cyan-300" /> : null}
        {task.title}
        {state.busy ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => act((api) => api.cancel())}
          >
            <Square className="size-3" /> Annuler
          </Button>
        ) : task.outcome ? (
          <span className="ml-auto text-xs font-normal text-slate-400">
            {task.outcome === 'success'
              ? 'Terminé'
              : task.outcome === 'cancelled'
                ? 'Annulé'
                : 'Échec'}
            {task.finishedAt
              ? ` en ${((task.finishedAt - task.startedAt) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`
              : ''}
          </span>
        ) : null}
      </div>
      <StepTimeline steps={task.steps} />
      {task.log.length ? (
        <pre className="max-h-32 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-slate-400">
          {task.log.slice(-8).join('\n')}
        </pre>
      ) : null}
      {task.outcome === 'failed' && task.message ? (
        <p className="text-xs text-rose-200">{task.message}</p>
      ) : null}
    </section>
  );
}
