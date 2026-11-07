import { cn } from '@/lib/utils';
import { SETTINGS_CATEGORIES, type SettingsCategoryId } from './settingsCategories';

export function SettingsCategoryNav({
  active,
  onChange,
}: {
  active: SettingsCategoryId;
  onChange: (category: SettingsCategoryId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Catégories de réglages"
      className="flex flex-wrap gap-1.5 rounded-xl border border-white/8 bg-white/[0.025] p-1.5"
    >
      {SETTINGS_CATEGORIES.map(({ id, label, icon: Icon }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            id={`settings-category-${id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              'no-drag flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              selected
                ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(57,220,255,0.28)]'
                : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
