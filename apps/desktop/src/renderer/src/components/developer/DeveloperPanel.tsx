import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, Code2, FolderGit2, GitBranch, Wrench } from 'lucide-react';
import { codeModelById, type Settings } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { useDeveloper } from '@/hooks/useDeveloper';
import { cn } from '@/lib/utils';
import type { RuntimeStatus } from '../../../../shared/ipc';
import { DeveloperConfirmationCard } from './DeveloperConfirmationCard';
import { ProjectActions, TaskSection } from './DeveloperSections';
import { CodeModelPanel } from './model/CodeModelPanel';
import { TaskPanel } from './task/TaskPanel';

export type DeveloperTab = 'project' | 'model' | 'task';

const TABS: Array<{ id: DeveloperTab; label: string; icon: typeof Bot }> = [
  { id: 'project', label: 'Projet', icon: FolderGit2 },
  { id: 'model', label: 'Modèle de code', icon: Bot },
  { id: 'task', label: 'Tâche', icon: Wrench },
];

/** Panneau « Jarvis Développeur » du tableau de bord : projet et modèle de code, étapes, rapport. */
export function DeveloperPanel({
  onOpenSettings,
  settings,
  onSaved,
  initialTab = 'project',
}: {
  onOpenSettings: () => void;
  settings: Settings | null;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  initialTab?: DeveloperTab;
}) {
  const { state, error, act } = useDeveloper();
  const [tab, setTab] = useState<DeveloperTab>(initialTab);
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
  const codeModel = settings?.developer.codeModel ?? '';
  const chooseDefault = async (modelId: string): Promise<void> => {
    if (!settings) return;
    const payload = await window.jarvis.settings.set({
      developer: { ...settings.developer, codeModel: modelId },
    });
    onSaved(payload);
  };
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
          Ta copie n’est jamais modifiée · modèle de code :{' '}
          {codeModel ? (codeModelById(codeModel)?.label ?? codeModel) : 'pas encore choisi'}
        </span>
      </header>

      <div role="tablist" aria-label="Jarvis Développeur" className="flex gap-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-developer-tab={id}
            onClick={() => setTab(id)}
            className={cn(
              'no-drag flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              tab === id
                ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(57,220,255,0.28)]'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'task' && state.confirmation ? (
        <DeveloperConfirmationCard
          confirmation={state.confirmation}
          onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
        />
      ) : null}

      {tab === 'project' ? (
        <ProjectActions
          state={state}
          act={act}
          onOpenSettings={onOpenSettings}
          codeModel={codeModel}
        />
      ) : tab === 'task' ? (
        <TaskPanel
          state={state}
          act={act}
          codeModel={codeModel}
          onOpenModelTab={() => setTab('model')}
          timeline={<TaskSection state={state} act={act} showHelp={false} />}
        />
      ) : (
        <CodeModelPanel
          state={state}
          act={act}
          codeModel={codeModel}
          chatModel={settings?.model ?? ''}
          onChooseDefault={chooseDefault}
        />
      )}

      {tab !== 'task' && state.confirmation ? (
        <DeveloperConfirmationCard
          confirmation={state.confirmation}
          onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
        />
      ) : null}

      {tab !== 'task' ? <TaskSection state={state} act={act} showHelp={tab === 'project'} /> : null}

      {tab === 'project' && state.report ? (
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
