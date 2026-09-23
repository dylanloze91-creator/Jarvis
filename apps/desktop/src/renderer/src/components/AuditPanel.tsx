import type { AuditEntry } from '@jarvis/core';
import { Check, ShieldOff, Wrench, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn, formatRelativeDate } from '@/lib/utils';

const decisionLabels: Record<AuditEntry['decision'], string> = {
  auto: 'automatique',
  approved: 'autorisée',
  refused: 'refusée',
  blocked: 'bloquée',
};

/**
 * Journal d'audit : chaque exécution d'outil, qu'elle ait réussi, échoué ou
 * été refusée, avec son horodatage, ses arguments exacts et la décision qui
 * l'a autorisée. C'est la trace qui rend chaque action de Jarvis vérifiable
 * après coup.
 */
export function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  const refresh = (): void => {
    void window.jarvis.audit.list(200).then(setEntries);
  };

  useEffect(refresh, []);

  if (entries === null) {
    return <p className="px-4 py-6 text-sm text-slate-500">Chargement du journal d’audit…</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-slate-500">
        Aucune exécution d’outil enregistrée pour l’instant.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          {entries.length} entrée{entries.length > 1 ? 's' : ''}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.jarvis.audit.clear().then(refresh)}
        >
          Vider le journal
        </Button>
      </div>

      {entries.map((entry) => (
        <AuditRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const failed = entry.status === 'error';
  const denied = entry.status === 'denied';

  return (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className="no-drag flex flex-col gap-1.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/6"
    >
      <div className="flex items-center gap-2">
        <StatusIcon entry={entry} />
        <span className="font-mono text-sm text-slate-200">{entry.toolName}</span>
        <DecisionBadge decision={entry.decision} />
        <span className="ml-auto shrink-0 text-[11px] text-slate-500">
          {formatRelativeDate(entry.timestamp)}
        </span>
      </div>

      {open ? (
        <div className="ml-6 flex flex-col gap-1.5 border-l border-white/8 pl-3 text-[11px]">
          <div>
            <span className="text-slate-500">Arguments : </span>
            <code className="text-slate-300">{JSON.stringify(entry.arguments)}</code>
          </div>
          <div>
            <span className="text-slate-500">Résultat : </span>
            <span
              className={cn(
                'text-slate-300',
                failed && 'text-rose-300',
                denied && 'text-amber-300',
              )}
            >
              {entry.resultSummary || '(vide)'}
            </span>
          </div>
          <div className="text-slate-500">
            Durée : {entry.durationMs} ms
            {entry.category ? ` · catégorie ${entry.category}` : ''}
          </div>
        </div>
      ) : null}
    </button>
  );
}

function StatusIcon({ entry }: { entry: AuditEntry }) {
  if (entry.status === 'denied') return <ShieldOff className="size-3.5 shrink-0 text-amber-300" />;
  if (entry.status === 'error') return <XCircle className="size-3.5 shrink-0 text-rose-300" />;
  if (entry.decision === 'auto') return <Wrench className="size-3.5 shrink-0 text-slate-400" />;
  return <Check className="size-3.5 shrink-0 text-accent" />;
}

function DecisionBadge({ decision }: { decision: AuditEntry['decision'] }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px]',
        decision === 'approved' && 'bg-accent/10 text-accent',
        decision === 'refused' && 'bg-amber-400/10 text-amber-300',
        decision === 'blocked' && 'bg-rose-500/10 text-rose-300',
        decision === 'auto' && 'bg-white/8 text-slate-400',
      )}
    >
      {decisionLabels[decision]}
    </span>
  );
}
