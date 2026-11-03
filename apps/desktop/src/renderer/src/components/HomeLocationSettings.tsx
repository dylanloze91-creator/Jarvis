import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { GeocodingPlace, HomeLocation } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

interface HomeLocationSettingsProps {
  value?: HomeLocation;
  onChange: (value: HomeLocation | undefined) => void;
}

/**
 * Lieu « Chez moi » : géocodage Open-Meteo sans clé, choix dans une liste de propositions.
 */
export function HomeLocationSettingsSection({ value, onChange }: HomeLocationSettingsProps) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [proposals, setProposals] = useState<GeocodingPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuery(value?.label ?? '');
  }, [value?.label]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setProposals([]);
      setError(null);
      return;
    }
    if (value?.label === trimmed) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void window.jarvis.settings
        .geocodeSearch(trimmed)
        .then((results) => {
          setProposals(results);
          if (results.length === 0) setError('Aucune proposition : essaie un autre nom.');
        })
        .catch(() => setError('Géocodage indisponible pour le moment.'))
        .finally(() => setLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, value?.label]);

  function pick(place: GeocodingPlace) {
    const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    onChange({ label, latitude: place.latitude, longitude: place.longitude });
    setQuery(label);
    setProposals([]);
    setError(null);
  }

  function clear() {
    onChange(undefined);
    setQuery('');
    setProposals([]);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Chez moi</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Météo sans ville nommée, pharmacies de garde, trafic ou actualités locales : Jarvis utilise ce lieu.
          Une ville citée dans la question passe toujours avant. Sans lieu enregistré, Jarvis demande « Pour quel
          endroit ? ».
        </p>
      </div>

      <Field label="Chez moi" hint="Tape le nom de ta commune ; choisis une proposition dans la liste.">
        <Input
          value={query}
          placeholder="Nom de ta commune…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> Recherche de propositions…
        </p>
      ) : null}
      {error ? <p className="text-xs text-amber-200">{error}</p> : null}

      {proposals.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-slate-700/60 bg-slate-900/40 p-2">
          {proposals.map((place) => {
            const line = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
            return (
              <li key={`${place.latitude}-${place.longitude}-${line}`}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800/80"
                  onClick={() => pick(place)}
                >
                  {line}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {value ? (
        <p className="text-xs text-emerald-100/90">
          Enregistré : {value.label} ({value.latitude.toFixed(2)}, {value.longitude.toFixed(2)})
        </p>
      ) : null}

      {value ? (
        <Button size="sm" variant="subtle" onClick={clear}>
          Effacer le lieu Chez moi
        </Button>
      ) : null}
    </div>
  );
}
