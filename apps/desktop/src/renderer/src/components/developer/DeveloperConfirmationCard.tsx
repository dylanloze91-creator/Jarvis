import { Lock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DevConfirmation } from '../../../../shared/developerIpc';
import { SafetyBadge, SafetyReasons } from './parts';

/**
 * Carte de confirmation de Jarvis Développeur : la commande exacte, telle
 * qu'elle sera lancée, et son tri de sécurité. Rien ne part sans « Autoriser ».
 */
export function DeveloperConfirmationCard({
  confirmation,
  onRespond,
}: {
  confirmation: DevConfirmation;
  onRespond: (requestId: string, approved: boolean) => void;
}) {
  return (
    <div
      className="no-drag rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-3"
      data-developer-confirmation
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[13px] font-medium text-amber-100">Confirmation requise</p>
            {confirmation.forced ? (
              <span
                title="Cette confirmation ne peut pas être désactivée."
                className="flex items-center gap-1 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200"
              >
                <Lock className="size-2.5" />
                incompressible
              </span>
            ) : null}
            <SafetyBadge safety={confirmation.safety} />
          </div>
          <p className="mt-0.5 text-sm leading-snug text-amber-50/85">{confirmation.details}</p>
          {confirmation.command ? (
            <pre className="mt-2 overflow-x-auto rounded-lg border border-amber-400/20 bg-black/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-amber-100/90">
              {confirmation.command}
            </pre>
          ) : null}
          <p className="mt-2 text-[11px] font-medium text-slate-300">Tri de sécurité :</p>
          <SafetyReasons safety={confirmation.safety} />
          <p className="mt-1.5 font-mono text-[11px] text-amber-200/60">{confirmation.toolName}</p>
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
