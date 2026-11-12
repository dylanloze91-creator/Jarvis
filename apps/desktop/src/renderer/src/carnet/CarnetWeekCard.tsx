import { useEffect, useState } from 'react';
import { RATE_CATEGORY_LABELS, type RateCategory } from '@jarvis/core';
import type { CarnetView } from '../../../shared/ipc';

const CATEGORIES = Object.entries(RATE_CATEGORY_LABELS) as Array<[RateCategory, string]>;

export function CarnetWeekCard() {
  const [view, setView] = useState<CarnetView | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expected, setExpected] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void window.jarvis.carnet
      .get()
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!view?.settings.enabled) return null;
  const shown = showAll ? view.groups : view.groups.slice(0, 10);
  const rest = showAll ? 0 : Math.max(0, view.groups.length - 10);

  return (
    <section
      id="carnet-semaine"
      className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100"
    >
      <p className="font-medium">Les ratés de la semaine</p>
      {shown.length === 0 ? (
        <p className="mt-1 text-xs text-slate-400">Aucun raté cette semaine.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {shown.map((group) => (
            <li key={group.id} className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-xs text-slate-400">
                {group.count} · {group.type}
              </p>
              <p className="mt-1">{group.userText}</p>
              {group.replyStart ? (
                <p className="mt-1 text-xs text-slate-400">{group.replyStart}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {CATEGORIES.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="quick-btn text-xs"
                    onClick={() => {
                      void window.jarvis.carnet
                        .annotate(group.ids, {
                          category: id,
                          ...(expected[group.id]?.trim()
                            ? { expected: expected[group.id]!.trim() }
                            : {}),
                        })
                        .then(setView);
                    }}
                  >
                    {group.category === id ? `✓ ${label}` : label}
                  </button>
                ))}
                <button
                  type="button"
                  className="quick-btn text-xs opacity-80"
                  onClick={() => {
                    void window.jarvis.carnet.dismiss(group.ids).then(setView);
                  }}
                >
                  Ce n&apos;était pas un raté
                </button>
              </div>
              <input
                className="mt-2 w-full rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs"
                placeholder="Ce que tu attendais (facultatif)"
                value={expected[group.id] ?? group.expected ?? ''}
                onChange={(event) =>
                  setExpected((current) => ({ ...current, [group.id]: event.target.value }))
                }
              />
            </li>
          ))}
        </ul>
      )}
      {rest > 0 ? (
        <button type="button" className="quick-btn mt-2 text-xs" onClick={() => setShowAll(true)}>
          Tout voir ({rest} de plus)
        </button>
      ) : null}
    </section>
  );
}

export function CarnetSettingsSection() {
  const [view, setView] = useState<CarnetView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.jarvis.carnet
      .get()
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!view) return <p className="text-xs text-slate-400">Chargement du carnet…</p>;
  const seconds = (ms: number) => String(Math.round(ms / 1000));
  const save = (patch: Parameters<typeof window.jarvis.carnet.set>[0]) => {
    void window.jarvis.carnet.set(patch).then(setView);
  };
  return (
    <div className="flex flex-col gap-3 text-sm text-slate-100">
      <p className="text-xs leading-snug text-slate-400">
        Jarvis Test le note tout seul. Jarvis Live le laisse coupé, jusqu&apos;à ce que tu
        l&apos;actives. Rien n&apos;est envoyé : le fichier reste sur ce PC.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={view.settings.enabled}
          onChange={(event) => save({ enabled: event.target.checked })}
        />
        Noter les ratés
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-300">
        Fenêtre et téléphone : secondes avant le premier mot
        <input
          className="rounded-md border border-white/10 bg-transparent px-2 py-1"
          inputMode="numeric"
          value={seconds(view.settings.fenetrePremierMotMs)}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value > 0) save({ fenetrePremierMotMs: Math.round(value * 1000) });
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-300">
        Enceinte : secondes avant le premier son
        <input
          className="rounded-md border border-white/10 bg-transparent px-2 py-1"
          inputMode="numeric"
          value={seconds(view.settings.enceintePremierSonMs)}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value > 0) save({ enceintePremierSonMs: Math.round(value * 1000) });
          }}
        />
      </label>
    </div>
  );
}

export function CarnetSundayLine() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.jarvis.carnet
      .get()
      .then((view) => {
        if (cancelled || !view.sunday || view.sunday.speak !== false) return;
        setText(view.sunday.text);
        void window.jarvis.carnet.sundaySeen(view.sunday.day);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!text) return null;
  return (
    <p className="mx-3 mb-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
      {text}{' '}
      <button
        type="button"
        className="quick-btn"
        onClick={() =>
          document
            .getElementById('carnet-semaine')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      >
        Les voir
      </button>
    </p>
  );
}
