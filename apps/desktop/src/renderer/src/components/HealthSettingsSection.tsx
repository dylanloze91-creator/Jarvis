import { useEffect, useState } from 'react';
import type { HealthReport } from '@jarvis/core';
import { SETTINGS_ACTION_MAP, SETTINGS_FIELD_MAP } from '@jarvis/core';
import { Button } from '@/components/ui/button';

const LEVEL = { green: 'Tout va bien', orange: 'À regarder', red: 'À régler' } as const;

export function HealthSettingsSection() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.jarvis.health.current().then(setReport);
    return window.jarvis.health.onReport(setReport);
  }, []);

  const refresh = (): void => {
    setBusy(true);
    void window.jarvis.health.refresh().then((next) => {
      setReport(next);
      setBusy(false);
    });
  };

  const open = (key: string): void => {
    const target = SETTINGS_FIELD_MAP[key] ?? SETTINGS_ACTION_MAP[key];
    if (!target) return;
    window.dispatchEvent(new CustomEvent('jarvis-settings-navigate', { detail: target }));
  };

  return (
    <div className="flex flex-col gap-2" id="settings-health">
      {(report?.items ?? []).map((item) => (
        <div key={`${item.id}-${item.sentence}`} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{LEVEL[item.level]}</p>
            <p className="text-sm leading-snug text-slate-100">{item.sentence}</p>
          </div>
          <Button type="button" size="sm" variant="subtle" onClick={() => open(item.open)}>
            Ouvrir
          </Button>
        </div>
      ))}
      {!report ? <p className="text-sm text-slate-400">Le bilan se prépare.</p> : null}
      <Button type="button" size="sm" variant="default" disabled={busy} onClick={refresh}>
        {busy ? 'Bilan en cours…' : 'Refaire le bilan'}
      </Button>
    </div>
  );
}
