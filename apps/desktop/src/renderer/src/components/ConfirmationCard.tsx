import { Lock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingConfirmation } from '@/hooks/useChat';

interface ConfirmationCardProps {
  confirmation: PendingConfirmation;
  onRespond: (requestId: string, approved: boolean) => void;
}

/**
 * Dernier verrou avant une action sensible : l'IA a demandé l'outil, mais rien
 * ne s'exécute tant que l'utilisateur n'a pas tranché. Pour les commandes
 * (`run_command`) et les suppressions, `command` porte l'action exacte qui
 * sera exécutée : elle est affichée telle quelle, sans reformulation.
 */
export function ConfirmationCard({ confirmation, onRespond }: ConfirmationCardProps) {
  return (
    <div className="no-drag mx-3 mb-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[13px] font-medium text-amber-100">Confirmation requise</p>
            {confirmation.forced ? (
              <span
                title="Cette confirmation ne peut pas être désactivée dans les réglages."
                className="flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200"
              >
                <Lock className="size-2.5" />
                incompressible
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm leading-snug text-amber-50/85">{confirmation.details}</p>
          {confirmation.command ? (
            <pre className="mt-2 overflow-x-auto rounded-lg border border-amber-400/20 bg-black/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-amber-100/90">
              {confirmation.command}
            </pre>
          ) : null}
          <p className="mt-1 font-mono text-[11px] text-amber-200/60">{confirmation.toolName}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onRespond(confirmation.requestId, false)}>
          Refuser
        </Button>
        <Button
          size="sm"
          variant="default"
          autoFocus
          onClick={() => onRespond(confirmation.requestId, true)}
        >
          Autoriser
        </Button>
      </div>
    </div>
  );
}
