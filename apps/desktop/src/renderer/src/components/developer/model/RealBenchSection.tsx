import { CheckCircle2, Gauge, MinusCircle, XCircle } from 'lucide-react';
import {
  ROLE_LABELS,
  SPECIALIST_ROLES,
  coderVerdict,
  modelCapability,
  type RealBenchResult,
} from '@jarvis/core';
import { Button } from '@/components/ui/button';
import type { DeveloperState } from '../../../../../shared/developerIpc';
import { dateTime, tokValue } from './format';

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-slate-500" />;
  return ok ? (
    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
  ) : (
    <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-400" />
  );
}

function score(bench: RealBenchResult, role: (typeof SPECIALIST_ROLES)[number]): string {
  const entry = bench.roles.find((r) => r.role === role);
  if (!entry || entry.measured === 0) return '—';
  return `${entry.passed}/${entry.measured}`;
}

/**
 * Banc réel sur le code de Jarvis : un score par rôle et par modèle déjà
 * installé. Rien n'est téléchargé et aucun modèle n'est choisi ici.
 */
export function RealBenchSection({
  state,
  onRun,
}: {
  state: DeveloperState;
  onRun: (modelId: string) => void;
}) {
  const model = state.model;
  const repoReady = state.repo?.ok ?? false;
  const benches = model.realBenches;
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
      data-real-bench
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
        <Gauge className="size-4" /> Banc réel sur le code de Jarvis
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Questions, plan, revue, correction et génération sur les vrais fichiers de ta copie (lue
        sans être modifiée ; les modifications se font dans un dossier jetable). Seulement des
        modèles déjà installés : rien n’est téléchargé. <strong>Aucun modèle n’est choisi</strong> :
        le banc donne un score par rôle, et c’est toi qui décides.
      </p>
      {!repoReady ? (
        <p className="text-[11px] text-amber-200">Vérifie d’abord la copie de travail.</p>
      ) : null}
      {model.installedModels.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          Vérifie le matériel (étape 1) pour voir les modèles installés dans Ollama.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {model.installedModels.map((name) => (
            <Button
              key={name}
              size="sm"
              variant="ghost"
              disabled={!repoReady || state.busy}
              onClick={() => onRun(name)}
            >
              Banc réel : {name}
            </Button>
          ))}
        </div>
      )}
      {benches.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px] text-slate-300">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-3 font-medium">Rôle</th>
                {benches.map((bench) => (
                  <th key={bench.model} className="py-1 pr-3 font-mono font-medium text-slate-300">
                    {bench.model}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SPECIALIST_ROLES.map((role) => (
                <tr key={role} className="border-t border-white/5">
                  <td className="py-1 pr-3">{ROLE_LABELS[role]}</td>
                  {benches.map((bench) => (
                    <td key={bench.model} className="py-1 pr-3 font-mono">
                      {score(bench, role)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-white/10 text-slate-200" data-coder-verdict>
                <td className="py-1 pr-3">Verdict Codeur</td>
                {benches.map((bench) => {
                  const capability = modelCapability(bench.model, bench);
                  return (
                    <td
                      key={bench.model}
                      className={`py-1 pr-3 ${capability.level === 0 ? 'text-rose-300' : 'text-emerald-300'}`}
                    >
                      {coderVerdict(capability)}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-t border-white/10 text-slate-400">
                <td className="py-1 pr-3">Écriture</td>
                {benches.map((bench) => (
                  <td key={bench.model} className="py-1 pr-3 font-mono">
                    {tokValue(bench.metrics.outputTokPerSec)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {benches.map((bench) => (
        <details key={bench.model} className="text-[11px] text-slate-400">
          <summary className="cursor-pointer text-slate-300">
            {bench.model} · {dateTime(bench.finishedAt)}
            {bench.commit ? ` · commit ${bench.commit.slice(0, 7)}` : ''}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {bench.tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-1.5">
                <Mark ok={task.ok} />
                <span>
                  <span className="text-slate-200">{task.label}</span> — {task.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
