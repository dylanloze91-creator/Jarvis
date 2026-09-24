import {
  OLLAMA_RECOMMENDED_NUM_CTX,
  OLLAMA_RTX2060_6GB_RECOMMENDATIONS,
  OLLAMA_TOOL_CATALOG_FOOTPRINT,
  type OllamaDiagnosticResult,
  type OllamaServerStatus,
  type OllamaStatusResult,
} from '@jarvis/core';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';

interface OllamaSettingsSectionProps {
  baseUrl: string;
  model: string;
  onChange: (values: { baseUrl?: string; model?: string }) => void;
}

/**
 * Fait d'Ollama un chemin de premier plan plutôt qu'une simple URL à saisir :
 * détection automatique du serveur, liste réelle des modèles installés,
 * recommandations chiffrées pour la RTX 2060 6 Go, et un vrai test de
 * connexion qui vérifie l'appel d'outils — pas seulement que le serveur
 * répond. Rendu uniquement quand le fournisseur choisi est « ollama »,
 * indépendamment du reste de `SettingsPanel`.
 */
export function OllamaSettingsSection({ baseUrl, model, onChange }: OllamaSettingsSectionProps) {
  const [status, setStatus] = useState<OllamaStatusResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [testResult, setTestResult] = useState<OllamaDiagnosticResult | null>(null);
  const [testing, setTesting] = useState(false);

  const refreshStatus = (): void => {
    setLoadingStatus(true);
    void window.jarvis.settings
      .ollamaStatus(baseUrl)
      .then(setStatus)
      .finally(() => setLoadingStatus(false));
  };

  useEffect(() => {
    refreshStatus();
  }, [baseUrl]);

  const runTest = (): void => {
    setTesting(true);
    setTestResult(null);
    void window.jarvis.settings
      .ollamaTest({ baseUrl, model })
      .then(setTestResult)
      .finally(() => setTesting(false));
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          Serveur Ollama local
        </p>
        <Button size="sm" variant="ghost" onClick={refreshStatus} disabled={loadingStatus}>
          <RefreshCw className={loadingStatus ? 'size-3.5 animate-spin' : 'size-3.5'} />
          Actualiser
        </Button>
      </div>

      <StatusBadge status={status} loading={loadingStatus} />

      <Field
        label="URL du serveur"
        hint="Laisse la valeur par défaut si Ollama tourne sur cette machine (cas normal)."
      >
        <Input
          value={baseUrl}
          placeholder="http://127.0.0.1:11434"
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
      </Field>

      {status?.status === 'detected' && status.models.length > 0 ? (
        <Field label="Modèle installé">
          <Select value={model} onChange={(event) => onChange({ model: event.target.value })}>
            {!status.models.some((m) => m.name === model) ? (
              <option value={model}>{model} (non installé sur ce serveur)</option>
            ) : null}
            {status.models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} — {m.parameterSize}, {m.quantizationLevel}
                {m.supportsTools ? '' : ' — sans capacité outils annoncée'}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field
          label="Modèle"
          hint="Aucun modèle détecté pour l'instant : saisis le tag exact (ex. qwen2.5:3b), ou installe-le d'abord."
        >
          <Input value={model} onChange={(event) => onChange({ model: event.target.value })} />
        </Field>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-200">Tester la connexion</p>
            <p className="text-xs leading-snug text-slate-500">
              Vérifie le serveur, le modèle, puis lui fait vraiment appeler un outil — le point qui
              compte le plus pour un modèle local.
            </p>
          </div>
          <Button size="sm" variant="subtle" onClick={runTest} disabled={testing}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {testing ? 'Test en cours…' : 'Tester'}
          </Button>
        </div>
        {testResult ? <DiagnosticSteps result={testResult} /> : null}
      </div>

      <RecommendationList currentModel={model} onUseModel={(next) => onChange({ model: next })} />

      <p className="text-xs leading-snug text-slate-500">
        Jarvis demande toujours une fenêtre de contexte de {OLLAMA_RECOMMENDED_NUM_CTX} tokens à
        Ollama, quel que soit son réglage par défaut : ses {OLLAMA_TOOL_CATALOG_FOOTPRINT.toolCount}{' '}
        outils représentent déjà environ {OLLAMA_TOOL_CATALOG_FOOTPRINT.estimatedTokensHigh} tokens
        à eux seuls à chaque tour. Rien à configurer côté serveur.
      </p>
    </div>
  );
}

function StatusBadge({ status, loading }: { status: OllamaStatusResult | null; loading: boolean }) {
  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Détection du serveur…
      </p>
    );
  }
  if (!status) return null;

  const style = statusStyle[status.status];
  return (
    <p className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${style.className}`}>
      <style.Icon className="size-3.5 shrink-0" />
      <span>{status.message}</span>
    </p>
  );
}

const statusStyle: Record<OllamaServerStatus, { Icon: typeof CheckCircle2; className: string }> = {
  detected: {
    Icon: CheckCircle2,
    className: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
  },
  absent: { Icon: CircleSlash, className: 'border-amber-400/25 bg-amber-400/10 text-amber-100' },
  unreachable: { Icon: XCircle, className: 'border-rose-400/25 bg-rose-400/10 text-rose-100' },
};

function DiagnosticSteps({ result }: { result: OllamaDiagnosticResult }) {
  return (
    <ul className="flex flex-col gap-1.5 border-t border-white/8 pt-2">
      {result.steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2 text-xs leading-snug">
          <StepIcon ok={step.ok} skipped={step.skipped} />
          <span
            className={
              step.skipped ? 'text-slate-500' : step.ok ? 'text-slate-300' : 'text-rose-200'
            }
          >
            <span className="font-medium">{step.label}</span> — {step.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StepIcon({ ok, skipped }: { ok: boolean; skipped: boolean }) {
  if (skipped) return <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-slate-500" />;
  if (ok) return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />;
  return <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />;
}

function RecommendationList({
  currentModel,
  onUseModel,
}: {
  currentModel: string;
  onUseModel: (model: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-white/8 pt-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        Recommandations pour une RTX 2060 6 Go
      </p>
      {OLLAMA_RTX2060_6GB_RECOMMENDATIONS.map((entry) => (
        <div
          key={entry.model}
          className="flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {entry.role === 'a-eviter' ? (
                <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />
              ) : (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
              )}
              <span className="text-sm text-slate-200">{entry.label}</span>
            </div>
            {entry.model !== currentModel ? (
              <Button size="sm" variant="ghost" onClick={() => onUseModel(entry.model)}>
                Utiliser
              </Button>
            ) : (
              <span className="text-xs text-accent">Sélectionné</span>
            )}
          </div>
          <p className="text-xs leading-snug text-slate-400">
            {entry.parameterSize} · {entry.quantization} · {entry.downloadSizeGb.toFixed(2)} Go à
            télécharger · ~{entry.estimatedVramGb.min.toFixed(1)}-
            {entry.estimatedVramGb.max.toFixed(1)} Go de VRAM ·{' '}
            {entry.fitsOn6GbVram ? 'tient sur 6 Go' : 'déborde sur le CPU sur 6 Go'}
          </p>
          <p className="text-xs leading-snug text-slate-500">{entry.expectedSpeed}</p>
          <p className="text-xs leading-snug text-slate-500">{entry.toolCallingEvidence}</p>
          <code className="rounded bg-black/30 px-2 py-1 text-[11px] text-slate-300 select-all">
            {entry.pullCommand}
          </code>
        </div>
      ))}
    </div>
  );
}
