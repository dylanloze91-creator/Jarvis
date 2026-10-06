import { useEffect, useState } from 'react';
import type { DeveloperApi, DeveloperState } from '../../../../../shared/developerIpc';
import type { Selection } from './CandidateCard';
import { ChooseStep } from './ChooseStep';
import { ProposalStep, ValidateStep } from './ConfigSteps';
import { HardwareStep } from './HardwareStep';
import { RealBenchSection } from './RealBenchSection';
import { RoleModelsSection } from './RoleModelsSection';
import type { RoleModels, SpecialistRole } from '@jarvis/core';
import { InstalledOllamaSection } from './InstalledOllamaSection';
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
  roleModels,
  onChooseRole,
}: {
  state: DeveloperState;
  act: Act;
  codeModel: string;
  chatModel: string;
  onChooseDefault: (modelId: string) => Promise<void>;
  roleModels: RoleModels;
  onChooseRole: (role: SpecialistRole, model: string | null) => Promise<void>;
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
  useEffect(() => {
    act((api) => api.refreshOllamaModels());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois à l’ouverture de l’onglet
  }, []);
  const [saving, setSaving] = useState(false);

  const busy = state.busy;
  const hardwareDone = Boolean(model.hardware && (model.calibration || !model.calibrationModel));
  const validated = model.candidates.find((c) => c.spec.id === model.validation?.modelId);
  const anyInstalled = model.candidates.some((c) => c.installed);
  const benched = model.benches.length > 0;
  const canChooseCodeModel = model.installedModels.length > 0;

  return (
    <div className="flex flex-col gap-3" data-code-model-panel>
      <InstalledOllamaSection
        model={model}
        busy={busy}
        onRefresh={() => act((api) => api.refreshOllamaModels())}
        onPull={(name) => act((api) => api.pullOllamaModel(name))}
      />
      {model.candidates.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-slate-300">
          Profil modeste : les gros modèles de code ne sont pas proposés, et le modèle de 23 Go
          n’est pas téléchargé. Le modèle de discussion reste celui du chat.
        </p>
      ) : null}
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
        status={flow(Boolean(codeModel), canChooseCodeModel)}
        current={codeModel}
        chatModel={chatModel}
        saving={saving}
        onChoose={(id) => {
          setSaving(true);
          void onChooseDefault(id).finally(() => setSaving(false));
        }}
      />
      <RoleModelsSection
        state={state}
        codeModel={codeModel}
        roleModels={roleModels}
        saving={saving}
        onChange={(role, model) => {
          setSaving(true);
          void onChooseRole(role, model).finally(() => setSaving(false));
        }}
      />
      <RealBenchSection state={state} onRun={(id) => act((api) => api.realBenchmark(id))} />
    </div>
  );
}
