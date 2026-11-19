import { useEffect, useState } from 'react';
import {
  FACILE_QUESTION_TIMEOUT_MS,
  FACILE_SLOW_STEP_MS,
  type FacileChoice,
  type FacileLine,
  type FacilePayload,
} from '@jarvis/core';
import { cn } from '@/lib/utils';

/**
 * Jarvis Développeur facile : une création racontée dans la discussion (Jarvis Test).
 * Écrans validés : tout de suite, ce que j'ai trouvé, il construit et raconte, une question à la
 * fois, c'est prêt. Mots simples dans la vue ; le détail technique reste replié.
 */
export function ChatMissionFacileCard({
  data,
  onChoice,
  onAnswer,
  onOpenFolder,
}: {
  data: FacilePayload;
  onChoice: (choice: FacileChoice) => void;
  onAnswer: (text: string) => void;
  onOpenFolder: () => void;
}) {
  const working = data.status === 'travaille' || data.status === 'question';
  const now = useNow(working);
  const current = [...data.lines].reverse().find((line) => line.state === 'en-cours') ?? null;
  const done = data.lines.filter((line) => line !== current);
  const elapsed = Math.max(0, now - data.startedAt);
  const stepElapsed = current?.startedAt !== undefined ? Math.max(0, now - current.startedAt) : 0;
  const slow = Boolean(current) && stepElapsed >= FACILE_SLOW_STEP_MS;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-3"
      data-chat-mission="facile"
      data-facile-status={data.status}
    >
      <p className="text-[13px] text-slate-200">{data.restatement}</p>

      <Findings data={data} working={working} onChoice={onChoice} />

      {working ? (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px]',
            slow ? 'border-amber-400/30 bg-amber-400/5 text-amber-100' : 'border-cyan-400/25 bg-cyan-400/5 text-cyan-100',
          )}
          data-facile-line="current"
          role="status"
        >
          <span className={cn('size-2 shrink-0 animate-pulse rounded-full', slow ? 'bg-amber-300' : 'bg-cyan-300')} />
          <span className="min-w-0 flex-1">
            {data.status === 'question'
              ? 'J’attends ta réponse.'
              : slow && current
                ? `C’est long, je suis toujours dessus : ${lowerFirst(current.text)}`
                : (current?.text ?? 'Je démarre…')}
          </span>
          <span className="shrink-0 tabular-nums text-[11px] opacity-70">{clock(elapsed)}</span>
        </div>
      ) : null}

      {done.length ? (
        <ul className="flex flex-col gap-1 text-[12px]" data-facile-lines>
          {done.map((line) => (
            <DoneLine key={line.id} line={line} />
          ))}
        </ul>
      ) : null}

      {data.answers.length ? (
        <ul className="flex flex-col gap-1 text-[12px] text-slate-400" data-facile-answers>
          {data.answers.map((item) => (
            <li key={item.question}>
              {item.question}{' '}
              <span className="text-slate-200">
                {item.parDefaut ? `Sans réponse, je suis parti sur : ${item.answer}` : item.answer}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {data.question ? (
        <Question
          key={data.question.text}
          text={data.question.text}
          defaut={data.question.defaut}
          index={data.question.index}
          total={data.question.total}
          remainingMs={Math.max(0, data.question.askedAt + FACILE_QUESTION_TIMEOUT_MS - now)}
          onAnswer={onAnswer}
        />
      ) : null}

      {data.files.length || data.folder ? (
        <div className="flex flex-col gap-1 border-t border-white/10 pt-2" data-facile-files>
          {data.folder ? (
            <div className="flex items-center gap-2 text-[12px] text-slate-300">
              <span className="min-w-0 flex-1 truncate" title={data.folder}>
                Dossier du projet : {data.folder}
              </span>
              <button
                type="button"
                className="shrink-0 rounded border border-white/15 px-2 py-0.5 text-[11.5px] text-slate-200 hover:bg-white/10"
                onClick={onOpenFolder}
              >
                Ouvrir le dossier
              </button>
            </div>
          ) : null}
          {data.files.length ? (
            <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-slate-400">
              {data.files.map((file) => (
                <li key={file} className="truncate">
                  {file}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {data.result ? (
        <p
          className={cn(
            'rounded-lg border px-2.5 py-2 text-[13px]',
            data.status === 'pret'
              ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-100'
              : data.status === 'rate'
                ? 'border-rose-400/30 bg-rose-400/5 text-rose-100'
                : 'border-white/10 text-slate-200',
          )}
          data-facile-result
        >
          {data.result}
        </p>
      ) : null}

      {data.missionId ? (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Détails pour développeur</summary>
          <p className="mt-1">
            Mission {data.missionId}
            {data.projectId ? ` · projet ${data.projectId}` : ''}. Le plan, les changements et les tests sont dans le
            panneau Développeur du tableau de bord.
          </p>
        </details>
      ) : null}
    </section>
  );
}

function Findings({
  data,
  working,
  onChoice,
}: {
  data: FacilePayload;
  working: boolean;
  onChoice: (choice: FacileChoice) => void;
}) {
  const { findings } = data;
  if (findings.state === 'cherche') {
    return (
      <p className="text-[12px] text-slate-400" data-facile-findings="cherche">
        Je regarde sur Internet si ça existe déjà…
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 px-2.5 py-2" data-facile-findings={findings.state}>
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Ça existe déjà</p>
        {findings.existing.length ? (
          <ul className="mt-1 flex flex-col gap-1.5 text-[12px]">
            {findings.existing.map((item) => (
              <li key={item.url}>
                <a className="text-cyan-200 underline-offset-2 hover:underline" href={item.url} target="_blank" rel="noreferrer">
                  {item.name}
                </a>{' '}
                <span className="text-slate-500">({item.site})</span>
                {item.phrase ? <p className="text-slate-300">{item.phrase}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12px] text-slate-300">
            {findings.state === 'coupe'
              ? 'Internet ne m’a pas répondu : je n’ai pas pu regarder ce qui existe.'
              : 'Je n’ai rien trouvé qui fasse déjà ça.'}
          </p>
        )}
      </div>
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Pour la construire</p>
        <p className="mt-1 text-[12px] text-slate-300">{findings.method}</p>
      </div>
      {findings.choice ? (
        <p className="text-[12px] text-slate-400" data-facile-choice={findings.choice}>
          {findings.choice === 'construire'
            ? 'Tu m’as dit de la construire quand même.'
            : findings.choice === 'voir'
              ? 'Tu as préféré voir celle qui existe.'
              : 'Tu as préféré changer ta demande.'}
        </p>
      ) : working ? (
        <div className="flex flex-wrap gap-1.5">
          <ChoiceButton primary onClick={() => onChoice('construire')}>
            Construis-la quand même
          </ChoiceButton>
          {findings.existing.length ? (
            <ChoiceButton onClick={() => onChoice('voir')}>Montre-moi celle qui existe</ChoiceButton>
          ) : null}
          <ChoiceButton onClick={() => onChoice('changer')}>Je change ma demande</ChoiceButton>
          <p className="w-full text-[11px] text-slate-500">Sans réponse, je continue à la construire.</p>
        </div>
      ) : null}
    </div>
  );
}

function ChoiceButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-[12px]',
        primary ? 'bg-cyan-700/80 text-white hover:bg-cyan-600/80' : 'border border-white/15 text-slate-200 hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

function DoneLine({ line }: { line: FacileLine }) {
  return (
    <li
      className={cn(
        'flex items-start gap-2',
        line.state === 'fait' ? 'text-slate-300' : line.state === 'rate' ? 'text-amber-200' : 'text-slate-400',
      )}
      data-facile-line={line.state}
    >
      <span aria-hidden className={cn('mt-[1px] shrink-0', line.state === 'fait' ? 'text-emerald-300' : 'text-amber-300')}>
        {line.state === 'fait' ? '✓' : line.state === 'rate' ? '!' : '·'}
      </span>
      <span>{line.text}</span>
    </li>
  );
}

function Question({
  text,
  defaut,
  index,
  total,
  remainingMs,
  onAnswer,
}: {
  text: string;
  defaut: string;
  index: number;
  total: number;
  remainingMs: number;
  onAnswer: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/5 px-2.5 py-2" data-facile-question>
      <p className="text-[13px] text-amber-50">{text}</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (!value) return;
          onAnswer(value);
          setDraft('');
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[12.5px] text-slate-100"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ta réponse…"
          aria-label="Ta réponse"
        />
        <button type="submit" className="rounded bg-cyan-700/80 px-2.5 text-[12px] text-white">
          Répondre
        </button>
        <button
          type="button"
          className="rounded border border-white/15 px-2.5 text-[12px] text-slate-200 hover:bg-white/10"
          onClick={() => onAnswer('')}
        >
          {defaut}
        </button>
      </form>
      <p className="text-[11px] text-slate-400">
        {total > 1 ? `Question ${index} sur ${total}. ` : ''}
        Sans réponse dans {clock(remainingMs)}, je pars sur « {defaut} » et je continue.
      </p>
    </div>
  );
}

/** L'heure, rafraîchie chaque seconde tant que la création tourne. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${String(seconds).padStart(2, '0')} s` : `${seconds} s`;
}

function lowerFirst(text: string): string {
  return text.replace(/^./u, (letter) => letter.toLowerCase()).replace(/…$/u, '.');
}
