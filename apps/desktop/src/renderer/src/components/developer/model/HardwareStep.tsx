import { Cpu, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { CheckList } from '../parts';
import { dateTime, gb, tokValue } from './format';
import { MeasureBadge, StepCard, type FlowStatus } from './StepCard';

/** Étape 1 : matériel (RAM, carte graphique, disque, Ollama), puis étalonnage sur un modèle déjà installé. */
export function HardwareStep({
  model,
  busy,
  status,
  onCheck,
  onCalibrate,
}: {
  model: CodeModelState;
  busy: boolean;
  status: FlowStatus;
  onCheck: () => void;
  onCalibrate: (name: string) => void;
}) {
  const { hardware, calibration, calibrationModel } = model;
  const ollamaUp = hardware?.facts.ollama.status === 'detected';
  return (
    <StepCard
      number={1}
      title="Matériel et étalonnage (rien n’est téléchargé)"
      status={status}
      hint={hardware ? `vérifié le ${dateTime(hardware.at)}` : undefined}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={hardware ? 'ghost' : 'default'}
          disabled={busy}
          onClick={onCheck}
        >
          <Cpu className="size-3.5" />{' '}
          {hardware ? 'Revérifier le matériel' : 'Vérifier le matériel'}
        </Button>
        {hardware && calibrationModel ? (
          <Button
            size="sm"
            variant={calibration ? 'ghost' : 'default'}
            disabled={busy || !ollamaUp}
            onClick={() => onCalibrate(calibrationModel)}
          >
            <Gauge className="size-3.5" />{' '}
            {calibration ? 'Refaire l’étalonnage' : `Étalonner avec ${calibrationModel}`}
          </Button>
        ) : null}
      </div>
      {hardware ? <CheckList checks={hardware.report.checks} /> : null}
      {hardware && !calibrationModel ? (
        <p className="text-xs text-slate-400">
          Aucun modèle de discussion déjà installé pour étalonner : les estimations utiliseront des
          débits par défaut, moins fiables.
        </p>
      ) : null}
      {calibration ? <CalibrationSummary calibration={calibration} /> : null}
      {hardware && calibrationModel && !calibration ? (
        <p className="text-xs leading-snug text-slate-400">
          L’étalonnage fait écrire environ 160 jetons à {calibrationModel} deux fois : une fois
          normalement, une fois sur le processeur seul. Il mesure la vitesse réelle de ta carte
          graphique et de ta RAM pour corriger les estimations des candidats. Environ une minute.
        </p>
      ) : null}
    </StepCard>
  );
}

function CalibrationSummary({
  calibration,
}: {
  calibration: NonNullable<CodeModelState['calibration']>;
}) {
  const rate = (bytesPerSec: number | null) =>
    bytesPerSec === null ? '—' : `${gb(bytesPerSec, 0)}/s`;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs">
      <span className="flex items-center gap-2 text-slate-200">
        Étalonnage du {dateTime(calibration.at)} <MeasureBadge />
      </span>
      <ul className="flex flex-col gap-0.5 text-slate-300">
        {calibration.runs.map((run) => (
          <li key={run.mode}>
            {run.model} · {run.mode === 'auto' ? 'placement normal' : 'processeur seul'} :{' '}
            {tokValue(run.outputMs > 0 ? run.outputTokens / (run.outputMs / 1000) : null)}
            {run.mode === 'auto' ? `, ${gb(run.sizeVramBytes)} sur la carte` : ''}
          </li>
        ))}
      </ul>
      <span className="text-slate-400">
        Débit utile déduit : carte graphique {rate(calibration.gpuBytesPerSec)}, RAM{' '}
        {rate(calibration.ramBytesPerSec)}.
      </span>
    </div>
  );
}
