import type { ReactNode } from 'react';
import { AppWindow, Bot, Code2, Mail, Mic, Music, RefreshCw, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const SETTINGS_TABS = [
  { id: 'voice', label: 'Voix et détection', icon: Mic },
  { id: 'model', label: 'Modèle IA', icon: Bot },
  { id: 'search', label: 'Recherche et mémoire', icon: Search },
  { id: 'spotify', label: 'Spotify', icon: Music },
  { id: 'google', label: 'Google', icon: Mail },
  { id: 'tools', label: 'Outils et sécurité', icon: ShieldCheck },
  { id: 'general', label: 'Fenêtre et démarrage', icon: AppWindow },
  { id: 'updates', label: 'Mises à jour', icon: RefreshCw },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: LucideIcon }>;

/** Onglet masqué : ouvert seulement via openSettingsOnTab('developer'). */
export const SETTINGS_HIDDEN_TABS = [
  { id: 'developer', label: 'Développeur (avancé)', icon: Code2 },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: LucideIcon }>;

const ALL_SETTINGS_TABS = [...SETTINGS_TABS, ...SETTINGS_HIDDEN_TABS];

export type SettingsTabId = (typeof ALL_SETTINGS_TABS)[number]['id'];

export function SettingsTabBar({
  active,
  onChange,
}: {
  active: SettingsTabId;
  onChange: (tab: SettingsTabId) => void;
}) {
  const move = (offset: number): void => {
    const index = ALL_SETTINGS_TABS.findIndex((tab) => tab.id === active);
    const next = ALL_SETTINGS_TABS[(index + offset + ALL_SETTINGS_TABS.length) % ALL_SETTINGS_TABS.length]!;
    onChange(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Catégories de réglages"
      className="flex flex-wrap gap-1.5 rounded-xl border border-white/8 bg-white/[0.025] p-1.5"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') move(1);
        else if (event.key === 'ArrowLeft') move(-1);
      }}
    >
      {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            id={`settings-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`settings-panel-${id}`}
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

/** Les onglets inactifs restent montés (cachés) : un brouillon ou un test en cours n'est pas perdu. */
export function TabPanel({ id, active, children }: { id: SettingsTabId; active: SettingsTabId; children: ReactNode }) {
  return (
    <div
      id={`settings-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`settings-tab-${id}`}
      hidden={id !== active}
      className="flex flex-col gap-4"
    >
      {children}
    </div>
  );
}
