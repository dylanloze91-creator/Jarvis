import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { isDeveloperVoiceIntent, type Settings } from '@jarvis/core';
import { cn } from '@/lib/utils';
import { Composer } from '@/components/Composer';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { Messages } from '@/components/Messages';
import { VoiceBar } from '@/components/VoiceBar';
import type { ChatItem, PendingConfirmation } from '@/hooks/useChat';
import type { RuntimeStatus } from '../../../shared/ipc.js';
import type { UseVoiceResult } from '@/voice/useVoice';
import { setVoiceTranscriptTarget } from '@/voice/voiceTranscriptRouter';
import '@/dashboard/dashboard.css';

export function UnifiedJarvisChat({
  settings,
  voice,
  onSaved: _onSaved,
  chat,
  compact = false,
  booting,
  bootError,
  onOpenDeveloper,
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
  /** Ouvre l’onglet Développeur (missions appli, plateforme, .exe). */
  onOpenDeveloper?: (initialMessage?: string) => void;
}) {
  const [learningLine, setLearningLine] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = chat.busy;

  const submit = useCallback(
    (text: string, source?: 'voice' | 'text') => {
      const trimmed = text.trim();
      if (trimmed.length < 2 || busy) return;
      if (onOpenDeveloper && isDeveloperVoiceIntent(trimmed)) {
        onOpenDeveloper(trimmed);
        return;
      }
      chat.send(trimmed, source);
    },
    [busy, chat, onOpenDeveloper],
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
    if (scrollRef.current && chat.items.length) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chat.items.length]);

  return (
    <section
      className={cn('dash-chat min-h-0 flex-1', compact && 'dash-chat-compact')}
      aria-label="Discussion"
      data-unified-chat
      data-channel="assistant"
    >
      <div className="dash-chat-head">
        <MessageSquare className="size-4" />
        Discussion
      </div>
      <div className="dash-unified-body">
        <div
          ref={scrollRef}
          className="dash-unified-messages dash-unified-scroll"
          data-scroll-surface="yes"
        >
          {bootError ? (
            <div className="error-card m-4">{bootError}</div>
          ) : booting && chat.items.length === 0 ? (
            <div className="dash-loading">Démarrage de Jarvis…</div>
          ) : chat.items.length === 0 ? (
            <div className="dash-empty">
              Aucune conversation.
              <br />
              Dis « Jarvis », puis pose une question. Pour coder une appli, un jeu de plateforme ou un
              .exe Windows, ouvre l’onglet <strong>Développeur</strong>.
            </div>
          ) : (
            <Messages items={chat.items} scrollParentRef={scrollRef} />
          )}
        </div>
      </div>
      {chat.confirmation ? (
        <ConfirmationCard confirmation={chat.confirmation} onRespond={chat.respond} />
      ) : null}
      {learningLine ? <p className="dash-learning-hint no-drag">{learningLine}</p> : null}
      <Composer busy={busy} onSend={submit} onCancel={chat.cancel} />
      <VoiceBar voice={voice} voiceEnabled={settings?.voice.enabled ?? false} />
    </section>
  );
}
