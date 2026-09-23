import { MessageSquare, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Conversation, ConversationSummary } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { formatRelativeDate } from '@/lib/utils';

interface HistoryPanelProps {
  onOpen: (conversation: Conversation) => void;
}

export function HistoryPanel({ onOpen }: HistoryPanelProps) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  const refresh = (): void => {
    void window.jarvis.history.list().then(setConversations);
  };

  useEffect(refresh, []);

  if (conversations === null) {
    return <p className="px-4 py-6 text-sm text-slate-500">Chargement de l’historique…</p>;
  }

  if (conversations.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-slate-500">
        Aucune conversation enregistrée pour l’instant.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          {conversations.length} conversation{conversations.length > 1 ? 's' : ''}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.jarvis.history.clear().then(refresh)}
        >
          Tout effacer
        </Button>
      </div>

      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          className="no-drag group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/6"
        >
          <button
            type="button"
            className="flex flex-1 items-center gap-2.5 text-left"
            onClick={() =>
              void window.jarvis.history
                .get(conversation.id)
                .then((loaded) => loaded && onOpen(loaded))
            }
          >
            <MessageSquare className="size-3.5 shrink-0 text-slate-500" />
            <span className="flex-1 truncate text-sm text-slate-200">{conversation.title}</span>
            <span className="shrink-0 text-[11px] text-slate-500">
              {formatRelativeDate(conversation.updatedAt)}
            </span>
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="opacity-0 group-hover:opacity-100"
            title="Supprimer"
            onClick={() => void window.jarvis.history.remove(conversation.id).then(refresh)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
