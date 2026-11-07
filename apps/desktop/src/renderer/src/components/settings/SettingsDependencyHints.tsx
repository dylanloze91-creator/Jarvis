import { SETTINGS_DEPENDENCY_HINTS, type Settings } from '@jarvis/core';

export function SettingsDependencyHints({ settings }: { settings: Settings }) {
  const active = SETTINGS_DEPENDENCY_HINTS.filter((hint) => hint.when(settings));
  if (active.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {active.map((hint) => (
        <p
          key={hint.id}
          role="status"
          className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs leading-snug text-amber-100"
        >
          {hint.message}
        </p>
      ))}
    </div>
  );
}
