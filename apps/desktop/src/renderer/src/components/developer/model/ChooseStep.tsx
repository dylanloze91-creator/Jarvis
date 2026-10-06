import { Star } from 'lucide-react';
import { codeModelById } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { benchFor, benchStatus } from './format';
import { StepCard, type FlowStatus } from './StepCard';

/** Étape 6 : modèle de code par défaut parmi tous les modèles installés dans Ollama. */
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
  const installed = model.installedModels;
  const benched = new Set(model.benches.map((bench) => bench.model));
  const currentLabel = current ? (codeModelById(current)?.label ?? current) : null;
  return (
    <StepCard
      number={6}
      title="Modèle de code par défaut"
      status={status}
      hint={status === 'locked' ? 'quand Ollama liste au moins un modèle' : undefined}
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
      {installed.length === 0 ? (
        <p className="text-xs text-slate-500">
          Rafraîchis la liste Ollama en haut de l’onglet, ou vérifie le matériel (étape 1).
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          <select
            className="no-drag max-w-md rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-slate-100"
            value={current}
            disabled={saving}
            aria-label="Modèle de code par défaut"
            data-code-model-picker
            onChange={(event) => onChoose(event.target.value)}
          >
            <option value="">— Aucun —</option>
            {installed.map((id) => (
              <option key={id} value={id}>
                {codeModelById(id)?.label ?? id}
              </option>
            ))}
          </select>
          {current && benched.has(current) ? (
            (() => {
              const bench = benchFor(model.benches, current);
              if (!bench) return null;
              if (benchStatus(bench) === 'failed') {
                return (
                  <span className="text-amber-200">Banc raté sur ce modèle : possible, mais déconseillé.</span>
                );
              }
              if (benchStatus(bench) === 'incomplete') {
                return (
                  <span className="text-amber-200">
                    Banc incomplet : relance-le une fois les dépendances de la copie installées.
                  </span>
                );
              }
              return (
                <span className="flex items-center gap-1 text-emerald-200/90">
                  <Star className="size-3.5" /> Banc de code passé sur ce modèle.
                </span>
              );
            })()
          ) : current ? (
            <span className="text-slate-400">
              Pas encore passé au banc catalogue : tu peux quand même l’utiliser ; le banc réel
              ci-dessous mesure les rôles.
            </span>
          ) : null}
        </div>
      )}
    </StepCard>
  );
}
