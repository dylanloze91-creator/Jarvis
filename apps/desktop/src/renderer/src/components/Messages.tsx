import { AlertTriangle, Check, Compass, MicOff, ShieldOff, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { splitSourcesFooterForDisplay } from '@jarvis/core';
import type { ChatItem } from '@/hooks/useChat';
import { ChatMissionBlock } from '@/components/chat/ChatMissionBlock';
import { SourcesLine } from '@/components/SourcesLine';
import { toolLabel } from '@/lib/toolLabels';
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
          <AssistantMarkdown text={item.text} />
          {item.streaming ? <span className="stream-caret" /> : null}
          {!item.streaming ? <SourcesLine text={item.text} /> : null}
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

  if (item.kind === 'route') {
    return <RouteItem item={item} />;
  }

  if (item.kind === 'chat_mission') {
    return (
      <div className="assistant-row">
        <div className="assistant-avatar">J</div>
        <div className="assistant-copy max-w-[640px]">
          <ChatMissionBlock messageId={item.id} envelope={item.envelope} busy={false} />
        </div>
      </div>
    );
  }

  if (item.kind === 'ignored') {
    return (
      <div className="tool-row">
        <span
          className="tool-chip opacity-70"
          title="Phrase dite sans « Jarvis » pendant la discussion, jugée adressée à quelqu’un d’autre : pas de réponse. Redis « Jarvis » pour reprendre."
        >
          <MicOff className="size-3.5 text-slate-400" />
          <span className="max-w-[440px] truncate">Pas pour Jarvis : « {item.text} »</span>
          <span className="tool-status">écoute fermée</span>
        </span>
      </div>
    );
  }

  return <ToolItem item={item} />;
}

function AssistantMarkdown({ text }: { text: string }) {
  const { body } = splitSourcesFooterForDisplay(text);
  return (
    <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
  );
}

const ROUTE_HOW: Record<Extract<ChatItem, { kind: 'route' }>['how'], string> = {
  calcul: 'calcul exact',
  express: 'express',
  cerveau: 'choisi par le cerveau',
  trieur: 'choisi par le trieur',
};

function RouteItem({ item }: { item: Extract<ChatItem, { kind: 'route' }> }) {
  const validation = item.validation;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saved, setSaved] = useState<'confirme' | 'corrige' | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (chosenTeam: string): void => {
    if (!validation || saved || busy) return;
    setBusy(true);
    void window.jarvis.orchestra
      .validateTeam({
        phrase: validation.phrase,
        context: validation.context,
        proposedTeam: validation.proposedTeam,
        chosenTeam,
        path: validation.path,
      })
      .then((result) => {
        if (result.ok) {
          setSaved(chosenTeam === validation.proposedTeam ? 'confirme' : 'corrige');
          setPickerOpen(false);
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="tool-row route-validation-row">
      <span className="tool-chip" title="Chef d’orchestre : équipe et modèle de cette réponse">
        <Compass className="size-3.5 text-cyan-300" />
        <span className="max-w-[440px] truncate">
          {item.label} · {item.model}
        </span>
        <span className="tool-status">{ROUTE_HOW[item.how]}</span>
      </span>
      {validation && !saved ? (
        pickerOpen ? (
          <span className="route-team-picker" role="group" aria-label="Choisir l’équipe">
            {validation.teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className="route-team-option"
                disabled={busy}
                onClick={() => submit(team.id)}
              >
                {team.label}
              </button>
            ))}
            <button type="button" className="route-val-btn ghost" disabled={busy} onClick={() => setPickerOpen(false)}>
              Annuler
            </button>
          </span>
        ) : (
          <span className="route-validation-actions">
            <button
              type="button"
              className="route-val-btn"
              disabled={busy}
              title="Confirmer cette équipe"
              aria-label="Confirmer l’équipe"
              onClick={() => submit(validation.proposedTeam)}
            >
              ✓
            </button>
            <button type="button" className="route-val-btn" disabled={busy} onClick={() => setPickerOpen(true)}>
              Changer
            </button>
          </span>
        )
      ) : null}
      {saved ? (
        <span className="route-validation-done">{saved === 'confirme' ? 'Équipe validée' : 'Équipe corrigée'}</span>
      ) : null}
    </div>
  );
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
        title={toolTooltip(item)}
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
  if (item.summary) return item.summary;
  return toolLabel(item.name);
}

/** Infobulle : libellé, nom technique, et ce que montre le clic. */
function toolTooltip(item: Extract<ChatItem, { kind: 'tool' }>): string {
  const head = `${toolLabel(item.name)} (${item.name})`;
  if (item.content.length > 0) return `${head} — cliquer pour voir le détail`;
  return head;
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
