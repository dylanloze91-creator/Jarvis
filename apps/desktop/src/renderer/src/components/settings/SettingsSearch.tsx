import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { SETTINGS_SEARCH_INDEX } from '@jarvis/core';
import { Input } from '@/components/ui/field';
import type { SettingsNavigationTarget } from './settingsDeepLinks';

interface Props {
  onNavigate: (target: SettingsNavigationTarget) => void;
}

export function SettingsSearch({ onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('fr-FR');

  const hits = useMemo(() => {
    if (!normalized) return [];
    return SETTINGS_SEARCH_INDEX.filter((entry) => {
      const hay = `${entry.label} ${entry.keywords.join(' ')}`.toLocaleLowerCase('fr-FR');
      return hay.includes(normalized);
    }).slice(0, 8);
  }, [normalized]);

  return (
    <div className="relative flex flex-col gap-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-500" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher un réglage…"
          className="pl-8"
          aria-label="Rechercher un réglage"
        />
      </div>
      {hits.length > 0 ? (
        <ul className="absolute top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-white/10 bg-[#0a101c] py-1 shadow-lg">
          {hits.map((entry) => (
            <li key={`${entry.category}-${entry.subcategory}-${entry.label}`}>
              <button
                type="button"
                className="no-drag w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.06]"
                onClick={() => {
                  onNavigate({
                    category: entry.category,
                    subcategory: entry.subcategory,
                    highlight: entry.highlight ?? entry.subcategory,
                  });
                  setQuery('');
                }}
              >
                <span className="font-medium">{entry.label}</span>
                <span className="ml-2 text-slate-500">{entry.category}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
