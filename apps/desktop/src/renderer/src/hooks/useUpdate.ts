import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/ipc';

/**
 * État de la mise à jour automatique, poussé par le processus principal.
 * `null` uniquement avant la première réponse de `getState()` (quelques
 * millisecondes après le montage) — l'interface ne doit rien afficher tant
 * que c'est le cas, plutôt que de deviner un état par défaut.
 */
export function useUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    void window.jarvis.update.getState().then(setState);
    return window.jarvis.update.onEvent(setState);
  }, []);

  const check = useCallback(() => window.jarvis.update.check(), []);
  const install = useCallback(() => window.jarvis.update.install(), []);

  return { state, check, install };
}
