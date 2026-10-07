import { useEffect, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Settings } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { useDeveloper } from '@/hooks/useDeveloper';
import type { RuntimeStatus } from '../../../../shared/ipc';
import { DeveloperConfirmationCard } from './DeveloperConfirmationCard';
import { ProjectChatPanel } from './project/ProjectChatPanel';
import { DiffView } from './task/DiffView';
import { TestResults } from './task/TestResults';

export function DeveloperSimpleView({
  settings,
  onSaved,
  onBack,
}: {
  settings: Settings | null;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  onBack: () => void;
}) {
  const { state, error, act } = useDeveloper(settings?.developer.enabled);
  const project = useMemo(() => {
    const list = state?.projects ?? [];
    return list.find((p) => p.kind !== 'jarvis' && p.ok) ?? list.find((p) => p.kind !== 'jarvis') ?? list[0] ?? null;
  }, [state?.projects]);

  useEffect(() => {
    if (!settings) return;
    if (!settings.developer.enabled) {
      void window.jarvis.settings
        .set({ developer: { ...settings.developer, enabled: true } })
        .then(onSaved);
    }
    act((api) => api.detect());
    act((api) => api.listProjects());
    act((api) => api.refreshOllamaModels());
    act((api) => api.checkEnvironment());
  }, []);

  useEffect(() => {
    if (project) act((api) => api.openProjectChat(project.id));
  }, [project?.id]);

  useEffect(() => {
    if (project && !state?.projectChat?.previewOpen) {
      act((api) => api.setProjectChatPreview(project.id, true));
    }
  }, [project?.id, state?.projectChat?.previewOpen]);

  const codeModel = settings?.developer.codeModel ?? '';

  if (!state) {
    return <div className="dash-loading">Chargement…</div>;
  }

  return (
    <div className="developer-simple flex min-h-0 flex-1 flex-col gap-3 p-4" data-developer-simple>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> Changer de mode
        </Button>
        {project ? (
          <span className="text-sm text-slate-300">
            Projet : <strong className="font-medium text-slate-100">{project.name}</strong>
          </span>
        ) : null}
      </div>
      {error ? <p className="text-xs text-rose-200">{error}</p> : null}
      {state.confirmation ? (
        <DeveloperConfirmationCard
          confirmation={state.confirmation}
          onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
        />
      ) : null}
      {!project ? (
        <p className="text-sm text-slate-300">
          Aucun projet n’est encore prêt. Importe ou crée un projet dans les réglages avancés, ou
          parle à Jarvis classique en attendant.
        </p>
      ) : (
        <ProjectChatPanel
          project={project}
          state={state}
          act={act}
          codeModel={codeModel}
          installedModels={state.model.installedModels}
          simple
        />
      )}
      {state.codeTask && state.busy ? (
        <details className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-400">
          <summary className="cursor-pointer text-slate-300">Détail technique (optionnel)</summary>
          <div className="mt-2 flex flex-col gap-2">
            {state.codeTask.diff.length ? <DiffView files={state.codeTask.diff} tags={{}} /> : null}
            {state.codeTask.runs.length ? (
              <TestResults runs={state.codeTask.runs} baseline={state.codeTask.baseline} />
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
