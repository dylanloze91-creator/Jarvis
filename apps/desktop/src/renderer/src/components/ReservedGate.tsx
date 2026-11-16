import { useEffect, useState, type ReactNode } from 'react';
import type { EditionView, ReservedName } from '../../../shared/ipc';
import { Button } from '@/components/ui/button';

/**
 * Dans Test, une fonction réservée à Live montre la phrase et un bouton.
 * Le bouton demande d'abord si la place est libre. Live : le contenu habituel.
 */
export function ReservedGate({ name, children }: { name: ReservedName; children: ReactNode }) {
  const [view, setView] = useState<EditionView | null>(null);
  const [ready, setReady] = useState(() => !window.jarvis.edition);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = window.jarvis.edition;
    if (!api) return;
    let stop = false;
    void api.state().then((state) => {
      if (stop) return;
      setView(state);
      setReady(true);
    });
    return () => {
      stop = true;
    };
  }, []);

  if (!ready) return null;
  if (!view?.held[name]) return <>{children}</>;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-orange-400/40 bg-orange-400/10 px-3 py-2.5">
      <p className="text-sm text-orange-100">{view.phrase}</p>
      {notice ? <p className="text-xs text-rose-200">{notice}</p> : null}
      <Button
        type="button"
        variant="subtle"
        size="sm"
        disabled={busy}
        onClick={() => {
          const api = window.jarvis.edition;
          if (!api) return;
          setBusy(true);
          setNotice(null);
          void api
            .claim(name)
            .then((result) => {
              setView(result.state);
              if (!result.ok) setNotice(result.sentence ?? view.phrase);
            })
            .finally(() => setBusy(false));
        }}
      >
        Activer quand même
      </Button>
    </div>
  );
}
