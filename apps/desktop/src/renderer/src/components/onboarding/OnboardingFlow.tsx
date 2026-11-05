import { useCallback, useMemo, useState } from 'react';
import { ONBOARDING_QUESTIONS, type OnboardingQuestion, type QuestionnaireAnswers } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/utils';

interface Props {
  initialAnswers?: QuestionnaireAnswers;
  onDone: (answers: QuestionnaireAnswers) => void;
  onDismiss: () => void;
}

export function OnboardingFlow({ initialAnswers, onDone, onDismiss }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(() => ({ ...initialAnswers }));

  const question = ONBOARDING_QUESTIONS[index];
  const total = ONBOARDING_QUESTIONS.length;
  const progress = ((index + 1) / total) * 100;

  const setAnswer = useCallback((id: string, value: string | string[] | undefined) => {
    setAnswers((current) => ({ ...current, [id]: value }));
  }, []);

  const canContinue = useMemo(() => {
    if (!question) return false;
    if (question.skippable !== false) return true;
    const value = answers[question.id];
    if (question.kind === 'text') return typeof value === 'string' && value.trim().length > 0;
    if (question.kind === 'single') return typeof value === 'string' && value.length > 0;
    if (question.kind === 'multi') return Array.isArray(value) && value.length > 0;
    return true;
  }, [answers, question]);

  const next = (): void => {
    if (index >= total - 1) {
      onDone(answers);
      return;
    }
    setIndex((current) => current + 1);
  };

  const back = (): void => {
    setIndex((current) => Math.max(0, current - 1));
  };

  if (!question) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Question {index + 1} / {total}
        </p>
        <h2 className="text-lg font-medium text-slate-100">{question.title}</h2>
        {question.subtitle ? <p className="text-sm text-slate-400">{question.subtitle}</p> : null}
      </div>

      <QuestionBody question={question} answers={answers} onChange={setAnswer} />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-4">
        <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={back}>
          Retour
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={next}>
            Passer
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Plus tard
          </Button>
          <Button type="button" size="sm" disabled={!canContinue} onClick={next}>
            {index >= total - 1 ? 'Voir le résumé' : 'Suivant'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionBody({
  question,
  answers,
  onChange,
}: {
  question: OnboardingQuestion;
  answers: QuestionnaireAnswers;
  onChange: (id: string, value: string | string[] | undefined) => void;
}) {
  if (question.kind === 'text') {
    return (
      <Input
        value={typeof answers[question.id] === 'string' ? answers[question.id] : ''}
        placeholder="Ton prénom"
        onChange={(event) => onChange(question.id, event.target.value)}
      />
    );
  }

  if (question.kind === 'single') {
    return (
      <div className="flex flex-col gap-2">
        {(question.options ?? []).map((option) => {
          const selected = answers[question.id] === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                'no-drag rounded-xl border px-3 py-3 text-left transition-colors',
                selected ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]',
              )}
              onClick={() => onChange(question.id, option.id)}
            >
              <span className="text-sm font-medium text-slate-100">{option.label}</span>
              {option.hint ? <span className="mt-1 block text-xs text-slate-500">{option.hint}</span> : null}
            </button>
          );
        })}
      </div>
    );
  }

  if (question.kind === 'multi') {
    const selected = Array.isArray(answers[question.id]) ? (answers[question.id] as string[]) : [];
    const toggle = (id: string): void => {
      const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
      onChange(question.id, next);
    };
    return (
      <div className="flex flex-col gap-2">
        {(question.options ?? []).map((option) => {
          const on = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className={cn(
                'no-drag rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                on ? 'border-accent/40 bg-accent/10 text-slate-100' : 'border-white/10 text-slate-300 hover:bg-white/[0.05]',
              )}
              onClick={() => toggle(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  return null;
}
