import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { PersonalizationProfile } from '@jarvis/core';
import { Button } from '@/components/ui/button';

/**
 * Mémoire persistante locale : consultation et effacement. Les
 * enregistrements passent par la conversation (outils), pas par ce
 * formulaire — pour n'écrire que sur une demande explicite.
 */
export function PersonalizationSettingsSection() {
  const [profile, setProfile] = useState<PersonalizationProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    setLoading(true);
    setError(null);
    void window.jarvis.settings
      .personalizationGet()
      .then(setProfile)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const reset = (): void => {
    setResetting(true);
    setError(null);
    void window.jarvis.settings
      .personalizationReset()
      .then(setProfile)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setResetting(false));
  };

  const assistant = profile ? Object.entries(profile.assistant) : [];
  const user = profile ? Object.entries(profile.user) : [];
  const rules = profile?.rules ?? [];
  const empty = assistant.length === 0 && user.length === 0 && rules.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          Mémoire persistante
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Préférences retenues sur cette machine (ton, nom, règles). Elles sont renvoyées à Ollama —
          et aux autres modèles — à chaque tour, indépendamment de la conversation. Dis par exemple
          « appelle-moi Monsieur » ou « retiens que je veux des réponses courtes ». Rien n'est
          enregistré tout seul.
        </p>
      </div>

      {loading && !profile ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" />
          Lecture de la mémoire…
        </p>
      ) : null}

      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      {profile && empty ? (
        <p className="text-xs leading-snug text-slate-500">
          Aucune personnalisation enregistrée pour le moment.
        </p>
      ) : null}

      {assistant.length > 0 ? (
        <EntryList title="Personnalité de Jarvis" entries={assistant} />
      ) : null}
      {user.length > 0 ? <EntryList title="Tes préférences" entries={user} /> : null}
      {rules.length > 0 ? (
        <div>
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Règles</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-300">
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="subtle" onClick={refresh} disabled={loading}>
          Actualiser
        </Button>
        <Button size="sm" variant="subtle" onClick={reset} disabled={resetting || empty}>
          <Trash2 className="size-3.5" />
          Tout effacer
        </Button>
      </div>
    </div>
  );
}

function EntryList({ title, entries }: { title: string; entries: [string, string][] }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{title}</p>
      <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
        {entries.map(([key, value]) => (
          <li key={key}>
            <span className="text-slate-500">{key} :</span> {value}
          </li>
        ))}
      </ul>
    </div>
  );
}
