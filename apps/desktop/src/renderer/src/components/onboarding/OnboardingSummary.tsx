import { ONBOARDING_QUESTIONS, type QuestionnaireAnswers } from '@jarvis/core';
import { Button } from '@/components/ui/button';

interface Props {
  answers: QuestionnaireAnswers;
  onConfirm: () => void;
  onBack: () => void;
}

function labelFor(questionId: string, value: unknown): string {
  const question = ONBOARDING_QUESTIONS.find((item) => item.id === questionId);
  if (!question) return String(value ?? '—');
  if (question.kind === 'toggle') return value === true ? 'Oui' : value === false ? 'Non' : '—';
  if (question.kind === 'single') {
    const option = question.options?.find((item) => item.id === value);
    return option?.label ?? String(value ?? '—');
  }
  if (question.kind === 'multi' && Array.isArray(value)) {
    return value
      .map((id) => question.options?.find((item) => item.id === id)?.label ?? id)
      .join(', ');
  }
  return String(value ?? '—');
}

export function OnboardingSummary({ answers, onConfirm, onBack }: Props) {
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div>
        <h2 className="text-lg font-medium text-slate-100">Récapitulatif</h2>
        <p className="mt-1 text-sm text-slate-400">Tu pourras tout modifier dans les réglages.</p>
      </div>
      <dl className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
        {ONBOARDING_QUESTIONS.map((question) => (
          <div key={question.id} className="flex flex-col gap-0.5">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{question.title}</dt>
            <dd className="text-sm text-slate-200">{labelFor(question.id, answers[question.id])}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Modifier
        </Button>
        <Button type="button" size="sm" onClick={onConfirm}>
          Appliquer
        </Button>
      </div>
    </div>
  );
}
