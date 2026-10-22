import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { KnowledgeStats, LearningRecord } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/field';

/**
 * Mémoire documentaire locale : consultation des stats et effacement.
 * L’indexation et l’enregistrement passent par la conversation (outils),
 * avec confirmation — rien n’est envoyé dans un nuage.
 */
export function KnowledgeSettingsSection({
  learningEnabled,
  autoTrain,
  onLearningChange,
}: {
  learningEnabled: boolean;
  autoTrain: boolean;
  onLearningChange: (patch: { enabled?: boolean; autoTrain?: boolean }) => void;
}) {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

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

      <Toggle
        label="Apprentissage continu"
        hint="Une correction ou une préférence est reprise au tour suivant. Un ordre ponctuel n’est pas mémorisé."
        checked={learningEnabled}
        onChange={(enabled) => onLearningChange({ enabled })}
      />
      <Toggle
        label="Entraînement automatique"
        hint="Coupé par défaut. Même activé, il attend assez d’exemples propres et ne part pas après chaque message."
        checked={autoTrain}
        onChange={(enabled) => onLearningChange({ autoTrain: enabled })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="subtle" onClick={refresh} disabled={loading}>
          Actualiser
        </Button>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => {
            void window.jarvis.localLearning.exportSkills().then((rows) => {
              setExportNote(
                rows.length
                  ? `${rows.length} compétence(s) validée(s) peuvent servir d’exemples. Rien n’est entraîné.`
                  : 'Aucune compétence validée à exporter. Rien n’est entraîné.',
              );
            });
          }}
        >
          Exporter les compétences
        </Button>
        <Button size="sm" variant="subtle" onClick={clear} disabled={clearing || empty}>
          <Trash2 className="size-3.5" />
          Tout effacer
        </Button>
      </div>
      {exportNote ? <p className="text-xs text-slate-400">{exportNote}</p> : null}
      <LearningItems />
    </div>
  );
}

function LearningItems() {
  const [items, setItems] = useState<LearningRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = (): void => {
    void window.jarvis.localLearning.snapshot().then((snap) => {
      setItems(snap.records);
    });
  };
  useEffect(() => {
    load();
  }, []);
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Fiches récentes</p>
      {items.map((item) => (
        <div key={item.id} className="flex flex-col gap-1 rounded-md border border-white/5 px-2 py-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-slate-300">
              {item.skill
                ? `${item.status} · ${item.skill.name} · v${item.skill.version}`
                : `${item.status} · ${item.type} · ${item.content.slice(0, 80)}`}
            </p>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => void window.jarvis.localLearning.setStatus(item.id, 'validated').then(load)}
            >
              Valider
            </Button>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => void window.jarvis.localLearning.setStatus(item.id, 'rejected').then(load)}
            >
              Rejeter
            </Button>
            <Button
              size="sm"
              variant="subtle"
              onClick={() => void window.jarvis.localLearning.remove(item.id).then(load)}
            >
              Supprimer
            </Button>
          </div>
          {item.skill ? (
            <div className="flex flex-col gap-1 text-[11px] leading-snug text-slate-400">
              <p>{item.skill.appliesWhen}</p>
              <p>Limites : {item.skill.limits.join(' · ') || 'aucune'}</p>
              <p>
                Résultats :{' '}
                {item.skill.results.length
                  ? item.skill.results.map((result) => `${result.context} ${result.ok ? 'ok' : 'échec'}`).join(', ')
                  : 'aucun'}
              </p>
              {item.skill.previousId ? <p>Version candidate, l’ancienne fiche validée reste en place.</p> : null}
            </div>
          ) : null}
          {item.type === 'procedure' ? (
            <div className="flex items-center gap-2">
              <input
                value={drafts[item.id] ?? item.content}
                onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                className="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-2 py-1 text-xs text-slate-200"
                aria-label="Texte de la compétence"
              />
              <Button
                size="sm"
                variant="subtle"
                onClick={() =>
                  void window.jarvis.localLearning.correct(item.id, drafts[item.id] ?? item.content).then(load)
                }
              >
                Corriger
              </Button>
              {item.skill?.history.length ? (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => void window.jarvis.localLearning.restore(item.id).then(load)}
                >
                  Rétablir
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
