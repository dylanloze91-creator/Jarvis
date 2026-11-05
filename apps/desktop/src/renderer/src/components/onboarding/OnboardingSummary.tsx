import {
  emptyPersonalization,
  onboardingPlanFromAnswers,
  type QuestionnaireAnswers,
  type Settings,
} from '@jarvis/core';
import { Button } from '@/components/ui/button';

interface Props {
  answers: QuestionnaireAnswers;
  settings: Settings;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function OnboardingSummary({ answers, settings, onConfirm, onBack, onCancel }: Props) {
  const plan = onboardingPlanFromAnswers(answers, settings, {
    ollamaModels: settings.provider === 'ollama' ? [settings.model] : [],
    developerRepoValid: Boolean(settings.developer.repoPath?.trim()),
    personalization: emptyPersonalization(),
  });

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div>
        <h2 className="text-lg font-medium text-slate-100">Voici ce que je vais changer</h2>
        <p className="mt-1 text-sm text-slate-400">Rien n’est modifié tant que tu n’as pas confirmé.</p>
      </div>
      {plan.setupGuideHint ? (
        <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {plan.setupGuideHint}
        </p>
      ) : null}
      {plan.changes.length === 0 ? (
        <p className="text-sm text-slate-400">Tu n’as rien choisi qui change tes réglages.</p>
      ) : (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
          {plan.changes.map((change) => (
            <li key={change.label} className="text-sm leading-snug text-slate-200">
              <span className="font-medium text-slate-100">{change.label}</span>
              <span className="text-slate-500"> — </span>
              <span className="text-slate-400">{change.before}</span>
              <span className="text-slate-500"> → </span>
              <span className="text-cyan-100/90">{change.after}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-white/8 pt-4">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Ne rien changer
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Modifier mes réponses
        </Button>
        <Button type="button" size="sm" onClick={onConfirm} disabled={plan.changes.length === 0}>
          C&apos;est bon
        </Button>
      </div>
    </div>
  );
}
