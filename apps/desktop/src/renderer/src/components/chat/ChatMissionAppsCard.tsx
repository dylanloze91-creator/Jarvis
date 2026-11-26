import { useState } from 'react';
import { continueDraft, type FacileAppsPayload } from '@jarvis/core';
import { cn } from '@/lib/utils';

/**
 * Jarvis Développeur facile, étape 3 : « Mes applis » (Jarvis Test). La liste des applis créées par
 * Jarvis, chacune avec son état, son dossier, « Ouvrir l'appli » et « Continuer ».
 */
export function ChatMissionAppsCard({
  data,
  onOpen,
  onFolder,
  onContinue,
}: {
  data: FacileAppsPayload;
  onOpen: (id: string) => Promise<{ ok: boolean; message: string }>;
  onFolder: (id: string) => void;
  /** Pose le début d'une demande dans la zone de saisie (« Dans mon appli « … », »). */
  onContinue: (draft: string) => void;
}) {
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [opening, setOpening] = useState<string | null>(null);

  if (!data.apps.length) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-[12.5px] text-slate-300" data-chat-mission="facile-applis">
        Aucune appli pour l’instant.
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-3" data-chat-mission="facile-applis">
      <ul className="flex flex-col gap-2">
        {data.apps.map((app) => (
          <li key={app.id} className="flex flex-col gap-1 rounded-lg border border-white/10 px-2.5 py-2" data-facile-app={app.status}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-slate-100">{app.nom}</span>
              <span
                className={cn(
                  'text-[11.5px]',
                  app.status === 'pret' ? 'text-emerald-300' : app.status === 'rate' ? 'text-rose-300' : app.status === 'arrete' ? 'text-slate-400' : 'text-cyan-200',
                )}
              >
                {app.etat}
              </span>
            </div>
            {app.folder ? <p className="truncate font-mono text-[11px] text-slate-400">{app.folder}</p> : null}
            <div className="flex flex-wrap gap-2">
              {app.peutOuvrir ? (
                <button
                  type="button"
                  className="rounded-md bg-cyan-700/80 px-2.5 py-1 text-[12px] text-white hover:bg-cyan-600/80 disabled:opacity-60"
                  disabled={opening === app.id}
                  onClick={() => {
                    setOpening(app.id);
                    void onOpen(app.id)
                      .then((r) => setMessages((m) => ({ ...m, [app.id]: { ok: r.ok, text: r.ok ? 'Elle est ouverte dans une fenêtre à côté.' : r.message } })))
                      .catch(() => setMessages((m) => ({ ...m, [app.id]: { ok: false, text: 'Je n’ai pas pu l’ouvrir.' } })))
                      .finally(() => setOpening(null));
                  }}
                >
                  {opening === app.id ? 'J’ouvre…' : 'Ouvrir l’appli'}
                </button>
              ) : null}
              {app.projectId ? (
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-slate-200 hover:bg-white/10"
                  onClick={() => onContinue(continueDraft(app))}
                >
                  Continuer
                </button>
              ) : null}
              {app.folder ? (
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-2.5 py-1 text-[12px] text-slate-200 hover:bg-white/10"
                  onClick={() => onFolder(app.id)}
                >
                  Ouvrir le dossier
                </button>
              ) : null}
            </div>
            {messages[app.id] ? (
              <p className={cn('text-[12px]', messages[app.id]!.ok ? 'text-slate-400' : 'text-rose-200')}>{messages[app.id]!.text}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
