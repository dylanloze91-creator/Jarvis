import { useState } from 'react';
import type { ChatMissionTrackPayload } from '@jarvis/core';
import { cn } from '@/lib/utils';

export function ChatMissionTrackCard({
  data,
  onAnswer,
}: {
  data: ChatMissionTrackPayload;
  onAnswer?: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <section className="rounded-xl border border-white/10 bg-black/25 px-3 py-2" data-chat-mission="track">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-[12px] font-medium text-slate-200"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span>Suivi de mission</span>
        <span className="text-slate-500">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed ? (
        <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
          {data.steps.map((step) => (
            <li key={step.id} className={cn(step.status === 'running' && 'text-cyan-200')}>
              {step.actor} — {step.label}
              {step.detail ? ` : ${step.detail}` : ''} ({step.status})
            </li>
          ))}
        </ul>
      ) : null}
      {data.waitingQuestions.length > 0 && onAnswer ? (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          {data.waitingQuestions.map((q) => (
            <p key={q} className="text-[12px] text-amber-100">
              {q}
            </p>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const text = draft.trim();
              if (!text) return;
              onAnswer(text);
              setDraft('');
            }}
          >
            <input
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[12px]"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ta réponse…"
            />
            <button type="submit" className="rounded bg-cyan-700/80 px-2 text-[12px]">
              Envoyer
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
