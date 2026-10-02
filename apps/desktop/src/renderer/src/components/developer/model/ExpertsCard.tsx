import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CodeModelState } from '../../../../../shared/developerIpc';
import { CopyCommand } from '../parts';
import { dateTime } from './format';

/**
 * Option « experts en RAM » : variables du serveur Ollama. Jarvis ne les modifie jamais ;
 * il montre ce qui changerait, les commandes à lancer soi-même, et attend la confirmation.
 */
export function ExpertsCard({
  experts,
  busy,
  onConfirm,
}: {
  experts: CodeModelState['experts'];
  busy: boolean;
  onConfirm: (applied: boolean) => void;
}) {
  const [open, setOpen] = useState(!experts.confirmedAt);
  const pending = experts.changes.filter((change) => change.changes);
  return (
    <div
      data-experts-card
      className="flex flex-col gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-xs"
    >
      <span className="flex items-center gap-2 font-medium text-amber-100">
        <ShieldAlert className="size-3.5" /> Réglages du serveur Ollama — Jarvis n’y touche pas
        {experts.confirmedAt ? (
          <button
            type="button"
            className="no-drag ml-auto text-[11px] font-normal text-slate-400 hover:text-slate-100"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Masquer les réglages' : 'Voir les réglages'}
          </button>
        ) : null}
      </span>
      {open ? <ExpertsDetails experts={experts} /> : null}
      {experts.confirmedAt ? (
        <div className="flex flex-wrap items-center gap-2 text-emerald-200">
          Tu as confirmé les avoir appliqués le {dateTime(experts.confirmedAt)}.
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConfirm(false)}>
            Je les ai retirés
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => onConfirm(true)}>
            J’ai appliqué ces réglages et redémarré Ollama
          </Button>
          <span className="text-[11px] text-slate-400">
            {pending.length === 0
              ? 'Jarvis voit déjà ces valeurs ; confirme quand Ollama a redémarré.'
              : 'Jarvis ne verra les nouvelles valeurs qu’à son prochain démarrage : ta confirmation suffit.'}
          </span>
        </div>
      )}
    </div>
  );
}

function ExpertsDetails({ experts }: { experts: CodeModelState['experts'] }) {
  return (
    <>
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="text-slate-400">
          <tr>
            <th className="py-1 pr-2 font-medium">Variable</th>
            <th className="py-1 pr-2 font-medium">Aujourd’hui</th>
            <th className="py-1 pr-2 font-medium">Proposé</th>
            <th className="py-1 font-medium">Effet</th>
          </tr>
        </thead>
        <tbody className="text-slate-200">
          {experts.changes.map((change) => (
            <tr key={change.name} className="border-t border-white/8 align-top">
              <td className="py-1 pr-2 font-mono">{change.name}</td>
              <td className="py-1 pr-2 font-mono">{change.current ?? 'absente'}</td>
              <td className="py-1 pr-2 font-mono">
                {change.proposed}
                {change.changes ? '' : ' (déjà)'}
              </td>
              <td className="py-1 text-slate-300">{change.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-slate-300">
        À lancer toi-même dans PowerShell (pour ton compte seulement) :
      </p>
      <div className="flex flex-col">
        {experts.instructions.apply.map((line) => (
          <CopyCommand key={line} command={line} />
        ))}
      </div>
      <p className="text-slate-300">{experts.instructions.restart}</p>
      <details className="text-slate-400">
        <summary className="no-drag cursor-pointer select-none">Pour revenir en arrière</summary>
        <div className="mt-1 flex flex-col">
          {experts.instructions.undo.map((line) => (
            <CopyCommand key={line} command={line} />
          ))}
        </div>
      </details>
      <p className="text-[11px] leading-snug text-slate-400">{experts.instructions.caveat}</p>
    </>
  );
}
