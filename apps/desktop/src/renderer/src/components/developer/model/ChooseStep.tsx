import { Star } from 'lucide-react';
import { codeModelById } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { benchFor } from './format';
import { StepCard, type FlowStatus } from './StepCard';

/** Étape 6 : il choisit le modèle de code par défaut parmi les modèles passés au banc. */
export function ChooseStep({
  model,
  status,
  current,
  chatModel,
  saving,
  onChoose,
}: {
  model: CodeModelState;
  status: FlowStatus;
  current: string;
  chatModel: string;
  saving: boolean;
  onChoose: (modelId: string) => void;
}) {
  const benched = [...new Set(model.benches.map((bench) => bench.model))];
  const currentLabel = current ? (codeModelById(current)?.label ?? current) : null;
  return (
    <StepCard
      number={6}
      title="Modèle de code par défaut"
      status={status}
      hint={status === 'locked' ? 'après un banc' : undefined}
    >
      <p className="text-xs text-slate-300" data-code-model-current>
        {currentLabel
          ? `Modèle de code choisi : ${currentLabel}.`
          : 'Aucun modèle de code choisi pour l’instant.'}{' '}
        <span className="text-slate-400">
          Le chat garde son modèle ({chatModel || 'non réglé'}) : celui-ci ne sert qu’à Jarvis
          Développeur.
        </span>
      </p>
      <div className="flex flex-col gap-1.5">
        {benched.map((id) => {
          const bench = benchFor(model.benches, id);
          const label = codeModelById(id)?.label ?? id;
          const chosen = id === current;
          return (
            <div key={id} className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                size="sm"
                variant={chosen ? 'ghost' : 'default'}
                disabled={saving || chosen}
                onClick={() => onChoose(id)}
              >
                <Star className="size-3.5" />
                {chosen ? `${label} est le modèle par défaut` : `Choisir ${label} par défaut`}
              </Button>
              {bench && !bench.summary.passed ? (
                <span className="text-amber-200">Banc raté : possible, mais déconseillé.</span>
              ) : null}
            </div>
          );
        })}
        {current ? (
          <div>
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => onChoose('')}>
              Retirer le choix
            </Button>
          </div>
        ) : null}
      </div>
    </StepCard>
  );
}
