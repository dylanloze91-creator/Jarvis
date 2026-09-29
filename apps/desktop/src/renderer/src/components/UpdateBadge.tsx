import { Download, RotateCw } from 'lucide-react';
import type { UpdateState } from '../../../shared/ipc';

interface UpdateBadgeProps {
  state: UpdateState | null;
  onInstall: () => void;
}

/**
 * Indicateur discret dans l'en-tête : invisible tant qu'il n'y a rien
 * d'actionnable (vérification en cours, à jour, erreur — l'erreur reste
 * silencieuse ici, elle n'est jamais alarmante puisqu'elle n'empêche jamais
 * l'application de fonctionner ; le détail reste dans les réglages). Ne
 * s'affiche que pendant un téléchargement, ou quand une mise à jour est
 * prête à être installée.
 */
export function UpdateBadge({ state, onInstall }: UpdateBadgeProps) {
  if (!state) return null;

  if (state.phase === 'downloading') {
    const percent = state.progress ? Math.round(state.progress.percent) : null;
    return (
      <span
        className="flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-slate-400"
        title={`Téléchargement de la mise à jour ${state.availableVersion ?? ''}`}
      >
        <Download className="size-3 animate-pulse" />
        {percent !== null ? `${percent} %` : 'Mise à jour…'}
      </span>
    );
  }

  if (state.phase === 'downloaded') {
    return (
      <button
        type="button"
        onClick={onInstall}
        title={`Redémarrer pour installer la version ${state.availableVersion ?? ''}`}
        className="no-drag flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/25"
      >
        <RotateCw className="size-3" />
        Redémarrer pour mettre à jour
      </button>
    );
  }

  return null;
}
