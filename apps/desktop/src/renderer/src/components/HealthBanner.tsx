import { useEffect, useState } from 'react';
import type { HealthReport } from '@jarvis/core';

/** Bandeau d'accueil : rien si tout est vert. */
export function HealthBanner({ onOpen }: { onOpen: () => void }) {
  const [report, setReport] = useState<HealthReport | null>(null);

  useEffect(() => {
    let alive = true;
    void window.jarvis.health.current().then((current) => {
      if (alive && current) setReport(current);
    });
    const stop = window.jarvis.health.onReport((next) => setReport(next));
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (!report?.banner) return null;
  return (
    <button
      type="button"
      className="no-drag mx-4 mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-left text-sm text-amber-50 hover:bg-amber-300/15"
      onClick={onOpen}
    >
      {report.banner}
    </button>
  );
}
