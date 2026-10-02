import { useEffect, useState } from 'react';
import type { Settings } from '@jarvis/core';
import { MachineSetupScreen } from '@/components/MachineSetupScreen';
import type { MachineAnalysis, RuntimeStatus } from '../../../shared/ipc';

/** Écran de premier lancement, ou relance depuis Réglages. Le chat reste inutilisable tant que ce n’est pas terminé. */
export function MachineSetupFlow({
  onDone,
}: {
  onDone: (payload: { settings: Settings; status: RuntimeStatus }) => void;
}) {
  const [measuring, setMeasuring] = useState(true);
  const [analysis, setAnalysis] = useState<MachineAnalysis | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [downloadLabel, setDownloadLabel] = useState('Préparation du téléchargement…');
  const [cancellable, setCancellable] = useState(false);
  const [note, setNote] = useState('');
  const [continueEnabled, setContinueEnabled] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let stop = (): void => undefined;
    let cancelled = false;
    void (async () => {
      const result = await window.jarvis.machine.analyze();
      if (cancelled) return;
      setAnalysis(result);
      setMeasuring(false);
      if (!result.download.allowed) {
        if (result.download.alreadyInstalled) setNote('Le modèle est déjà installé. Rien n’est téléchargé.');
        else if (!result.download.ollamaPresent) setNote('Ollama est absent : rien n’est téléchargé.');
        else setNote('Aucun téléchargement : un profil ou des réglages existent déjà.');
        setDownloadLabel('Pas de téléchargement.');
        setContinueEnabled(true);
        return;
      }
      setCancellable(true);
      setDownloadLabel('Téléchargement du modèle de discussion. Tu peux l’annuler.');
      stop = window.jarvis.machine.onPull((progress) => {
        const next = progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : null;
        setPercent(next);
        if (progress.status) setDownloadLabel(progress.status);
      });
      const pull = await window.jarvis.machine.pull();
      stop();
      if (cancelled) return;
      setCancellable(false);
      if (pull.cancelled) {
        setNote('Téléchargement annulé. Le profil sera quand même enregistré.');
        setDownloadLabel('Téléchargement annulé.');
      } else if (!pull.ok) {
        setNote(pull.error ?? 'Le téléchargement n’a pas abouti.');
      } else {
        setPercent(100);
        setNote('Modèle de discussion prêt.');
        setDownloadLabel('Terminé.');
      }
      setContinueEnabled(true);
    })().catch((error: unknown) => {
      if (cancelled) return;
      setMeasuring(false);
      setAnalysis({
        detected: 'La mesure de la machine a échoué.',
        chosen:
          'Profil modeste par précaution : petit modèle, réveil coupé, synthèse Windows, vidéo et développeur coupés.',
        profile: 'modest',
        chatModel: 'qwen2.5:1.5b',
        cpuOnly: true,
        measureFailed: true,
        download: { allowed: false, alreadyInstalled: false, ollamaPresent: false },
      });
      setNote(error instanceof Error ? error.message : 'La mesure a échoué.');
      setContinueEnabled(true);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <MachineSetupScreen
      measuring={measuring}
      detected={analysis?.detected ?? ''}
      chosen={analysis?.chosen ?? ''}
      model={analysis?.chatModel ?? ''}
      percent={percent}
      downloadLabel={downloadLabel}
      cancellable={cancellable}
      continueEnabled={continueEnabled && !applying}
      note={note}
      onCancel={() => {
        void window.jarvis.machine.cancelPull();
      }}
      onContinue={() => {
        if (!continueEnabled || applying) return;
        setApplying(true);
        void window.jarvis.machine.apply().then(onDone);
      }}
    />
  );
}
