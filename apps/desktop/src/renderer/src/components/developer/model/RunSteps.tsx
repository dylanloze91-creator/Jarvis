import { Download, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { BenchResults } from './BenchResults';
import { gb, percent } from './format';
import { StepCard, type FlowStatus } from './StepCard';

/** Étape 4 : téléchargement séparé du modèle validé, derrière une carte de confirmation. */
export function PullStep({
  model,
  status,
  busy,
  onPull,
}: {
  model: CodeModelState;
  status: FlowStatus;
  busy: boolean;
  onPull: (modelId: string) => void;
}) {
  const validated = model.candidates.find((c) => c.spec.id === model.validation?.modelId);
  const pull = model.pull && model.pull.modelId === validated?.spec.id ? model.pull : null;
  return (
    <StepCard
      number={4}
      title="Téléchargement confirmé"
      status={status}
      hint={status === 'locked' ? 'après ta validation' : undefined}
    >
      {validated?.installed ? (
        <p className="text-xs text-emerald-200">
          {validated.spec.label} est présent dans Ollama : rien à télécharger.
        </p>
      ) : validated ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => onPull(validated.spec.id)}>
              <Download className="size-3.5" /> Télécharger {validated.spec.label} ·{' '}
              {gb(validated.spec.downloadBytes)}
            </Button>
            <span className="text-[11px] text-slate-400">
              Une carte montre la commande exacte ; rien ne part sans ton « Autoriser ».
            </span>
          </div>
          {pull ? (
            <div className="flex flex-col gap-1 text-xs" data-pull-progress>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-[width]"
                  style={{ width: `${percent(pull.completed, pull.total)}%` }}
                />
              </div>
              <span className="text-slate-400">
                {pull.done
                  ? 'Téléchargement terminé.'
                  : `${pull.status} · ${gb(pull.completed)} sur ${gb(pull.total)} (${percent(pull.completed, pull.total)} %)`}
              </span>
            </div>
          ) : null}
        </>
      ) : null}
    </StepCard>
  );
}

/** Étape 5 : banc de code complet sur un modèle installé du catalogue. */
export function BenchStep({
  model,
  status,
  busy,
  onBench,
}: {
  model: CodeModelState;
  status: FlowStatus;
  busy: boolean;
  onBench: (modelId: string) => void;
}) {
  const installed = model.candidates.filter((c) => c.installed);
  const validatedId = model.validation?.modelId;
  const benches = [...model.benches].sort((a, b) => b.finishedAt - a.finishedAt);
  return (
    <StepCard
      number={5}
      title="Banc de code"
      status={status}
      hint={status === 'locked' ? 'après le téléchargement' : undefined}
    >
      <p className="text-xs leading-snug text-slate-400">
        Cinq tâches dans un petit projet TypeScript jetable : trois appels d’outils, une
        modification exacte vérifiée par tsc, une correction d’erreur de compilation. Puis la
        vitesse, la RAM et la carte graphique, mesurées. Plusieurs minutes avec les gros modèles ;
        Jarvis ne touche pas à ta copie de travail.
      </p>
      <div className="flex flex-wrap gap-2">
        {installed.map((candidate) => (
          <Button
            key={candidate.spec.id}
            size="sm"
            variant={candidate.spec.id === validatedId ? 'default' : 'ghost'}
            disabled={busy}
            onClick={() => onBench(candidate.spec.id)}
          >
            <FlaskConical className="size-3.5" /> Banc : {candidate.spec.label}
          </Button>
        ))}
      </div>
      {benches.map((bench) => (
        <BenchResults key={`${bench.model}-${bench.expertsInRam}`} bench={bench} />
      ))}
    </StepCard>
  );
}
