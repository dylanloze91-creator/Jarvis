import { AlertTriangle, Check, ShieldOff, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatItem } from '@/hooks/useChat';
import { sourcePillLabel, sourcePills, type SourcePill } from '@/dashboard/sources';
import { cn } from '@/lib/utils';

export function Messages({
  items,
  scrollParentRef,
}: {
  items: ChatItem[];
  /** Conteneur unique de discussion (évite un second panneau défilant). */
  scrollParentRef?: RefObject<HTMLElement | null>;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const prevLength = useRef(items.length);

  useEffect(() => {
    if (items.length <= prevLength.current) {
      prevLength.current = items.length;
      return;
    }
    prevLength.current = items.length;
    const parent = scrollParentRef?.current;
    if (parent) {
      parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
      return;
    }
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [items.length, scrollParentRef]);

  return (
    <div className="messages-list">
      {items.map((item, index) => (
        <Item
          key={item.id}
          item={item}
          sources={item.kind === 'assistant' ? sourcePills(items, index) : []}
        />
      ))}
      <div ref={bottom} />
    </div>
  );
}

function Item({ item, sources }: { item: ChatItem; sources: SourcePill[] }) {
  if (item.kind === 'user') {
    return (
      <div className="message-row user-row">
        <div className="user-bubble">{item.text}</div>
      </div>
    );
  }

  if (item.kind === 'assistant') {
    return (
      <div className="assistant-row">
        <div className="assistant-avatar">J</div>
        <div className="markdown assistant-copy">
          <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
          {item.streaming ? <span className="stream-caret" /> : null}
          {sources.length > 0 ? (
            <div className="source-pills">
              {sources.map((pill) => (
                <span key={pill.host} className="source-pill">
                  {sourcePillLabel(pill)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (item.kind === 'error') {
    return (
      <div className="error-card">
        <AlertTriangle className="size-4 shrink-0" />
        <span>{item.text}</span>
      </div>
    );
  }

  return <ToolItem item={item} />;
}

function ToolItem({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const denied = item.status === 'denied';
  const failed = item.status === 'error';

  return (
    <div className="tool-row">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={item.content.length === 0 && !item.progress}
        className={cn('tool-chip', denied && 'denied', failed && 'failed')}
      >
        {denied ? (
          <ShieldOff className="size-3.5" />
        ) : item.status === 'ok' ? (
          <Check className="size-3.5 text-cyan-300" />
        ) : (
          <Wrench className={cn('size-3.5', item.status === 'running' && 'animate-pulse')} />
        )}
        <span className="max-w-[440px] truncate">{toolTitle(item)}</span>
        <span className="tool-status">{statusLabel(item.status)}</span>
      </button>
      {open && item.content ? <pre className="tool-detail">{item.content}</pre> : null}
    </div>
  );
}

function toolTitle(item: Extract<ChatItem, { kind: 'tool' }>): string {
  if (item.status === 'running' && item.progress) return item.progress;
  if (item.name === 'youtube_transcript') return 'Écoute YouTube';
  return item.name;
}

function statusLabel(status: Extract<ChatItem, { kind: 'tool' }>['status']): string {
  switch (status) {
    case 'running':
      return 'en cours';
    case 'ok':
      return 'terminé';
    case 'error':
      return 'échec';
    case 'denied':
      return 'refusé';
  }
}
