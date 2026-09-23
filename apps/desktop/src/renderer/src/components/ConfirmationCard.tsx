import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingConfirmation } from '@/hooks/useChat';

interface ConfirmationCardProps {
  confirmation: PendingConfirmation;
  onRespond: (requestId: string, approved: boolean) => void;
}

/**
 * Dernier verrou avant une action sensible : l'IA a demandé l'outil, mais rien
 * ne s'exécute tant que l'utilisateur n'a pas tranché.
 */
export function ConfirmationCard({ confirmation, onRespond }: ConfirmationCardProps) {
  return (
    <div className="no-drag mx-3 mb-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="flex-1">
          <p className="text-[13px] font-medium text-amber-100">Confirmation requise</p>
          <p className="mt-0.5 text-sm leading-snug text-amber-50/85">{confirmation.details}</p>
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
