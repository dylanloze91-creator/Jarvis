import { useEffect, useState } from 'react';
import type { DeveloperApi, DeveloperState } from '../../../../../shared/developerIpc';
import type { Selection } from './CandidateCard';
import { ChooseStep } from './ChooseStep';
import { ProposalStep, ValidateStep } from './ConfigSteps';
import { HardwareStep } from './HardwareStep';
import { BenchStep, PullStep } from './RunSteps';
import type { FlowStatus } from './StepCard';

type Act = (action: (api: DeveloperApi) => Promise<DeveloperState | void>) => void;

function flow(done: boolean, unlocked: boolean): FlowStatus {
  return done ? 'done' : unlocked ? 'current' : 'locked';
}

/**
 * Onglet « Modèle de code » : matériel → étalonnage → configuration proposée (estimations) →
 * validation → téléchargement confirmé → banc → choix. Chaque étape attend la précédente,
 * et le processus principal refait les mêmes vérifications.
 */
export function CodeModelPanel({
  state,
  act,
  codeModel,
  chatModel,
  onChooseDefault,
}: {
  state: DeveloperState;
  act: Act;
  codeModel: string;
  chatModel: string;
  onChooseDefault: (modelId: string) => Promise<void>;
}) {
  const model = state.model;
  const [selection, setSelection] = useState<Selection>(() => ({
    modelId: model.validation?.modelId ?? model.candidates[0]?.spec.id ?? '',
    expertsInRam: model.validation?.expertsInRam ?? false,
  }));
  const validationKey = model.validation
    ? `${model.validation.modelId}:${model.validation.at}`
    : '';
  useEffect(() => {
    if (model.validation) {
      setSelection({
        modelId: model.validation.modelId,
        expertsInRam: model.validation.expertsInRam,
      });
    }
  }, [validationKey]);
  const [saving, setSaving] = useState(false);

  const busy = state.busy;
  const hardwareDone = Boolean(model.hardware && (model.calibration || !model.calibrationModel));
  const validated = model.candidates.find((c) => c.spec.id === model.validation?.modelId);
  const anyInstalled = model.candidates.some((c) => c.installed);
  const benched = model.benches.length > 0;

  return (
    <div className="flex flex-col gap-3" data-code-model-panel>
      <HardwareStep
        model={model}
        busy={busy}
        status={flow(hardwareDone, true)}
        onCheck={() => act((api) => api.checkHardware())}
        onCalibrate={(name) => act((api) => api.calibrate(name))}
      />
      <ProposalStep
        model={model}
        status={flow(Boolean(model.validation), hardwareDone)}
        busy={busy}
        selection={selection}
        onSelect={setSelection}
        onConfirmExperts={(applied) => act((api) => api.confirmExperts(applied))}
      />
      <ValidateStep
        model={model}
        status={flow(Boolean(model.validation), hardwareDone)}
        busy={busy}
        selection={selection}
        onValidate={(next) => act((api) => api.validateConfig(next.modelId, next.expertsInRam))}
      />
      <PullStep
        model={model}
        status={flow(Boolean(validated?.installed), Boolean(validated))}
        busy={busy}
        onPull={(id) => act((api) => api.pull(id))}
      />
      <BenchStep
        model={model}
        status={flow(benched, Boolean(validated?.installed) || (benched && anyInstalled))}
        busy={busy}
        onBench={(id) => act((api) => api.benchmark(id))}
      />
      <ChooseStep
        model={model}
        status={flow(Boolean(codeModel), benched)}
        current={codeModel}
        chatModel={chatModel}
        saving={saving}
        onChoose={(id) => {
          setSaving(true);
          void onChooseDefault(id).finally(() => setSaving(false));
        }}
      />
    </div>
  );
}
