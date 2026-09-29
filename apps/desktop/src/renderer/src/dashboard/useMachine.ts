import { useEffect, useState } from 'react';
import type { MachineSnapshot } from '../../../shared/ipc';

export function useMachineSnapshot(): {
  snapshot: MachineSnapshot | null;
  loading: boolean;
  error: string | null;
} {
  const [snapshot, setSnapshot] = useState<MachineSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void window.jarvis.system
        .snapshot()
        .then((value) => {
          if (cancelled) return;
          setSnapshot(value);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setError(reason instanceof Error ? reason.message : 'indisponible');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return { snapshot, loading, error };
}
