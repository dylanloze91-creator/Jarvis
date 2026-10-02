import type { Prediction } from '@jarvis/core';
import { AlertTriangle, CheckCircle2, HardDriveDownload } from 'lucide-react';
import type { CodeModelCandidate } from '../../../../../shared/developerIpc';
import { cn } from '@/lib/utils';
import { gb, PLACEMENT_LABEL, tokRange } from './format';
import { EstimateBadge } from './StepCard';

export interface Selection {
  modelId: string;
  expertsInRam: boolean;
}

/** Un candidat du catalogue : réglages, puis une ligne d’estimation par mode (normal, experts en RAM). */
export function CandidateCard({
  candidate,
  selection,
  onSelect,
}: {
  candidate: CodeModelCandidate;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const { spec } = candidate;
  const selectedHere = selection.modelId === spec.id;
  return (
    <div
      data-candidate={spec.id}
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2.5',
        selectedHere ? 'border-cyan-300/35 bg-cyan-300/[0.05]' : 'border-white/8 bg-black/15',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-slate-100">{spec.label}</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-px text-[11px] text-slate-300">
          {spec.roleLabel}
        </span>
        {candidate.installed ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            <CheckCircle2 className="size-3" /> déjà installé
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <HardDriveDownload className="size-3" /> {gb(spec.downloadBytes)} à télécharger
          </span>
        )}
      </div>
      <p className="font-mono text-[11px] leading-snug text-slate-400">
        {spec.id} · {spec.quantization} · contexte {spec.contextTokens.toLocaleString('fr-FR')}{' '}
        jetons ·{' '}
        {spec.architecture === 'moe'
          ? `MoE ${spec.totalParamsB}B (${spec.activeParamsB}B actifs)`
          : `dense ${spec.totalParamsB}B`}
        {' · '}couches GPU : {spec.gpuLayers === undefined ? 'auto' : spec.gpuLayers}
      </p>
      <p className="text-[11px] leading-snug text-slate-400">{spec.placement}</p>
      <div className="flex flex-col gap-1.5">
        {candidate.auto ? (
          <PredictionRow
            label="Réglage normal"
            prediction={candidate.auto}
            checked={selectedHere && !selection.expertsInRam}
            onSelect={() => onSelect({ modelId: spec.id, expertsInRam: false })}
          />
        ) : null}
        {candidate.experts ? (
          <PredictionRow
            label="Experts en RAM (option)"
            prediction={candidate.experts}
            checked={selectedHere && selection.expertsInRam}
            onSelect={() => onSelect({ modelId: spec.id, expertsInRam: true })}
          />
        ) : null}
      </div>
    </div>
  );
}

function PredictionRow({
  label,
  prediction,
  checked,
  onSelect,
}: {
  label: string;
  prediction: Prediction;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        'no-drag flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-xs',
        checked ? 'bg-cyan-300/[0.08]' : 'hover:bg-white/[0.03]',
        !prediction.fits && 'opacity-70',
      )}
    >
      <input
        type="radio"
        name="code-model"
        className="mt-0.5 accent-cyan-300"
        checked={checked}
        onChange={onSelect}
      />
      <span className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-200">
          {label} : {PLACEMENT_LABEL[prediction.placement]}
          <EstimateBadge />
        </span>
        <span className="text-slate-300">
          ≈ {tokRange(prediction.tokPerSec)} ({prediction.basis}) · publié{' '}
          {tokRange(prediction.publishedTokPerSec)} · carte ≈ {gb(prediction.vramBytes)} · RAM ≈{' '}
          {gb(prediction.ramBytes)}
        </span>
        {!prediction.fits ? (
          <span className="flex items-center gap-1 text-amber-200">
            <AlertTriangle className="size-3" /> Ne tiendrait pas sur ce PC.
          </span>
        ) : null}
        {prediction.notes.length ? (
          <span className="text-[11px] text-slate-500">{prediction.notes.join(' ')}</span>
        ) : null}
      </span>
    </label>
  );
}
