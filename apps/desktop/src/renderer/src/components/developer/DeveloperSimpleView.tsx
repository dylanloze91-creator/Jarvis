import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AppWindow, Gamepad2, Monitor } from 'lucide-react';
import { summarizeOllamaModelForDeveloper, type Settings } from '@jarvis/core';
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

const DEV_HINTS = [
  {
    icon: Gamepad2,
    label: 'Plateforme 2D',
    prompt:
      'Crée un jeu de plateforme vue de côté : compose un niveau jouable sur le gabarit (saut, collectable, piège, victoire).',
  },
  {
    icon: Monitor,
    label: 'Appli Windows (.exe)',
    prompt:
      'Crée une petite appli Windows livrée en .exe WinForms : une fonction testée dans Core et une interface simple.',
  },
  {
    icon: AppWindow,
    label: 'Appli ou outil',
    prompt: 'Crée un nouveau projet (appli web, outil en ligne de commande, ou bibliothèque) pour cette idée : ',
  },
] as const;

export function DeveloperSimpleView({
  settings,
  voice,
  onAssistantReply,
  onSaved,
  onBack,
  pendingVoice = null,
  onPendingVoiceConsumed,
  embedded = false,
}: {
  settings: Settings | null;
  voice: UseVoiceResult;
  onAssistantReply: (text: string) => void;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  /** Absent en mode onglet intégré (fenêtre Jarvis). */
  onBack?: () => void;
  pendingVoice?: string | null;
  onPendingVoiceConsumed?: () => void;
  /** Onglet « Dev » de la fenêtre principale : pas de « Changer de mode ». */
  embedded?: boolean;
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
  const jarvisProject = useMemo(() => projects.find((p) => p.kind === 'jarvis') ?? null, [projects]);
  const codeModel = settings?.developer.codeModel ?? '';

  const launchNewProjectMission = useCallback(
    (prompt: string) => {
      if (state?.busy) return;
      act((api) =>
        api.startMission('new-project', prompt, true, jarvisProject?.id ?? 'jarvis'),
      );
    },
    [act, jarvisProject?.id, state?.busy],
  );

  const ollamaInstalled = useMemo(() => {
    const list = state?.model.ollamaModels ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [state?.model.ollamaModels]);

  const chooseCodeModel = useCallback(
    async (modelId: string) => {
      if (!settings || settings.developer.codeModel === modelId) return;
      const payload = await window.jarvis.settings.set({
        developer: { ...settings.developer, codeModel: modelId },
      });
      onSaved(payload);
    },
    [onSaved, settings],
  );

  const codeModelQuickPick = embedded ? (
    <div className="flex flex-col gap-1.5" data-dev-code-model-quick>
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Modèles Ollama installés — un clic pour le dev
      </span>
      {ollamaInstalled.length === 0 ? (
        <p className="text-xs leading-relaxed text-amber-200/95">
          {state?.model.ollamaListMessage ??
            'Ollama ne répond pas ou aucun modèle n’est installé : démarre Ollama, installe un modèle (`ollama pull …`), puis rouvre cet onglet.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {ollamaInstalled.map((entry) => {
            const active = codeModel === entry.name;
            return (
              <button
                key={entry.name}
                type="button"
                className={cn(
                  'developer-cursor-project-btn max-w-[14rem] text-left',
                  active && 'is-active',
                )}
                disabled={state?.busy}
                aria-pressed={active}
                data-dev-code-model={entry.name}
                onClick={() => void chooseCodeModel(entry.name)}
              >
                <span className="font-mono text-[13px] font-medium text-slate-100">{entry.name}</span>
                <span className="text-[11px] leading-snug text-slate-500">
                  {summarizeOllamaModelForDeveloper(entry.name, entry)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  const missionStarters = (
    <div className="flex flex-wrap gap-2" data-dev-mission-starters>
      {DEV_HINTS.map((hint) => (
        <button
          key={hint.label}
          type="button"
          className="developer-cursor-project-btn max-w-full text-left"
          disabled={state?.busy}
          onClick={() => launchNewProjectMission(hint.prompt)}
        >
          <hint.icon className="mb-1 size-4 text-cyan-300" />
          <span className="font-medium text-slate-100">{hint.label}</span>
        </button>
      ))}
    </div>
  );

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

  useEffect(() => {
    const text = pendingVoice?.trim() ?? '';
    if (!text || !activeId || state?.busy) return;
    const canSend = project && (project.ok || project.kind === 'jarvis');
    if (!canSend) return;
    act((api) => api.sendProjectChat(activeId, text));
    onPendingVoiceConsumed?.();
  }, [pendingVoice, activeId, state?.busy, project?.ok, project?.kind]);

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
    if (!projectChat || !state || state.busy) return;
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
      <div className="developer-cursor-toolbar no-drag flex flex-wrap items-center gap-2 px-3 py-2">
        {!embedded && onBack ? (
          <Button type="button" size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="size-3.5" /> Changer de mode
          </Button>
        ) : null}
        <span className="text-xs font-medium text-slate-300">
          {embedded ? 'Développeur' : 'Jarvis développeur'}
        </span>
        {embedded ? (
          <span className="text-[11px] text-slate-500">
            Appli, plateforme 2D ou .exe Windows — un modèle à la fois, mémoire des runs.
          </span>
        ) : null}
      </div>
      {embedded ? (
        <div className="no-drag flex flex-col gap-3 border-b border-white/[0.06] px-3 py-2">
          {codeModelQuickPick}
          {missionStarters}
        </div>
      ) : null}
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
                Aucun projet : décris ton idée dans le chat à droite pour lancer une mission.
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
            <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
              <p className="text-sm text-slate-300">
                Décris ce que tu veux construire : Jarvis choisit le gabarit (plateforme 2D, appli
                Windows .exe, web, CLI…) et enchaîne plan, code, tests et livraison.
              </p>
              {missionStarters}
            </div>
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
