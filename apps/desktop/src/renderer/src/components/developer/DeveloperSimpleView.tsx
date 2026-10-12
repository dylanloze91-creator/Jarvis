import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  AppWindow,
  FolderInput,
  FolderPlus,
  Gamepad2,
  Monitor,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  MISSION_LABELS,
  summarizeOllamaModelForDeveloper,
  type OllamaModelInfo,
  type Settings,
} from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { VoiceBar } from '@/components/VoiceBar';
import { cn } from '@/lib/utils';
import { useDeveloper } from '@/hooks/useDeveloper';
import type { RuntimeStatus } from '../../../../shared/ipc';
import type { DeveloperState, ProjectView } from '../../../../shared/developerIpc';
import type { UseVoiceResult } from '@/voice/useVoice';
import { setVoiceTranscriptTarget } from '@/voice/voiceTranscriptRouter';
import { DeveloperCollapsible } from './DeveloperCollapsible';
import { DeveloperConfirmationCard } from './DeveloperConfirmationCard';
import { MissionGateCard } from './mission/MissionGateCard';
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

const MISSION_STATUS_FR: Record<string, string> = {
  running: 'En cours',
  'waiting-answers': 'Questions en attente',
  task: 'Modification du code',
  finished: 'Terminée',
  failed: 'Échec',
  cancelled: 'Annulée',
};

function ollamaEntriesForPicker(model: DeveloperState['model']): OllamaModelInfo[] {
  const rich = model.ollamaModels ?? [];
  if (rich.length > 0) return rich;
  return (model.installedModels ?? []).map((name) => ({
    name,
    sizeBytes: 0,
    parameterSize: '?',
    quantizationLevel: '?',
    supportsTools: true,
  }));
}

