import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, MessageSquareText, XCircle } from 'lucide-react';
import { CITATION_LABELS } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState } from '../../../../../shared/developerIpc';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

const EXAMPLES = [
  'Où sont enregistrés les outils proposés au modèle du chat ?',
  'Combien de tours d’outils au plus l’agent du chat enchaîne-t-il ?',
];

/** « Poser une question » sur le code de la copie de travail : lecture seule, citations relues. */
export function AskPanel({
  state,
  act,
  codeModel,
}: {
  state: DeveloperState;
  act: Act;
  codeModel: string;
}) {
  const [question, setQuestion] = useState('');
  const repoReady = state.repo?.ok ?? false;
  const ask = state.ask;
  const canAsk = repoReady && !state.busy && Boolean(codeModel) && question.trim().length >= 4;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
      data-ask-panel
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
        <MessageSquareText className="size-4" /> Poser une question sur le code
      </div>
      <textarea
        className="no-drag min-h-16 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-slate-100 placeholder:text-slate-500"
        placeholder={EXAMPLES[0]}
        value={question}
        maxLength={2_000}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canAsk} onClick={() => act((api) => api.ask(question))}>
          Poser la question
        </Button>
        <span className="text-[11px] text-slate-500">
          {codeModel
            ? `Modèle de code : ${codeModel} · lecture seule, rien n’est modifié`
            : 'Choisis d’abord un modèle de code (onglet « Modèle de code ») : aucun n’est choisi d’avance.'}
        </span>
      </div>
      {ask ? (
        <article className="flex flex-col gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2.5">
          <p className="text-xs text-slate-400">« {ask.question} »</p>
          <div className="markdown text-[13px] leading-relaxed text-slate-200">
            <Markdown remarkPlugins={[remarkGfm]}>{ask.checked.answer}</Markdown>
          </div>
          {ask.checked.citations.length ? (
            <ul className="flex flex-col gap-1">
              {ask.checked.citations.map((citation, index) => (
                <li
                  key={`${citation.path}-${index}`}
                  className="flex items-start gap-1.5 text-[11px]"
                >
                  {citation.status === 'verified' ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
                  )}
                  <span>
                    <span className="font-mono text-slate-200">{citation.path}</span>
                    <span className="text-slate-500"> — {CITATION_LABELS[citation.status]}</span>
                    <code className="mt-0.5 block whitespace-pre-wrap font-mono text-[10px] text-slate-400">
                      {citation.excerpt}
                    </code>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-amber-200">
              Aucune citation : la réponse n’est appuyée sur aucun extrait relu.
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            {ask.checked.verified}/{ask.checked.citations.length} citation(s) vérifiée(s) ·{' '}
            {ask.model} · {ask.calls} lecture(s) ·{' '}
            {(ask.durationMs / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} s
          </p>
        </article>
      ) : null}
    </section>
  );
}
