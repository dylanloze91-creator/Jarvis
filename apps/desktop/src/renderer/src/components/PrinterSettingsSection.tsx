import { useState } from 'react';
import type { Settings } from '@jarvis/core';

/** Réglages → Services. Absent : l'imprimante ne change rien. */
export function PrinterSettingsSection({
  value,
  onChange,
}: {
  value: Settings['printer'];
  onChange: (next: Settings['printer']) => void;
}) {
  const printer = value ?? {};
  const [result, setResult] = useState('');
  const patch = (part: Partial<NonNullable<Settings['printer']>>): void => {
    onChange({ ...printer, ...part });
  };
  return (
    <div className="flex flex-col gap-2 text-xs text-slate-200">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={printer.enabled === true}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        Imprimante 3D
      </label>
      <p className="text-slate-400">
        Adresse Moonraker sur le réseau local seulement. Le lancement demande une confirmation et rappelle de vérifier le plateau. Une enceinte ne lance pas d'impression.
      </p>
      <label className="flex flex-col gap-1">
        Adresse
        <input
          className="rounded border border-white/10 bg-transparent px-1"
          value={printer.baseUrl ?? ''}
          placeholder="http://imprimante.local:7125"
          onChange={(event) => patch({ baseUrl: event.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Clé API, facultative
        <input
          className="rounded border border-white/10 bg-transparent px-1"
          type="password"
          value={printer.apiKey ?? ''}
          onChange={(event) => patch({ apiKey: event.target.value })}
        />
      </label>
      <button
        type="button"
        className="quick-btn w-fit"
        onClick={() => {
          void window.jarvis.printer.test().then((report) => setResult(report.text));
        }}
      >
        Tester
      </button>
      {result ? <p className="text-slate-300">{result}</p> : null}
    </div>
  );
}
