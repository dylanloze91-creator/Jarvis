import { AlertTriangle, Check, ShieldOff, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatItem } from '@/hooks/useChat';
import { cn } from '@/lib/utils';

export function Messages({ items }: { items: ChatItem[] }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [items]);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
      <div ref={bottom} />
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent/15 px-3.5 py-2 text-sm leading-relaxed text-slate-100">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === 'assistant') {
    return (
      <div className="markdown max-w-[92%] text-sm text-slate-200">
        <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
        {item.streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-accent" />
        ) : null}
      </div>
    );
  }

  if (item.kind === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
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
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={item.content.length === 0}
        className={cn(
          'no-drag flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors',
          denied && 'border-amber-500/30 bg-amber-500/10 text-amber-200',
          failed && 'border-rose-500/30 bg-rose-500/10 text-rose-200',
          !denied && !failed && 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
        )}
      >
        {denied ? (
          <ShieldOff className="size-3.5" />
        ) : item.status === 'ok' ? (
          <Check className="size-3.5 text-accent" />
        ) : (
          <Wrench className={cn('size-3.5', item.status === 'running' && 'animate-pulse')} />
        )}
        <span className="font-mono">{item.name}</span>
        <span className="text-slate-500">{statusLabel(item.status)}</span>
      </button>

      {open && item.content ? (
        <pre className="max-h-48 overflow-auto rounded-xl border border-white/8 bg-black/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-400">
          {item.content}
        </pre>
      ) : null}
    </div>
  );
}

function statusLabel(status: Extract<ChatItem, { kind: 'tool' }>['status']): string {
  switch (status) {
    case 'running':
      return 'en cours…';
    case 'ok':
      return 'terminé';
    case 'error':
      return 'échec';
    case 'denied':
      return 'refusé';
  }
}
