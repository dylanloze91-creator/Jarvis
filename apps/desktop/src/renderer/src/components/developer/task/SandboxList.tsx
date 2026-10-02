import { useState } from 'react';
import { FolderGit2, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SandboxView } from '../../../../../shared/developerIpc';

function age(modifiedAt: number | null): string {
  if (modifiedAt === null) return 'dossier disparu';
  const days = Math.floor((Date.now() - modifiedAt) / 86_400_000);
  return days <= 0 ? 'aujourd’hui' : days === 1 ? 'hier' : `il y a ${days} jours`;
}

/** Copies isolées jarvis-dev/* restées sur le disque (≈ 1,1 Go chacune) : à jeter quand elles ne servent plus. */
export function SandboxList({
  sandboxes,
  root,
  busy,
  onRefresh,
  onClean,
}: {
  sandboxes: SandboxView[] | null;
  root: string;
  busy: boolean;
  onRefresh: () => void;
  onClean: (paths: string[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const others = (sandboxes ?? []).filter((s) => !s.current);
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
      data-sandboxes
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-100">
          <FolderGit2 className="size-4" /> Anciennes tâches
        </span>
        <span className="font-mono text-[11px] text-slate-500">{root || '—'}</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onRefresh}>
          <RefreshCw className="size-3.5" /> {sandboxes ? 'Actualiser' : 'Afficher'}
        </Button>
      </div>
      {sandboxes && others.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune ancienne copie isolée.</p>
      ) : null}
      {others.length ? (
        <>
          <ul className="flex flex-col gap-1">
            {others.map((s) => (
              <li key={s.path} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="accent-cyan-300"
                  checked={chosen.has(s.path)}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.target.checked) next.add(s.path);
                    else next.delete(s.path);
                    setChosen(next);
                  }}
                  aria-label={s.branch}
                />
                <span className="font-mono text-[11px] text-slate-200">{s.branch}</span>
                <span className="text-[11px] text-slate-500">{age(s.modifiedAt)}</span>
              </li>
            ))}
          </ul>
          <div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || chosen.size === 0}
              onClick={() => onClean([...chosen])}
            >
              <Trash2 className="size-3.5" /> Jeter la sélection ({chosen.size})
            </Button>
            <span className="ml-2 text-[11px] text-slate-500">Une confirmation par copie.</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
