import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Camera, MessageCircle, MonitorPlay, Rocket, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState, ProjectView } from '../../../../../shared/developerIpc';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

/** Discussion avec le modèle de code sur ce projet (lecture seule ; mission Modifier séparée). */
export function ProjectChatPanel({
  project,
  state,
  act,
  codeModel,
  installedModels,
}: {
  project: ProjectView;
  state: DeveloperState;
  act: Act;
  codeModel: string;
  installedModels: string[];
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
  const hasUserMessage = (chat?.messages ?? []).some((m) => m.role === 'user');
  const compareAlt = chat?.compareOffer?.alternateModel;
  const otherModels = installedModels.filter((m) => m && m !== codeModel);
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
            le code, lance une mission Modifier (plan + confirmations) — le{' '}
            <strong className="font-normal text-slate-200">fil complet</strong> de la discussion
            est transmis.
          </p>
          {(chat?.decisions?.length ?? 0) > 0 ? (
            <div className="rounded-md border border-amber-400/15 bg-amber-400/5 px-2 py-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-amber-200/80">
                Décisions mémorisées
              </p>
              <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-50/90">
                {chat!.decisions.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {chat?.codingPick ? (
            <p className="text-[11px] text-cyan-200/90">
              Modèle suggéré pour le code : <strong className="font-normal">{chat.codingPick.model}</strong>{' '}
              — {chat.codingPick.reason}
            </p>
          ) : null}
          {chat?.compareOffer ? (
            <p className="text-[11px] text-violet-200/90">
              Comparaison proposée avec {chat.compareOffer.alternateModel} :{' '}
              {chat.compareOffer.reason}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="subtle"
              disabled={state.busy}
              onClick={() =>
                act((api) => api.setProjectChatPreview(project.id, !chat?.previewOpen))
              }
            >
              <MonitorPlay className="size-3.5" />
              {chat?.previewOpen ? 'Fermer l’aperçu' : 'Ouvrir l’aperçu jeu / page'}
            </Button>
            {chat?.previewOpen ? (
              <span className="text-[10px] text-slate-500">
                Fenêtre à côté : commente (« plus rapide », « plus grand ») puis envoie avec capture.
              </span>
            ) : null}
          </div>
          <div className="max-h-56 overflow-y-auto flex flex-col gap-2 pr-1">
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
                  <>
                    {message.hasScreenshot ? (
                      <span className="mb-1 block text-[10px] text-cyan-300/80">📷 capture jointe</span>
                    ) : null}
                    {message.content}
                  </>
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
              disabled={!canSend || !chat?.previewOpen}
              title="Envoie ta remarque avec une capture de l’aperçu"
              onClick={() => {
                const text = draft.trim();
                setDraft('');
                act((api) => api.sendProjectChat(project.id, text, true));
              }}
            >
              <Camera className="size-3.5" /> Envoyer avec capture
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={state.busy || !hasUserMessage}
              title="Mission Modifier avec tout le fil de discussion"
              onClick={() => act((api) => api.startMissionFromChat(project.id))}
            >
              <Rocket className="size-3.5" /> Lancer mission Modifier
            </Button>
            <Button
              size="sm"
              variant="subtle"
              disabled={state.busy || !hasUserMessage || otherModels.length === 0}
              title="Compare le modèle actuel avec un autre installé (une validation de plan)"
              onClick={() =>
                act((api) =>
                  api.compareProjectChatModels(
                    project.id,
                    compareAlt && otherModels.includes(compareAlt)
                      ? compareAlt
                      : otherModels[0]!,
                  ),
                )
              }
            >
              <Scale className="size-3.5" /> Comparer les modèles
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
