import { History, Maximize2, Plus, ScrollText, Settings as SettingsIcon, X, Pin, PinOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { stripSourcesFooter, type Conversation, type Settings } from '@jarvis/core';
import { AuditPanel } from '@/components/AuditPanel';
import { Composer } from '@/components/Composer';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { Dashboard } from '@/dashboard/Dashboard';
import { useWideLayout } from '@/dashboard/useWideLayout';
import { EmptyState } from '@/components/EmptyState';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Messages } from '@/components/Messages';
import { SettingsPanel, openSettingsOnTab } from '@/components/SettingsPanel';
import { UpdateBadge } from '@/components/UpdateBadge';
import { VoiceBar } from '@/components/VoiceBar';
import { Button } from '@/components/ui/button';
import { useChat } from '@/hooks/useChat';
import { useUpdate } from '@/hooks/useUpdate';
import { isDemoRuntime } from '@/lib/runtimeStatus';
import { cn } from '@/lib/utils';
import { SAMPLE_CONVERSATION } from '@/preview/sampleConversation';
import { useVoice } from '@/voice/useVoice';
import { BrandMark, JarvisOrb } from '@/components/JarvisOrb';
import type { RuntimeStatus, ToolInfo } from '../../shared/ipc';

type View = 'chat' | 'history' | 'settings' | 'audit';
const HEADER_HEIGHT = 52;
const MAX_BODY_HEIGHT = 620;

function sceneFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('scene');
}

