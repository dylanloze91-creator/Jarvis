import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { isDeveloperVoiceIntent, type Settings } from '@jarvis/core';
import { cn } from '@/lib/utils';
import { Composer } from '@/components/Composer';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { Messages } from '@/components/Messages';
import { VoiceBar } from '@/components/VoiceBar';
import { DeveloperConfirmationCard } from '@/components/developer/DeveloperConfirmationCard';
import { ProjectChatPanel } from '@/components/developer/project/ProjectChatPanel';
import { useDeveloper } from '@/hooks/useDeveloper';
import type { ChatItem, PendingConfirmation } from '@/hooks/useChat';
import type { RuntimeStatus } from '../../shared/ipc';
import type { ProjectView } from '../../shared/developerIpc';
import type { UseVoiceResult } from '@/voice/useVoice';
import { setVoiceTranscriptTarget } from '@/voice/voiceTranscriptRouter';
import '@/dashboard/dashboard.css';

function projectPreviewable(project: ProjectView): boolean {
  return project.template === 'web-game';
}

type Channel = 'assistant' | 'project';

export function UnifiedJarvisChat({
  settings,
  voice,
  onSaved,
  chat,
  compact = false,
  booting,
  bootError,
}: {
  settings: Settings | null;
  voice: UseVoiceResult;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  chat: {
    items: ChatItem[];
    busy: boolean;
    confirmation: PendingConfirmation | null;
    send: (text: string, source?: 'voice' | 'text') => void;
    cancel: () => void;
    respond: (requestId: string, approved: boolean) => void;
  };
  compact?: boolean;
  booting: boolean;
  bootError: string | null;
}) {
  const developerOn = settings?.developer.enabled !== false;
  const { state, error, act } = useDeveloper(developerOn);
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
  const [channel, setChannel] = useState<Channel>('assistant');
  const [learningLine, setLearningLine] = useState<string | null>(null);
  const spokenMessageCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevProjectMsgCount = useRef(0);
  const projectChat =
    activeId && state?.projectChat?.projectId === activeId ? state.projectChat : null;
  const codeModel = settings?.developer.codeModel ?? '';
  const devBusy = state?.busy ?? false;
  const busy = chat.busy || (channel === 'project' && devBusy);

  useEffect(() => {
    if (!settings || !developerOn) return;
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

  const submit = useCallback(
    (text: string, source?: 'voice' | 'text') => {
      const trimmed = text.trim();
      if (trimmed.length < 2 || busy) return;
      if (developerOn && isDeveloperVoiceIntent(trimmed)) {
        setChannel('project');
        if (activeId && project && (project.ok || project.kind === 'jarvis')) {
          act((api) => api.sendProjectChat(activeId, trimmed));
        }
        return;
      }
      setChannel('assistant');
      chat.send(trimmed, source);
    },
    [activeId, busy, chat, developerOn, project, act],
  );

  useEffect(() => {
    setVoiceTranscriptTarget((text) => submit(text, 'voice'));
    return () => setVoiceTranscriptTarget(null);
  }, [submit]);

  useEffect(() => {
    void window.jarvis.localLearning.status().then((s) => setLearningLine(s.line));
    return window.jarvis.localLearning.onEvent((s) => setLearningLine(s.line));
  }, []);

  useEffect(() => {
    spokenMessageCountRef.current = projectChat?.messages.length ?? 0;
    prevProjectMsgCount.current = projectChat?.messages.length ?? 0;
  }, [activeId, projectChat?.projectId]);

  useEffect(() => {
    const count = projectChat?.messages.length ?? 0;
    if (count > prevProjectMsgCount.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
    prevProjectMsgCount.current = count;
  }, [projectChat?.messages.length]);

  useEffect(() => {
    if (!projectChat || devBusy) return;
    const messages = projectChat.messages;
    if (messages.length <= spokenMessageCountRef.current) return;
    const newSlice = messages.slice(spokenMessageCountRef.current);
    spokenMessageCountRef.current = messages.length;
    const lastAssistant = [...newSlice].reverse().find((m) => m.role === 'assistant');
    const content = lastAssistant?.content?.trim() ?? '';
    if (content) voice.noteAssistantReply(content);
  }, [projectChat?.messages, devBusy, voice]);

  const showProjectThread = developerOn && channel === 'project';

  return (
    <section
      className={cn('dash-chat min-h-0 flex-1', compact && 'dash-chat-compact')}
      aria-label="Discussion"
      data-unified-chat
      data-channel={channel}
    >
      <div className="dash-chat-head">
        <MessageSquare className="size-4" />
        Discussion
        {showProjectThread && project ? (
          <span className="text-[11px] text-slate-500 truncate">· {project.name}</span>
        ) : null}
      </div>
      <div className={cn('dash-unified-body', developerOn && 'has-projects')}>
        {developerOn ? (
          <aside className="developer-cursor-projects dash-unified-projects" aria-label="Projets">
            <p className="developer-cursor-projects-title">Projets</p>
            <ul className="developer-cursor-project-list">
              {projects.length === 0 ? (
                <li className="text-xs text-slate-500 px-2 py-2">Aucun projet pour l’instant.</li>
              ) : (
                projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={cn(
                        'developer-cursor-project-btn',
                        p.id === activeId && 'is-active',
                      )}
                      onClick={() => {
                        setSelectedId(p.id);
                        setChannel('project');
                      }}
                    >
                      <span className="font-medium text-slate-100">{p.name}</span>
                      <span className="text-[11px] text-slate-500">{p.ok ? 'prêt' : 'à vérif.'}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </aside>
        ) : null}
        <div
          ref={scrollRef}
          className="dash-unified-messages dash-unified-scroll"
          data-scroll-surface="yes"
        >
          {bootError ? (
            <div className="error-card m-4">{bootError}</div>
          ) : showProjectThread ? (
            !state ? (
              <div className="dash-loading p-4">Chargement du projet…</div>
            ) : !project ? (
              <p className="p-4 text-sm text-slate-400">Choisis un projet à gauche.</p>
            ) : (
              <>
                {error ? <p className="px-3 text-xs text-rose-200">{error}</p> : null}
                {state.confirmation ? (
                  <div className="px-3 pb-2">
                    <DeveloperConfirmationCard
                      confirmation={state.confirmation}
                      onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
                    />
                  </div>
                ) : null}
                <ProjectChatPanel
                  project={project}
                  state={state}
                  act={act}
                  codeModel={codeModel}
                  installedModels={state.model.installedModels}
                  simple
                  hideComposer
                  unifiedSurface
                  previewable={projectPreviewable(project)}
                />
              </>
            )
          ) : booting && chat.items.length === 0 ? (
            <div className="dash-loading">Démarrage de Jarvis…</div>
          ) : chat.items.length === 0 ? (
            <div className="dash-empty">
              Aucune conversation.
              <br />
              Dis « Jarvis », puis pose une question ou demande une modification de projet.
            </div>
          ) : (
            <Messages items={chat.items} scrollParentRef={scrollRef} />
          )}
        </div>
      </div>
      {chat.confirmation && channel === 'assistant' ? (
        <ConfirmationCard confirmation={chat.confirmation} onRespond={chat.respond} />
      ) : null}
      {learningLine ? <p className="dash-learning-hint no-drag">{learningLine}</p> : null}
      <Composer busy={busy} onSend={submit} onCancel={chat.cancel} />
      <VoiceBar voice={voice} voiceEnabled={settings?.voice.enabled ?? false} />
    </section>
  );
}
