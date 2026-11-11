import { Button } from '@/components/ui/button';

/**
 * Panneau du diagnostic, dans Enceintes. Les boutons partent seulement au clic.
 * « Privé » ne vise que l'interface de la maison.
 */
export function SpeakerDiagnose({
  lines,
  notice,
  canPrivate,
  onRepair,
  onPrivate,
}: {
  lines: Array<{ id: string; ok: boolean; sentence: string }>;
  notice?: string | null;
  canPrivate: boolean;
  onRepair: () => void;
  onPrivate: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="text-sm text-slate-100">Diagnostic du réseau</p>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li key={line.id} className={line.ok ? 'text-slate-200' : 'text-amber-100'}>
            {line.ok ? '✓' : '×'} {line.sentence}
          </li>
        ))}
      </ul>
      {notice ? <p className="text-sm text-rose-100">{notice}</p> : null}
      <p className="text-xs text-slate-400">
        « Réparer » ajoute les règles du pare-feu. Windows demande ton accord. « Passer ce réseau en Privé » ne change que
        l’interface de la maison, pas un VPN ni Tailscale.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" onClick={onRepair}>
          Réparer
        </Button>
        <Button type="button" variant="ghost" disabled={!canPrivate} onClick={onPrivate}>
          Passer ce réseau en Privé
        </Button>
      </div>
    </div>
  );
}
