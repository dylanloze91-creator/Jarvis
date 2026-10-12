import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DeveloperApi, DeveloperState } from '../../../../shared/developerIpc';
import { PlanCard } from './task/PlanCard';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

/** Questions de mission et validation de plan, visibles dans l’onglet Développeur simplifié. */
export function DeveloperInlineMissionPrompts({
  state,
  act,
}: {
  state: DeveloperState;
  act: Act;
}) {
  const mission = state.mission;
  const task = state.codeTask;
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    setAnswers([]);
  }, [mission?.id]);

  if (task?.status === 'awaiting-approval' && task.plan) {
    return (
      <div className="no-drag shrink-0 border-b border-cyan-300/20 px-3 py-2">
        <PlanCard
          task={task}
          onRespond={(approved) => act((api) => api.approvePlan(approved))}
        />
      </div>
    );
  }

  if (mission?.status === 'waiting-answers' && mission.goal?.questions.length) {
    return (
      <div
        className="no-drag shrink-0 flex flex-col gap-2 border-b border-amber-400/25 bg-amber-400/10 px-3 py-2.5"
        data-dev-mission-questions
      >
        <p className="text-[12px] font-medium text-amber-100">Jarvis a besoin de précisions</p>
        {mission.goal.questions.map((question, index) => (
          <label key={question} className="flex flex-col gap-1 text-xs text-amber-50">
            {question}
            <input
              className="no-drag rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[13px] text-slate-100"
              value={answers[index] ?? ''}
              maxLength={1000}
              disabled={state.busy}
              onChange={(event) => {
                const next = [...answers];
                next[index] = event.target.value;
                setAnswers(next);
              }}
            />
          </label>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            disabled={state.busy}
            data-dev-mission-answer
            onClick={() => act((api) => api.answerMission(answers))}
          >
            Envoyer les réponses
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={state.busy}
            onClick={() => act((api) => api.answerMission([]))}
          >
            Continuer sans répondre
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
