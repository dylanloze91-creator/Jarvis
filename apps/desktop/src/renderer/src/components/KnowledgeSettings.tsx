import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { KnowledgeStats } from '@jarvis/core';
import { Button } from '@/components/ui/button';

/**
 * Mémoire documentaire locale : consultation des stats et effacement.
 * L’indexation et l’enregistrement passent par la conversation (outils),
 * avec confirmation — rien n’est envoyé dans un nuage.
 */
export function KnowledgeSettingsSection() {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    setLoading(true);
    setError(null);
    void window.jarvis.settings
      .knowledgeStats()
      .then(setStats)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const clear = (): void => {
    setClearing(true);
    setError(null);
    void window.jarvis.settings
      .knowledgeClear()
      .then(setStats)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setClearing(false));
  };

  const empty = !stats || stats.chunks === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          Mémoire documentaire
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Souvenirs, conversations et dossiers indexés, uniquement sur ce PC
          (`knowledge-index.json`). La recherche sémantique utilise Ollama local
          (`nomic-embed-text`) si le modèle est installé ; sinon, une recherche textuelle. Dis «
          souviens-toi que… », « cherche dans ta mémoire » ou « indexe le dossier … ». Rien n’est
          envoyé dans un nuage.
        </p>
      </div>

      {loading && !stats ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" />
          Lecture de l’index…
        </p>
      ) : null}

      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      {stats ? (
        <p className="text-xs leading-snug text-slate-300">
          {empty
            ? 'Aucun passage indexé pour le moment.'
            : `${stats.chunks} passage(s), ${stats.sources} source(s), ${stats.embedded} vectorisé(s) localement.`}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="subtle" onClick={refresh} disabled={loading}>
          Actualiser
        </Button>
        <Button size="sm" variant="subtle" onClick={clear} disabled={clearing || empty}>
          <Trash2 className="size-3.5" />
          Tout effacer
        </Button>
      </div>
    </div>
  );
}
