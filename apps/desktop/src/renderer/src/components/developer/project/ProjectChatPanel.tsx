import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageCircle, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState, ProjectView } from '../../../../../shared/developerIpc';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

/** Discussion avec le modèle de code sur ce projet (lecture seule ; mission Modifier séparée). */
export function ProjectChatPanel({
  project,
  state,
  act,
  codeModel,
}: {
  project: ProjectView;
  state: DeveloperState;
  act: Act;
  codeModel: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const chat =
    state.projectChat?.projectId === project.id ? state.projectChat : null;
  useEffect(() => {
    if (open && !chat) act((api) => api.openProjectChat(project.id));
  }, [open, project.id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length]);
  const canSend =
    open &&
    !state.busy &&
    Boolean(codeModel) &&
    draft.trim().length >= 2 &&
    (project.ok || project.kind === 'jarvis');
  const lastUser = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'user');
  return (
    <div className="mt-2 border-t border-white/5 pt-2" data-project-chat={project.id}>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        <MessageCircle className="size-3.5" /> Discussion sur ce projet
      </Button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-white/8 bg-black/25 px-3 py-2.5">
          <p className="text-[11px] leading-snug text-slate-400">
            Tu parles au <strong className="font-normal text-slate-200">modèle de code</strong>{' '}
            ({codeModel || 'pas encore choisi'}) sur « {project.name} ». Jarvis lit le dépôt mais{' '}
            <strong className="font-normal text-slate-200">n’écrit rien</strong> ici : pour changer
            le code, lance une mission Modifier (plan + confirmations).
          </p>
          <div className="max-h-48 overflow-y-auto flex flex-col gap-2 pr-1">
            {(chat?.messages ?? []).map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'rounded-md bg-cyan-400/10 px-2 py-1.5 text-[12px] text-slate-100'
                    : 'markdown rounded-md bg-white/[0.04] px-2 py-1.5 text-[12px] text-slate-200'
                }
              >
                {message.role === 'user' ? (
                  message.content
                ) : (
                  <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                )}
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <textarea
            className="no-drag min-h-14 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] text-slate-100"
            placeholder="Question, idée, ou ce que tu voudrais modifier…"
            maxLength={4_000}
            value={draft}
            disabled={state.busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!canSend}
              onClick={() => {
                const text = draft.trim();
                setDraft('');
                act((api) => api.sendProjectChat(project.id, text));
              }}
            >
              Envoyer
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={state.busy || !lastUser}
              title="Ouvre une mission Modifier avec ton dernier message"
              onClick={() =>
                act((api) =>
                  api.startMission('modify', lastUser!.content, false, project.id),
                )
              }
            >
              <Rocket className="size-3.5" /> Lancer mission Modifier
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
