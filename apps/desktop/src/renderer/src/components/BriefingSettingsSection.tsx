import type { Settings } from '@jarvis/core';

/** Réglages → Moi. Absent du fichier : le briefing ne se lance pas. */
export function BriefingSettingsSection({
  value,
  onChange,
}: {
  value: Settings['briefing'];
  onChange: (next: Settings['briefing']) => void;
}) {
  const briefing = value ?? {};
  const patch = (part: Partial<NonNullable<Settings['briefing']>>): void => {
    onChange({ ...briefing, ...part });
  };
  return (
    <div className="flex flex-col gap-2 text-xs text-slate-200">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={briefing.enabled === true}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        Briefing du matin
      </label>
      <p className="text-slate-400">
        « Mon briefing » ou « bonjour » au premier réveil, entre ces heures. Seuils de pluie et de vent, à ton goût.
      </p>
      <label className="flex gap-2">
        De
        <input
          className="w-14 rounded border border-white/10 bg-transparent px-1"
          inputMode="numeric"
          value={briefing.fromHour ?? 6}
          onChange={(event) => patch({ fromHour: Number(event.target.value) })}
        />
        à
        <input
          className="w-14 rounded border border-white/10 bg-transparent px-1"
          inputMode="numeric"
          value={briefing.toHour ?? 10}
          onChange={(event) => patch({ toHour: Number(event.target.value) })}
        />
      </label>
      <label className="flex gap-2">
        Pluie (mm/h)
        <input
          className="w-16 rounded border border-white/10 bg-transparent px-1"
          inputMode="decimal"
          value={briefing.rainMmPerHour ?? 1}
          onChange={(event) => patch({ rainMmPerHour: Number(event.target.value) })}
        />
        Rafales (km/h)
        <input
          className="w-16 rounded border border-white/10 bg-transparent px-1"
          inputMode="numeric"
          value={briefing.gustKmh ?? 50}
          onChange={(event) => patch({ gustKmh: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}
