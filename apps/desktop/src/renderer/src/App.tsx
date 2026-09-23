import { History, Plus, ScrollText, Settings as SettingsIcon, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Conversation, Settings } from '@jarvis/core';
import { AuditPanel } from '@/components/AuditPanel';
import { Composer } from '@/components/Composer';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { EmptyState } from '@/components/EmptyState';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Messages } from '@/components/Messages';
import { SettingsPanel } from '@/components/SettingsPanel';
import { Button } from '@/components/ui/button';
import { useChat } from '@/hooks/useChat';
import { cn } from '@/lib/utils';
import type { RuntimeStatus, ToolInfo } from '../../shared/ipc';

type View = 'chat' | 'history' | 'settings' | 'audit';

const HEADER_HEIGHT = 44;
const MAX_BODY_HEIGHT = 540;

export default function App() {
  const chat = useChat();
  const [view, setView] = useState<View>('chat');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const content = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.jarvis.settings.get().then((payload) => {
      setSettings(payload.settings);
      setStatus(payload.status);
    });
    void window.jarvis.tools.list().then(setTools);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (view !== 'chat') setView('chat');
      else void window.jarvis.window.hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view]);

  /** La fenêtre suit la hauteur du contenu pour rester compacte au repos. */
  useLayoutEffect(() => {
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
  }, [view]);

  const startNew = (): void => {
    chat.reset();
    setView('chat');
  };

  const openConversation = (conversation: Conversation): void => {
    chat.load(conversation);
    setView('chat');
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface/85 shadow-2xl backdrop-blur-2xl">
      <header className="drag-region flex h-11 shrink-0 items-center gap-2 border-b border-white/8 px-3">
        <span className="pulse-dot size-2 rounded-full bg-accent" />
        <span className="text-[13px] font-semibold tracking-wide text-slate-200">JARVIS</span>
        {status ? (
          <span className="truncate text-[11px] text-slate-500">
            {status.usingFallback
              ? 'mode démonstration'
              : `${status.providerLabel} · ${status.model}`}
          </span>
        ) : null}

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
            label="Fermer"
            active={false}
            onClick={() => void window.jarvis.window.hide()}
          >
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content}>
          {view === 'history' ? <HistoryPanel onOpen={openConversation} /> : null}

          {view === 'audit' ? <AuditPanel /> : null}

          {view === 'settings' && settings && status ? (
            <SettingsPanel
              settings={settings}
              status={status}
              onSaved={(payload) => {
                setSettings(payload.settings);
                setStatus(payload.status);
              }}
            />
          ) : null}

          {view === 'chat' ? (
            chat.items.length === 0 ? (
              <EmptyState tools={tools} onPick={chat.send} />
            ) : (
              <Messages items={chat.items} />
            )
          ) : null}
        </div>
      </div>

      {view === 'chat' ? (
        <div ref={footer} className="shrink-0">
          {chat.confirmation ? (
            <ConfirmationCard confirmation={chat.confirmation} onRespond={chat.respond} />
          ) : null}
          <Composer busy={chat.busy} onSend={chat.send} onCancel={chat.cancel} />
        </div>
      ) : null}
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
      className={cn(active && 'bg-white/10 text-slate-100')}
    >
      {children}
    </Button>
  );
}
