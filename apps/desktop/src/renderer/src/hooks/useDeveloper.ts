import { useCallback, useEffect, useState } from 'react';
import type { DeveloperApi, DeveloperState } from '../../../shared/developerIpc';

type Action = (api: DeveloperApi) => Promise<DeveloperState | void>;

/** État de Jarvis Développeur, poussé par le processus principal à chaque changement. */
export function useDeveloper(refreshKey?: unknown) {
  const [state, setState] = useState<DeveloperState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.jarvis.developer
      .status()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    const unsubscribe = window.jarvis.developer.onEvent((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshKey]);

  const act = useCallback((action: Action) => {
    setError(null);
    void action(window.jarvis.developer)
      .then((next) => {
        if (next) setState(next);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  return { state, error, act };
}
