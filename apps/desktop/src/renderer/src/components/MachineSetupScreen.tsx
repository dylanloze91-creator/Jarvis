import { selectMachineProfile, type MachineMeasure, type ProfileDecision } from '@jarvis/core';
import { JarvisOrb } from '@/components/JarvisOrb';
import { Button } from '@/components/ui/button';

const GIB = 1024 ** 3;

export function previewMachineDecision(kind: 'modest' | 'full'): ProfileDecision {
  const common: MachineMeasure = {
    failed: false,
    totalRamBytes: kind === 'modest' ? 8 * GIB : 64 * GIB,
    cpuModel: kind === 'modest' ? 'Intel Core i5-8250U' : 'Intel Core i7-9700KF',
    logicalCores: 8,
    gpus: [
      kind === 'modest'
        ? { name: 'NVIDIA GeForce GTX 1050 Ti', totalMiB: 4096 }
        : { name: 'NVIDIA GeForce RTX 2060', totalMiB: 6144 },
    ],
    gpuProbe: 'ok',
    freeDiskBytes: kind === 'modest' ? 40 * GIB : 200 * GIB,
    ollamaPresent: true,
  };
  return selectMachineProfile(common);
}

export function MachineSetupScreen({
  measuring,
  detected,
  chosen,
  model,
  percent,
  downloadLabel,
  cancellable,
  continueEnabled,
  note,
  onCancel,
  onContinue,
}: {
  measuring: boolean;
  detected: string;
  chosen: string;
  model: string;
  percent: number | null;
  downloadLabel: string;
  cancellable: boolean;
  continueEnabled: boolean;
  note: string;
  onCancel?: () => void;
  onContinue?: () => void;
}) {
  return (
    <div className="boot-stage machine-setup" data-machine-setup={measuring ? 'measuring' : 'ready'}>
      <JarvisOrb />
      <p className="relative z-10 text-[13px] font-medium tracking-wide text-slate-200">
        Préparation de Jarvis
      </p>
      {measuring ? (
        <p className="relative z-10 mt-3 max-w-md text-center text-[13px] leading-relaxed text-slate-400">
          Mesure de la mémoire, du processeur, de la carte graphique, du disque et d’Ollama…
        </p>
      ) : (
        <div className="relative z-10 mt-4 flex w-full max-w-md flex-col gap-3 px-2 text-center">
          <p className="text-[13px] leading-relaxed text-slate-200" data-machine-detected>
            {detected}
          </p>
          <p className="text-[13px] leading-relaxed text-cyan-100/90" data-machine-chosen>
            {chosen}
          </p>
          {model ? (
            <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left">
              <div className="flex items-center justify-between gap-3 text-[12px] text-slate-300">
                <span>Téléchargement de {model}</span>
                <span>{percent === null ? '' : `${percent} %`}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-cyan-300/80"
                  style={{ width: `${percent ?? 8}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">{downloadLabel}</p>
              {cancellable ? (
                <Button className="mt-3" variant="subtle" size="sm" onClick={onCancel}>
                  Annuler le téléchargement
                </Button>
              ) : null}
            </div>
          ) : null}
          {note ? <p className="text-[12px] text-slate-400">{note}</p> : null}
          <Button variant="default" disabled={!continueEnabled} onClick={onContinue}>
            Continuer
          </Button>
          <p className="text-[11px] leading-snug text-slate-500">
            Tu pourras changer ce profil plus tard dans Réglages.
          </p>
        </div>
      )}
    </div>
  );
}
