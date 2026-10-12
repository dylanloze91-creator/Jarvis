import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DevConfirmation } from '../../../../shared/developerIpc';
import { SafetyBadge } from './parts';
import { DiffView } from './task/DiffView';

/**
 * Fenêtre latérale (ou bandeau en fenêtre compacte) pour répondre à une demande
 * de confirmation développeur sans chercher dans les réglages.
 */
export function DeveloperConfirmationDock({
  confirmation,
  onRespond,
}: {
  confirmation: DevConfirmation;
  onRespond: (requestId: string, approved: boolean) => void;
}) {
  return (
    <aside
      className="developer-confirmation-dock no-drag"
      role="dialog"
      aria-labelledby="dev-confirmation-title"
      aria-describedby="dev-confirmation-details"
      data-developer-confirmation-dock
    >
      <div className="developer-confirmation-dock-inner">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p id="dev-confirmation-title" className="text-[13px] font-semibold text-amber-100">
              {confirmation.title ?? 'Jarvis demande ton accord'}
            </p>
            <SafetyBadge safety={confirmation.safety} />
          </div>
        </div>
        <p
          id="dev-confirmation-details"
          className="mt-2 text-[13px] leading-snug text-slate-100"
        >
          {confirmation.details}
        </p>
        {confirmation.reason ? (
          <p className="mt-1.5 text-[11px] text-amber-200/90">{confirmation.reason}</p>
        ) : null}
        {confirmation.command ? (
          <pre className="mt-2 max-h-24 overflow-auto rounded-md border border-white/10 bg-black/50 px-2 py-1.5 font-mono text-[10px] text-slate-300">
            {confirmation.command}
          </pre>
        ) : null}
        {confirmation.diff?.length ? (
          <div className="mt-2 max-h-48 overflow-auto rounded-md border border-white/10 bg-black/40 p-2">
            <DiffView files={confirmation.diff} />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onRespond(confirmation.requestId, false)}
          >
            Refuser
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            autoFocus
            onClick={() => onRespond(confirmation.requestId, true)}
          >
            Autoriser
          </Button>
        </div>
      </div>
    </aside>
  );
}
