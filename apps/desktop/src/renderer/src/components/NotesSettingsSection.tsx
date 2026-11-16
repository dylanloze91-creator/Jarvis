import type { Settings } from '@jarvis/core';

/** Réglages → Moi. Absent du fichier : les notes ne changent rien. */
export function NotesSettingsSection({
  value,
  onChange,
}: {
  value: Settings['notes'];
  onChange: (next: Settings['notes']) => void;
}) {
  const enabled = value?.enabled === true;
  return (
    <label className="flex items-center gap-2 text-xs text-slate-200">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onChange({ enabled: event.target.checked })}
      />
      Notes et liste
    </label>
  );
}
