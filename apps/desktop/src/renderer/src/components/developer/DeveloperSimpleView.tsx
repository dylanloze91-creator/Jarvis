import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Settings } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { VoiceBar } from '@/components/VoiceBar';
import { cn } from '@/lib/utils';
import { useDeveloper } from '@/hooks/useDeveloper';
import type { RuntimeStatus } from '../../../../shared/ipc';
import type { ProjectView } from '../../../../shared/developerIpc';
import type { UseVoiceResult } from '@/voice/useVoice';
import { setVoiceTranscriptTarget } from '@/voice/voiceTranscriptRouter';
import { DeveloperConfirmationCard } from './DeveloperConfirmationCard';
import { ProjectChatPanel } from './project/ProjectChatPanel';

function projectPreviewable(project: ProjectView): boolean {
  return project.template === 'web-game';
}

export function DeveloperSimpleView({
  settings,
  voice,
  onAssistantReply,
  onSaved,
  onBack,
}: {
  settings: Settings | null;
  voice: UseVoiceResult;
  onAssistantReply: (text: string) => void;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  onBack: () => void;
}) {
  const { state, error, act } = useDeveloper(settings?.developer.enabled);
  const projects = useMemo(() => state?.projects ?? [], [state?.projects]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = useMemo(() => {
    if (selectedId && projects.some((p) => p.id === selectedId)) return selectedId;
    return (
      projects.find((p) => p.kind !== 'jarvis' && p.ok)?.id ??
      projects.find((p) => p.kind !== 'jarvis')?.id ??
      projects[0]?.id ??
      null
    );
  }, [projects, selectedId]);
  const project = projects.find((p) => p.id === activeId) ?? null;

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
    if (activeId) act((api) => api.openProjectChat(activeId));
  }, [activeId]);

  const codeModel = settings?.developer.codeModel ?? '';
  const projectChat =
    activeId && state?.projectChat?.projectId === activeId ? state.projectChat : null;
  const spokenMessageCountRef = useRef(0);

  useEffect(() => {
    spokenMessageCountRef.current = projectChat?.messages.length ?? 0;
  }, [activeId, projectChat?.projectId]);

  useEffect(() => {
    const canSend = project && (project.ok || project.kind === 'jarvis');
    if (!activeId || !canSend) {
      setVoiceTranscriptTarget(null);
      return;
    }
    setVoiceTranscriptTarget((text) => {
      const trimmed = text.trim();
      if (trimmed.length < 2 || state?.busy) return;
      act((api) => api.sendProjectChat(activeId, trimmed));
    });
    return () => setVoiceTranscriptTarget(null);
  }, [activeId, project?.id, project?.ok, project?.kind, state?.busy]);

  useEffect(() => {
    if (!projectChat || state.busy) return;
    const messages = projectChat.messages;
    if (messages.length <= spokenMessageCountRef.current) return;
    const newSlice = messages.slice(spokenMessageCountRef.current);
    spokenMessageCountRef.current = messages.length;
    const lastAssistant = [...newSlice].reverse().find((m) => m.role === 'assistant');
    const content = lastAssistant?.content?.trim() ?? '';
    if (!content) return;
    onAssistantReply(content);
  }, [projectChat?.messages, state?.busy, onAssistantReply]);

  if (!state) {
    return <div className="dash-loading">Chargement…</div>;
  }

  return (
    <div className="developer-cursor flex min-h-0 flex-1 flex-col" data-developer-cursor>
      <div className="developer-cursor-toolbar no-drag flex items-center gap-2 px-3 py-2">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> Changer de mode
        </Button>
        <span className="text-xs text-slate-500">Jarvis développeur</span>
      </div>
      {error ? <p className="px-4 text-xs text-rose-200">{error}</p> : null}
      {state.confirmation ? (
        <div className="px-3 pb-2">
          <DeveloperConfirmationCard
            confirmation={state.confirmation}
            onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
          />
        </div>
      ) : null}
      <div className="developer-cursor-body min-h-0 flex-1">
        <aside className="developer-cursor-projects" aria-label="Projets">
          <p className="developer-cursor-projects-title">Projets</p>
          <ul className="developer-cursor-project-list">
            {projects.length === 0 ? (
              <li className="text-xs text-slate-500 px-2 py-3">
                Aucun projet pour l’instant. Demande à Jarvis classique de t’aider à en ajouter un,
                ou reviens quand un projet apparaît ici.
              </li>
            ) : (
              projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={cn(
                      'developer-cursor-project-btn',
                      p.id === activeId && 'is-active',
                    )}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="font-medium text-slate-100">{p.name}</span>
                    <span className="text-[11px] text-slate-500">
                      {p.ok ? 'prêt' : 'à vérifier'}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>
        <section className="developer-cursor-chat flex min-h-0 flex-col" aria-label="Discussion projet">
          {!project ? (
            <p className="p-6 text-sm text-slate-400">Choisis un projet à gauche pour parler.</p>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ProjectChatPanel
                  project={project}
                  state={state}
                  act={act}
                  codeModel={codeModel}
                  installedModels={state.model.installedModels}
                  simple
                  previewable={projectPreviewable(project)}
                />
              </div>
              <VoiceBar voice={voice} voiceEnabled={settings?.voice.enabled ?? false} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
