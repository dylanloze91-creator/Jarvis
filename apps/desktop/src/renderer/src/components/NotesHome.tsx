import { useEffect, useState } from 'react';
import { formatNote, type NoteItem } from '@jarvis/core';

/** Petit panneau de l'accueil. Rendu seulement si les notes sont activées. */
export function NotesHome() {
  const [items, setItems] = useState<NoteItem[] | null>(null);
  const reload = () => {
    void window.jarvis.notes.list().then(setItems);
  };
  useEffect(reload, []);
  const pending = (items ?? []).filter((note) => !note.done);
  return (
    <section className="mb-3 w-full rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-100">
      <p className="font-medium">Notes</p>
      {items === null ? <p className="text-xs text-slate-400">Chargement…</p> : null}
      {items && pending.length === 0 ? <p className="text-xs text-slate-400">Aucune note.</p> : null}
      <ul className="mt-2 flex flex-col gap-1">
        {pending.map((note) => (
          <li key={note.id} className="flex items-center justify-between gap-2 text-xs">
            <span>{formatNote(note)}</span>
            <span className="flex gap-2">
              <button type="button" className="quick-btn" onClick={() => void window.jarvis.notes.check(note.text).then(reload)}>
                Cocher
              </button>
              <button type="button" className="quick-btn" onClick={() => void window.jarvis.notes.erase(note.text).then(reload)}>
                Effacer
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
