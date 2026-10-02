import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code2, FileSearch, GitBranch, Loader2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDeveloper } from '@/hooks/useDeveloper';
import { DeveloperConfirmationCard } from './DeveloperConfirmationCard';
import { StepTimeline } from './parts';

/** Panneau « Jarvis Développeur » du tableau de bord : projet, étapes, rapport. */
export function DeveloperPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { state, error, act } = useDeveloper();
  if (!state) {
    return <div className="dash-loading">Chargement de Jarvis Développeur…</div>;
  }
  if (!state.enabled) {
    return (
      <div className="flex flex-col gap-3 p-4 text-sm text-slate-300">
        <p>Jarvis Développeur est coupé.</p>
        <Button size="sm" onClick={onOpenSettings}>
          Ouvrir Réglages → Développeur
        </Button>
      </div>
    );
  }
  const repoReady = state.repo?.ok ?? false;
  const task = state.task;
  return (
    <div className="flex flex-col gap-4 p-4" data-developer-panel>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-cyan-100">
          <Code2 className="size-4" /> JARVIS DÉVELOPPEUR
        </span>
        <span className="text-xs text-slate-300">
          Projet : Jarvis {state.repo?.version ?? '—'} ·{' '}
          {state.repoPath || 'copie de travail non choisie'}
        </span>
        {state.repo?.branch ? (
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <GitBranch className="size-3.5" /> {state.repo.branch}
          </span>
        ) : null}
        <span className="text-xs text-slate-500">
          Lecture seule · aucun modèle de code (0.4.24)
        </span>
      </header>

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
        {state.busy ? (
          <Button size="sm" variant="ghost" onClick={() => act((api) => api.cancel())}>
            <Square className="size-3" /> Annuler
          </Button>
        ) : null}
      </div>

      {state.confirmation ? (
        <DeveloperConfirmationCard
          confirmation={state.confirmation}
          onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
        />
      ) : null}

      {task ? (
        <section
          className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-3"
          aria-label="Étapes"
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
            {state.busy ? <Loader2 className="size-3.5 animate-spin text-cyan-300" /> : null}
            {task.title}
            {task.outcome ? (
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
      ) : (
        <p className="text-xs leading-snug text-slate-500">
          « Analyser mon architecture » lit le dépôt sans rien modifier : outils, agent,
          confirmations, réglages, IPC, couches et paquets, avec les vrais chemins. Chaque lecture
          est inscrite au journal.
        </p>
      )}

      {state.report ? (
        <article className="markdown developer-report rounded-xl border border-white/8 bg-black/20 px-4 py-3 text-[13px] leading-relaxed text-slate-200">
          <Markdown remarkPlugins={[remarkGfm]}>{state.report.markdown}</Markdown>
        </article>
      ) : null}
      {state.notice ? <p className="text-xs text-accent">{state.notice}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