export function DeveloperSimpleView({
  settings,
  voice,
  onAssistantReply,
  onSaved,
  onBack,
  pendingVoice = null,
  onPendingVoiceConsumed,
  embedded = false,
  compactChrome = false,
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
  /** Fenêtre compacte (overlay) : layout resserré pour garder le chat visible. */
  compactChrome?: boolean;
}) {
  const { state, error, act } = useDeveloper(settings?.developer.enabled);
  const devBootedRef = useRef(false);
  const [importPath, setImportPath] = useState('');
  const [newProjectBrief, setNewProjectBrief] = useState('');
  const [modelsOpen, setModelsOpen] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(true);
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
  const codeModel = settings?.developer.codeModel ?? '';

  const launchNewProjectMission = useCallback(
    (prompt: string) => {
      if (state?.busy) return;
      const text = prompt.trim();
      if (text.length < 8) return;
      act((api) => api.startMission('new-project', text, true));
    },
    [act, state?.busy],
  );

  const ollamaInstalled = useMemo(() => {
    if (!state?.model) return [];
    const list = ollamaEntriesForPicker(state.model);
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [state?.model]);

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

  const modelsPanelBody =
    ollamaInstalled.length === 0 ? (
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
    );

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

  const embeddedToolsStrip = embedded ? (
    <div className="no-drag flex shrink-0 flex-col gap-2 border-b border-white/[0.06] px-3 py-2">
      <DeveloperCollapsible
        title="Modèles Ollama installés — un clic pour le dev"
        open={modelsOpen}
        onToggle={() => setModelsOpen((v) => !v)}
        dataAttr="models"
        headerExtra={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={state?.busy}
            data-refresh-ollama-models
            onClick={() => act((api) => api.refreshOllamaModels())}
          >
            <RefreshCw className="size-3" /> Rafraîchir
          </Button>
        }
      >
        <div data-dev-code-model-quick>{modelsPanelBody}</div>
      </DeveloperCollapsible>
      <DeveloperCollapsible
        title="Raccourcis mission"
        open={shortcutsOpen}
        onToggle={() => setShortcutsOpen((v) => !v)}
        dataAttr="shortcuts"
      >
        {missionStarters}
      </DeveloperCollapsible>
    </div>
  ) : null;

  useEffect(() => {
    if (!settings || devBootedRef.current) return;
    devBootedRef.current = true;
    let cancelled = false;
    void (async () => {
      if (!settings.developer.enabled) {
        const payload = await window.jarvis.settings.set({
          developer: { ...settings.developer, enabled: true },
        });
        if (cancelled) return;
        onSaved(payload);
      }
      if (cancelled) return;
      act((api) => api.refreshOllamaModels());
      act((api) => api.listProjects());
      act((api) => api.detect());
      act((api) => api.checkEnvironment());
    })();
    return () => {
      cancelled = true;
    };
  }, [settings, act, onSaved]);

  useEffect(() => {
    if (activeId) act((api) => api.openProjectChat(activeId));
  }, [activeId]);

  useEffect(() => {
    const mission = state?.mission;
    if (!mission || mission.kind !== 'new-project') return;
    if (mission.status === 'finished' || mission.status === 'task') {
      act((api) => api.listProjects());
    }
  }, [state?.mission?.id, state?.mission?.status, state?.mission?.kind, act]);

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
    <div
      className="developer-cursor flex min-h-0 flex-1 flex-col overflow-hidden"
      data-developer-cursor
      data-developer-compact={compactChrome ? 'yes' : undefined}
    >
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
      {embeddedToolsStrip}
      {state.notice ? (
        <p className="no-drag px-3 py-1.5 text-xs text-amber-200" data-dev-notice>{state.notice}</p>
      ) : null}
      {error ? <p className="no-drag px-4 text-xs text-rose-200">{error}</p> : null}
      {state.mission?.gate && !state.mission.gate.ok ? (
        <div className="no-drag px-3 pb-2">
          <MissionGateCard
            gate={state.mission.gate}
            busy={state.busy}
            onLaunch={(request) => launchNewProjectMission(request)}
            onEdit={(request) => launchNewProjectMission(request)}
          />
        </div>
      ) : null}
      {state.mission ? (
        <p className="no-drag border-b border-white/[0.06] px-3 py-1.5 text-[11px] text-slate-400" data-dev-mission-status>
          <span className="text-slate-200">
            {MISSION_LABELS[state.mission.kind] ?? state.mission.kind}
          </span>
          {' · '}
          {MISSION_STATUS_FR[state.mission.status] ?? state.mission.status}
          {' — '}
          <span className="text-slate-500">{state.mission.request.slice(0, 120)}</span>
        </p>
      ) : null}
      {state.confirmation ? (
        <div className="px-3 pb-2">
          <DeveloperConfirmationCard
            confirmation={state.confirmation}
            onRespond={(id, ok) => act((api) => api.respondConfirmation(id, ok))}
          />
        </div>
      ) : null}
      <div className="developer-cursor-body no-drag min-h-0 flex-1 overflow-hidden">
        <aside className="developer-cursor-projects" aria-label="Projets">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="developer-cursor-projects-title mb-0">Projets</p>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                disabled={state.busy}
                data-dev-new-project
                onClick={() =>
                  launchNewProjectMission(
                    newProjectBrief.trim().length >= 8
                      ? newProjectBrief.trim()
                      : 'Crée un nouveau projet logiciel (web, CLI ou bibliothèque Node) pour mon idée.',
                  )
                }
              >
                <FolderPlus className="size-3.5" /> Nouveau
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1.5 px-1">
            <input
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-slate-100"
              placeholder="Idée du nouveau projet (optionnel)"
              value={newProjectBrief}
              maxLength={500}
              disabled={state.busy}
              aria-label="Brève description du nouveau projet"
              onChange={(e) => setNewProjectBrief(e.target.value)}
            />
            <div className="flex flex-wrap gap-1">
              <input
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-slate-100"
                placeholder="Chemin d’un projet existant à importer"
                value={importPath}
                maxLength={400}
                disabled={state.busy}
                aria-label="Dossier du projet à importer"
                onChange={(e) => setImportPath(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 text-[11px]"
                disabled={state.busy || importPath.trim().length < 3}
                data-dev-import-project
                onClick={() => {
                  const path = importPath.trim();
                  act((api) => api.importProject(path));
                  setImportPath('');
                }}
              >
                <FolderInput className="size-3.5" /> Importer
              </Button>
            </div>
          </div>
          <ul className="developer-cursor-project-list">
            {projects.length === 0 ? (
              <li className="text-xs text-slate-500 px-2 py-3">
                Aucun projet : décris ton idée dans le chat à droite pour lancer une mission.
              </li>
            ) : (
              projects.map((p) => (
                <li key={p.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    className={cn(
                      'developer-cursor-project-btn min-w-0 flex-1',
                      p.id === activeId && 'is-active',
                    )}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="font-medium text-slate-100">{p.name}</span>
                    <span className="text-[11px] text-slate-500">
                      {p.ok ? 'prêt' : 'à vérifier'}
                    </span>
                  </button>
                  {p.kind !== 'jarvis' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-auto shrink-0 px-2 text-rose-300/90"
                      disabled={state.busy}
                      title="Retirer de la liste (le dossier reste sur le disque)"
                      data-dev-forget-project={p.id}
                      onClick={() => act((api) => api.forgetProject(p.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </aside>
        <section
          className="developer-cursor-chat flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          aria-label="Discussion projet"
        >
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
