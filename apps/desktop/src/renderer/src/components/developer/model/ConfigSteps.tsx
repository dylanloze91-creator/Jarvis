import { BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { CandidateCard, type Selection } from './CandidateCard';
import { ExpertsCard } from './ExpertsCard';
import { dateTime, gb, PLACEMENT_LABEL, tokRange } from './format';
import { EstimateBadge, StepCard, type FlowStatus } from './StepCard';

/** Étape 2 : configuration proposée pour chaque candidat, avec des estimations (jamais des mesures). */
export function ProposalStep({
  model,
  status,
  busy,
  selection,
  onSelect,
  onConfirmExperts,
}: {
  model: CodeModelState;
  status: FlowStatus;
  busy: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onConfirmExperts: (applied: boolean) => void;
}) {
  return (
    <StepCard number={2} title="Configuration proposée" status={status} hint="chiffres estimés">
      <p className="flex flex-wrap items-center gap-1.5 text-xs leading-snug text-slate-400">
        <EstimateBadge /> Vitesses et mémoire sont calculées à partir de ton matériel
        {model.calibration ? ' et de l’étalonnage' : ''}, à ±25 %. Les chiffres publiés viennent de
        tests sur des cartes de 6 Go. Seul le banc de code (étape 5) mesure vraiment.
      </p>
      <div className="flex flex-col gap-2">
        {model.candidates.map((candidate) => (
          <CandidateCard
            key={candidate.spec.id}
            candidate={candidate}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
      </div>
      {selection.expertsInRam ? (
        <ExpertsCard experts={model.experts} busy={busy} onConfirm={onConfirmExperts} />
      ) : null}
    </StepCard>
  );
}

/** Étape 3 : validation explicite de la configuration choisie. Rien n’est téléchargé ici. */
export function ValidateStep({
  model,
  status,
  busy,
  selection,
  onValidate,
}: {
  model: CodeModelState;
  status: FlowStatus;
  busy: boolean;
  selection: Selection;
  onValidate: (selection: Selection) => void;
}) {
  const candidate = model.candidates.find((c) => c.spec.id === selection.modelId);
  const prediction = selection.expertsInRam ? candidate?.experts : candidate?.auto;
  const validation = model.validation;
  const sameAsValidated =
    validation?.modelId === selection.modelId && validation.expertsInRam === selection.expertsInRam;
  const blocked = !prediction
    ? 'Choisis un candidat à l’étape 2.'
    : !prediction.fits
      ? 'Cette configuration ne tiendrait pas sur ce PC.'
      : prediction.diskOk === false
        ? 'Pas assez de place sur le disque des modèles.'
        : selection.expertsInRam && !model.experts.confirmedAt
          ? 'Applique d’abord les réglages « experts en RAM » et confirme-le (étape 2).'
          : null;
  return (
    <StepCard number={3} title="Ta validation" status={status}>
      {candidate && prediction ? (
        <p className="text-xs leading-snug text-slate-200">
          {candidate.spec.label} : {PLACEMENT_LABEL[prediction.placement]}, carte ≈{' '}
          {gb(prediction.vramBytes)}, RAM ≈ {gb(prediction.ramBytes)}, ≈{' '}
          {tokRange(prediction.tokPerSec)} <EstimateBadge />
        </p>
      ) : null}
      {validation ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-200">
          <BadgeCheck className="size-3.5" /> Validée le {dateTime(validation.at)} :{' '}
          {model.candidates.find((c) => c.spec.id === validation.modelId)?.spec.label ??
            validation.modelId}
          {validation.expertsInRam ? ', experts en RAM' : ''}.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || blocked !== null || sameAsValidated}
          onClick={() => onValidate(selection)}
        >
          <BadgeCheck className="size-3.5" />
          {validation && !sameAsValidated ? 'Valider ce changement' : 'Valider cette configuration'}
        </Button>
        <span className="text-[11px] text-slate-400">
          {blocked ??
            'Rien n’est téléchargé à cette étape. Le téléchargement est une étape à part.'}
        </span>
      </div>
    </StepCard>
  );
}
