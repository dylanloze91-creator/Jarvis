import { Gauge, ShieldAlert } from 'lucide-react';
import { CAPABILITY_LABELS, DIFFICULTY_LABELS, type MissionGate } from '@jarvis/core';
import { Button } from '@/components/ui/button';

/**
 * Mission refusée avant de partir (5.0.1) : la difficulté estimée dépasse ce
 * que le modèle Codeur tient. Jarvis le dit et propose une version ciblée,
 * lancée seulement si l'utilisateur clique.
 */
export function MissionGateCard({
  gate,
  busy,
  onLaunch,
  onEdit,
}: {
  gate: MissionGate;
  busy: boolean;
  onLaunch: (request: string) => void;
  onEdit: (request: string) => void;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3"
      data-mission-gate="refused"
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-amber-100">
        <ShieldAlert className="size-4" /> Mission non lancée : trop grande pour{' '}
        {gate.capability.model}
      </div>
      <div className="grid gap-1 text-[11px] text-slate-200 sm:grid-cols-2">
        <p>
          <span className="text-slate-400">Difficulté estimée : </span>
          {DIFFICULTY_LABELS[gate.difficulty.level]}
        </p>
        <p>
          <span className="text-slate-400">Le modèle tient : </span>
          {CAPABILITY_LABELS[gate.capability.level]} ({gate.capability.detail})
        </p>
      </div>
      <p className="text-[11px] leading-snug text-slate-300">
        Pourquoi : {gate.difficulty.reasons.join(' ; ')}.
      </p>
      {gate.suggestion ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
          <p className="text-[11px] text-slate-400">Version ciblée, à la mesure du modèle :</p>
          <p className="text-[13px] text-slate-100" data-mission-suggestion>
            {gate.suggestion}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onLaunch(gate.suggestion!)}>
              <Gauge className="size-3.5" /> Lancer la version ciblée
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onEdit(gate.suggestion!)}
            >
              La reprendre dans la demande
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-300">
          {gate.capability.level === 0
            ? 'Choisis un autre modèle pour le rôle Codeur (onglet Modèle de code), après son banc réel.'
            : 'Découpe la demande : une règle ou une fonction à la fois.'}
        </p>
      )}
    </section>
  );
}
