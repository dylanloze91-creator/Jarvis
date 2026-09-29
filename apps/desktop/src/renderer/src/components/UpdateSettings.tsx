import { CheckCircle2, Download, RefreshCw, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpdate } from '@/hooks/useUpdate';

/**
 * Section « Mises à jour » des réglages : version installée, dernière
 * vérification, résultat clair (à jour / disponible / échec et pourquoi),
 * bouton de vérification manuelle. Ne bloque jamais l'utilisateur.
 */
export function UpdateSettingsSection() {
  const { state, check, install } = useUpdate();

  if (!state) return null;

  const checking = state.phase === 'checking' || state.phase === 'downloading';

  return (
    <div className="flex flex-col gap-3 border-t border-white/8 pt-4">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          Mises à jour
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-300">
          Version installée : <span className="font-medium text-slate-100">{state.currentVersion}</span>
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <StatusLine state={state} />

        {state.phase === 'downloading' && state.progress ? (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, state.progress.percent))}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-500">
              {formatBytes(state.progress.transferredBytes)} /{' '}
              {formatBytes(state.progress.totalBytes)} —{' '}
              {formatBytes(state.progress.bytesPerSecond)}/s
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {lastCheckedLabel(state.lastCheckedAt)}
          </span>

          {state.phase === 'downloaded' ? (
            <Button variant="default" size="sm" onClick={install}>
              <RotateCw className="size-3.5" />
              Redémarrer et installer
            </Button>
          ) : (
            <Button variant="subtle" size="sm" onClick={check} disabled={checking}>
              <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} />
              Vérifier les mises à jour
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusLine({ state }: { state: ReturnType<typeof useUpdate>['state'] }) {
  if (!state) return null;

  switch (state.phase) {
    case 'checking':
      return (
        <p className="flex items-center gap-1.5 text-xs leading-snug text-slate-300">
          <RefreshCw className="size-3.5 animate-spin text-slate-500" />
          Vérification en cours…
        </p>
      );
    case 'available':
      return (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-slate-200">
          <Download className="mt-0.5 size-3.5 shrink-0 text-accent" />
          {state.canInstall
            ? `Une mise à jour est disponible : version ${state.availableVersion}.`
            : `Une mise à jour est disponible : version ${state.availableVersion}. Le téléchargement automatique n'est possible que depuis l'application installée.`}
        </p>
      );
    case 'downloading':
      return (
        <p className="flex items-center gap-1.5 text-xs leading-snug text-slate-300">
          <Download className="size-3.5 text-accent" />
          Téléchargement de la version {state.availableVersion} en arrière-plan…
        </p>
      );
    case 'downloaded':
      return (
        <p className="flex items-center gap-1.5 text-xs leading-snug text-slate-200">
          <CheckCircle2 className="size-3.5 text-accent" />
          Version {state.availableVersion} prête — redémarre Jarvis pour l'installer.
        </p>
      );
    case 'not-available':
      return (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-slate-300">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
          {state.feedStatus === 'empty'
            ? "À jour — aucune version plus récente n'est publiée sur GitHub (aucune GitHub Release pour l'instant)."
            : 'Jarvis est à jour.'}
        </p>
      );
    case 'error':
      return (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
          Vérification échouée
          {state.errorKind === 'network' ? ' (réseau)' : ''} :{' '}
          {state.errorMessage ?? 'La vérification des mises à jour a échoué.'}
        </p>
      );
    case 'unsupported':
      return (
        <p className="text-xs leading-snug text-slate-500">
          Mise à jour automatique indisponible en mode développement.
        </p>
      );
    case 'idle':
    default:
      return (
        <p className="text-xs leading-snug text-slate-500">
          Aucune vérification effectuée pour l'instant.
        </p>
      );
  }
}

function lastCheckedLabel(lastCheckedAt: number | undefined): string {
  if (!lastCheckedAt) return 'Jamais vérifié';
  const formatted = new Date(lastCheckedAt).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Dernière vérification : ${formatted}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Mo';
  const mo = bytes / (1024 * 1024);
  return mo >= 1 ? `${mo.toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`;
}