export default function App() {
  const [view, setView] = useState<View>(() => (sceneFromLocation() === 'settings' ? 'settings' : 'chat'));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null);
  const handleAssistantFinal = useCallback(
    (text: string) => voiceRef.current?.noteAssistantReply(stripSourcesFooter(text)),
    [],
  );
  const chat = useChat({ onAssistantFinal: handleAssistantFinal });
  const update = useUpdate();
  // Marque explicitement l'origine vocale : le modèle en est averti côté
  // prompt système (voir `withVoiceOriginNotice`), jamais dans le texte
  // affiché ou enregistré, qui reste la transcription telle quelle.
  const onVoiceTranscript = useCallback((text: string) => chat.send(text, 'voice'), [chat.send]);
  const voice = useVoice({
    settings,
    voiceKeyConfigured: status?.voiceKeyConfigured ?? false,
    onTranscript: onVoiceTranscript,
  });
  voiceRef.current = voice;
  const wide = useWideLayout();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([window.jarvis.settings.get(), window.jarvis.tools.list()])
      .then(([payload, listed]) => {
        if (cancelled) return;
        setSettings(payload.settings);
        setStatus(payload.status);
        setTools(listed);
      })
      .catch((error) => {
        if (cancelled) return;
        setBootError(
          error instanceof Error ? error.message : "Impossible de charger l'interface Jarvis.",
        );
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (seeded.current) return;
    const scene = sceneFromLocation();
    if (scene === 'chat') {
      seeded.current = true;
      chat.load(SAMPLE_CONVERSATION);
    } else if (scene === 'settings') {
      seeded.current = true;
      setView('settings');
    } else if (scene === 'google') {
      seeded.current = true;
      openSettingsOnTab('google');
      setView('settings');
    } else if (scene === 'google-confirm' && !booting) {
      seeded.current = true;
      chat.send('Envoie à Marie un mail pour confirmer la réunion de jeudi à 10 h.');
    }
  }, [chat.load, chat.send, booting]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (view !== 'chat') setView('chat');
      else void window.jarvis.window.hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view]);

  useLayoutEffect(() => {
    if (wide || window.innerWidth >= 1100) return;
    const node = content.current;
    if (!node) return;
    const sync = (): void => {
      const body = Math.min(node.getBoundingClientRect().height, MAX_BODY_HEIGHT);
      const chrome = HEADER_HEIGHT + (footer.current?.getBoundingClientRect().height ?? 0);
      void window.jarvis.window.resize(Math.ceil(body + chrome));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    if (footer.current) observer.observe(footer.current);
    return () => observer.disconnect();
  }, [view, chat.items.length, booting, bootError, wide]);

  const startNew = (): void => {
    chat.reset();
    setView('chat');
  };

  const toggleStayVisible = (): void => {
    if (!settings) return;
    void window.jarvis.settings
      .set({ stayVisibleOnBlur: !settings.stayVisibleOnBlur })
      .then((payload) => {
        setSettings(payload.settings);
        setStatus(payload.status);
      });
  };

  const openConversation = (conversation: Conversation): void => {
    chat.load(conversation);
    setView('chat');
  };

  const viewLabel =
    view === 'history'
      ? 'Historique'
      : view === 'settings'
        ? 'Réglages'
        : view === 'audit'
          ? 'Journal'
          : 'Assistant';

  const fallback = status ? isDemoRuntime(status) : false;

  if (wide) {
    return (
      <Dashboard
        view={view}
        setView={setView}
        settings={settings}
        status={status}
        tools={tools}
        booting={booting}
        bootError={bootError}
        chat={chat}
        voice={voice}
        onSaved={(payload) => {
          setSettings(payload.settings);
          setStatus(payload.status);
        }}
        onOpenConversation={openConversation}
        onNew={startNew}
      />
    );
  }

  return (
    <div
      className="jarvis-shell flex h-screen flex-col overflow-hidden rounded-[22px] border border-white/[0.09] shadow-2xl"
      data-ui-ready={booting ? 'no' : 'yes'}
      data-ui-view={view}
      data-ui-layout="compact"
    >
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <header className="drag-region relative z-10 flex h-[52px] shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
        <BrandMark listening={voice.state === 'listening'} level={voice.level} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[12px] font-bold tracking-[0.24em] text-white">JARVIS</span>
          {status ? (
            <span className={cn('status-pill', fallback && 'offline')}>
              <i />
              {fallback ? 'démonstration' : 'en ligne'}
            </span>
          ) : (
            <span className="status-pill">
              <i />
              chargement
            </span>
          )}
        </div>
        <div className="ml-1 hidden min-w-0 items-center gap-1.5 text-[10px] tracking-wide text-slate-500 sm:flex">
          <span className="truncate">
            {status ? `${status.providerLabel} · ${status.model}` : 'Initialisation…'}
          </span>
        </div>
        <UpdateBadge state={update.state} onInstall={update.install} />
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Nouvelle conversation" active={false} onClick={startNew}>
            <Plus className="size-4" />
          </IconButton>
          <IconButton
            label="Historique"
            active={view === 'history'}
            onClick={() => setView(view === 'history' ? 'chat' : 'history')}
          >
            <History className="size-4" />
          </IconButton>
          <IconButton
            label="Journal d'audit"
            active={view === 'audit'}
            onClick={() => setView(view === 'audit' ? 'chat' : 'audit')}
          >
            <ScrollText className="size-4" />
          </IconButton>
          <IconButton
            label="Réglages"
            active={view === 'settings'}
            onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}
          >
            <SettingsIcon className="size-4" />
          </IconButton>
          <IconButton
            label={
              settings?.stayVisibleOnBlur
                ? 'Rester ouverte (activé)'
                : 'Rester ouverte (désactivé — se masque au clic ailleurs)'
            }
            active={settings?.stayVisibleOnBlur === true}
            onClick={toggleStayVisible}
          >
            {settings?.stayVisibleOnBlur ? <Pin className="size-4" /> : <PinOff className="size-4" />}
          </IconButton>
          <IconButton
            label="Ouvrir le tableau de bord"
            active={false}
            onClick={() => void window.jarvis.window.setChrome('dashboard')}
          >
            <Maximize2 className="size-4" />
          </IconButton>
          <IconButton label="Fermer" active={false} onClick={() => void window.jarvis.window.hide()}>
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      {view !== 'chat' ? (
        <div className="relative z-10 border-b border-white/[0.06] px-5 py-3">
          <span className="section-kicker">{viewLabel}</span>
        </div>
      ) : null}

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div ref={content}>
          {view === 'history' ? <HistoryPanel onOpen={openConversation} /> : null}
          {view === 'audit' ? <AuditPanel /> : null}
          {view === 'settings' ? (
            booting ? (
              <BootStage label="Chargement des réglages…" />
            ) : bootError ? (
              <div className="error-card m-5">
                Impossible de charger les réglages : {bootError}
              </div>
            ) : settings && status ? (
              <SettingsPanel
                settings={settings}
                status={status}
                onSaved={(payload) => {
                  setSettings(payload.settings);
                  setStatus(payload.status);
                }}
              />
            ) : (
              <div className="error-card m-5">Réglages indisponibles pour le moment.</div>
            )
          ) : null}
          {view === 'chat' ? (
            bootError ? (
              <div className="error-card m-5">{bootError}</div>
            ) : booting && chat.items.length === 0 ? (
              <BootStage label="Démarrage de Jarvis…" />
            ) : chat.items.length === 0 ? (
              <EmptyState tools={tools} onPick={chat.send} listening={voice.state === 'listening'} level={voice.level} />
            ) : (
              <Messages items={chat.items} />
            )
          ) : null}
        </div>
      </div>

      {view === 'chat' ? (
        <div ref={footer} className="relative z-10 shrink-0">
          {chat.confirmation ? (
            <ConfirmationCard confirmation={chat.confirmation} onRespond={chat.respond} />
          ) : null}
          <div className="mb-2 flex flex-wrap gap-1.5 px-4">
            {[
              ['Recherche', 'Cherche les dernières infos importantes'],
              ['Mémoire', 'Rappelle-moi ce que tu sais de mes projets'],
              ['Outils', 'Quels outils peux-tu utiliser sur ce PC ?'],
              ['Vidéo', 'Analyse cette vidéo YouTube : '],
            ].map(([label, prompt]) => (
              <button
                key={label}
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 hover:border-cyan-300/40"
                onClick={() => chat.send(prompt ?? '')}
              >
                {label}
              </button>
            ))}
          </div>
          <Composer busy={chat.busy} onSend={chat.send} onCancel={chat.cancel} />
          <VoiceBar voice={voice} voiceEnabled={settings?.voice.enabled ?? false} />
        </div>
      ) : null}
    </div>
  );
}

function BootStage({ label }: { label: string }) {
  return (
    <div className="boot-stage">
      <JarvisOrb />
      <p className="relative z-10 text-[13px] text-slate-400">{label}</p>
    </div>
  );
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn('top-action', active && 'top-action-active')}
    >
      {children}
    </Button>
  );
}
