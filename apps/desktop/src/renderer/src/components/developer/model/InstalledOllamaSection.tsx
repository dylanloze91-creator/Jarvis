import { useState } from 'react';
import { Download, RefreshCw, Server } from 'lucide-react';
import { codeModelById, formatModelSize } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { gb, percent } from './format';

/**
 * Modèles réellement installés dans Ollama (`/api/tags`), indépendamment du
 * catalogue de conseils. Rafraîchissement manuel + téléchargement confirmé par nom.
 */
export function InstalledOllamaSection({
  model,
  busy,
  onRefresh,
  onPull,
}: {
  model: CodeModelState;
  busy: boolean;
  onRefresh: () => void;
  onPull: (name: string) => void;
}) {
  const [pullName, setPullName] = useState('');
  const catalogPullId =
    model.validation && model.pull?.modelId === model.validation.modelId
      ? model.pull.modelId
      : null;
  const pull = model.pull && model.pull.modelId !== catalogPullId ? model.pull : null;
  const catalogIds = new Set(model.candidates.map((c) => c.spec.id));
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] px-3.5 py-3"
      data-ollama-installed
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
          <Server className="size-4" /> Modèles installés dans Ollama
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          data-refresh-ollama-models
          onClick={onRefresh}
        >
          <RefreshCw className="size-3.5" /> Rafraîchir la liste
        </Button>
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Liste lue sur ton serveur Ollama (`/api/tags`). Le catalogue plus bas reste un guide : il ne
        masque pas un modèle déjà installé (par ex.{' '}
        <span className="font-mono text-slate-300">qwen2.5-coder:14b</span>). À l’ouverture de cet
        onglet, la liste se met à jour automatiquement.
      </p>
      {model.ollamaListMessage ? (
        <p className="text-[11px] text-slate-500">
          {model.ollamaListMessage}
          {model.ollamaModelsAt
            ? ` · ${new Date(model.ollamaModelsAt).toLocaleString('fr-FR')}`
            : ''}
        </p>
      ) : null}
      {model.ollamaModels.length === 0 ? (
        <p className="text-[11px] text-amber-200">
          Aucun modèle listé : démarre Ollama, installe un modèle, puis rafraîchis.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-[11px] text-slate-300">
          {model.ollamaModels.map((entry) => {
            const hint = catalogIds.has(entry.name);
            return (
              <li
                key={entry.name}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-white/5 bg-black/20 px-2 py-1"
              >
                <span className="font-mono text-slate-100">{entry.name}</span>
                <span className="text-slate-500">{formatModelSize(entry.sizeBytes)}</span>
                {hint ? (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-cyan-200/90">
                    conseil catalogue
                  </span>
                ) : null}
                {!entry.supportsTools ? (
                  <span className="text-[10px] text-slate-500">sans capacité outils annoncée</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-1 flex flex-col gap-2 border-t border-white/5 pt-2">
        <p className="text-[11px] text-slate-400">
          Télécharger un autre modèle : saisis le nom exact (ex.{' '}
          <span className="font-mono text-slate-300">deepseek-coder-v2:16b</span>), puis confirme —
          rien n’est téléchargé sans ta carte « Autoriser ».
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="no-drag min-w-[12rem] flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] font-mono text-slate-100"
            placeholder="nom:tag"
            value={pullName}
            disabled={busy}
            aria-label="Nom du modèle Ollama à télécharger"
            data-ollama-pull-input
            onChange={(event) => setPullName(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !pullName.trim()}
            data-ollama-pull-submit
            onClick={() => onPull(pullName.trim())}
          >
            <Download className="size-3.5" /> Télécharger…
          </Button>
        </div>
        {pull ? (
          <div className="flex flex-col gap-1 text-xs" data-ollama-pull-progress>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-cyan-300 transition-[width]"
                style={{ width: `${percent(pull.completed, pull.total)}%` }}
              />
            </div>
            <span className="text-slate-400">
              {pull.modelId} —{' '}
              {pull.done
                ? 'Téléchargement terminé.'
                : `${pull.status} · ${gb(pull.completed)} sur ${gb(pull.total)} (${percent(pull.completed, pull.total)} %)`}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
