import { useEffect, useState } from 'react';
import type { QuestionnaireState, Settings } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { RuntimeStatus } from '../../../../shared/ipc';

interface Props {
  onSettingsApplied: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  onRestartOnboarding: () => void;
}

export function QuestionnaireSettingsSection({ onSettingsApplied, onRestartOnboarding }: Props) {
  const [state, setState] = useState<QuestionnaireState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = (): void => {
    void window.jarvis.questionnaire.get().then(setState);
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = async (action: 'apply' | 'restore'): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      if (action === 'apply') {
        const result = await window.jarvis.questionnaire.apply();
        setState(result.state);
        onSettingsApplied({ settings: result.settings, status: result.status });
        setNotice('Réponses appliquées aux réglages.');
      } else {
        const result = await window.jarvis.questionnaire.restore();
        setState(result.state);
        if (result.settings) {
          onSettingsApplied({ settings: result.settings, status: result.status });
          setNotice('Réglages restaurés (avant la dernière application).');
        } else {
          setNotice('Aucune sauvegarde à restaurer.');
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-snug text-slate-500">
        Le questionnaire d’accueil enregistre tes réponses dans un fichier à part. Tu peux réappliquer
        les réponses ou revenir aux réglages d’avant.
      </p>
      {state?.completedAt ? (
        <p className="text-xs text-slate-400">
          Terminé le {new Date(state.completedAt).toLocaleString('fr-FR')}.
        </p>
      ) : state?.dismissed ? (
        <p className="text-xs text-slate-400">Passé pour l’instant.</p>
      ) : (
        <p className="text-xs text-slate-400">Pas encore terminé.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => void run('apply')}>
          Appliquer les réponses
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !state?.settingsBackup}
          onClick={() => void run('restore')}
        >
          Restaurer les réglages
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRestartOnboarding}>
          Refaire le questionnaire
        </Button>
      </div>
      {notice ? <p className="text-xs text-slate-300">{notice}</p> : null}
    </div>
  );
}
