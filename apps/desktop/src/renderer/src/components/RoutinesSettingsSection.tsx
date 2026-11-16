import { useEffect, useState } from 'react';
import type { Routine, RoutineStep, Settings } from '@jarvis/core';

/** Réglages → Services. Absent du fichier : aucune routine, aucune équipe Tâches. */
export function RoutinesSettingsSection({
  value,
  onChange,
}: {
  value: Settings['routines'];
  onChange: (next: Settings['routines']) => void;
}) {
  const enabled = value?.enabled === true;
  const [items, setItems] = useState<Routine[]>([]);
  const [name, setName] = useState('Travail');
  const [kind, setKind] = useState<RoutineStep['tool']>('open_application');
  const [detail, setDetail] = useState('Chrome');
  const reload = () => {
    void window.jarvis.routines.list().then(setItems);
  };
  useEffect(reload, []);
  const add = () => {
    const step = stepFrom(kind, detail);
    if (!step || !name.trim()) return;
    const existing = items.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
    const steps = [...(existing?.steps ?? []), step];
    void window.jarvis.routines.save({ name: name.trim(), steps }).then((next) => setItems(next));
  };
  return (
    <div className="flex flex-col gap-2 text-xs text-slate-200">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        Routines
      </label>
      <p className="text-slate-400">
        À la voix : « crée une routine Travail : ouvre Chrome, mets ma playlist Focus ». Rien n'est gardé sans « C'est bon ».
      </p>
      {enabled ? (
        <>
          <ul className="text-slate-300">
            {items.length === 0 ? <li>Aucune routine.</li> : null}
            {items.map((routine) => (
              <li key={routine.name}>
                {routine.name} — {routine.steps.map((step) => step.label).join(', ')}
              </li>
            ))}
          </ul>
          <label className="flex flex-wrap items-center gap-2">
            Nom
            <input className="w-28 rounded border border-white/10 bg-transparent px-1" value={name} onChange={(event) => setName(event.target.value)} />
            <select className="rounded border border-white/10 bg-slate-900 px-1" value={kind} onChange={(event) => setKind(event.target.value as RoutineStep['tool'])}>
              <option value="open_application">Ouvrir une appli</option>
              <option value="spotify_play">Playlist</option>
              <option value="siteblock_start_focus">Concentration (minutes)</option>
              <option value="briefing">Briefing</option>
            </select>
            <input className="w-28 rounded border border-white/10 bg-transparent px-1" value={detail} onChange={(event) => setDetail(event.target.value)} />
            <button type="button" className="quick-btn" onClick={add}>
              Ajouter l'étape
            </button>
          </label>
        </>
      ) : null}
    </div>
  );
}

function stepFrom(kind: RoutineStep['tool'], detail: string): RoutineStep | null {
  if (kind === 'briefing') return { label: 'briefing', tool: 'briefing', args: {}, dependsOnPrevious: false };
  if (kind === 'open_application') {
    const name = detail.trim();
    if (!name) return null;
    return { label: `ouvrir ${name}`, tool: 'open_application', args: { name }, dependsOnPrevious: false };
  }
  if (kind === 'spotify_play') {
    const query = detail.trim();
    if (!query) return null;
    return { label: `playlist ${query}`, tool: 'spotify_play', args: { query }, dependsOnPrevious: false };
  }
  const minutes = Number(detail);
  if (!Number.isFinite(minutes) || minutes < 1) return null;
  return { label: `concentration ${minutes} min`, tool: 'siteblock_start_focus', args: { minutes }, dependsOnPrevious: false };
}
