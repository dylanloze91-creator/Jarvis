import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, ExternalLink, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import type { SpotifyStatus } from '../../../shared/ipc';

interface SpotifySettingsSectionProps {
  clientId: string;
  onChange: (clientId: string) => void;
}

/**
 * Réglages Spotify : identifiant client, statut de connexion (connecté / non
 * connecté), et les deux gestes explicites demandés lors de l'intégration de
 * cette fonctionnalité — un bouton pour lancer la connexion, un pour se
 * déconnecter en supprimant le jeton local. Le statut et les actions
 * utilisent toujours la valeur actuelle du champ (`clientId`), pas besoin
 * d'enregistrer les réglages avant de tester — même principe que la section
 * Ollama.
 */
export function SpotifySettingsSection({ clientId, onChange }: SpotifySettingsSectionProps) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const refreshStatus = (): void => {
    setLoadingStatus(true);
    void window.jarvis.settings
      .spotifyStatus(clientId)
      .then(setStatus)
      .finally(() => setLoadingStatus(false));
  };

  useEffect(() => {
    refreshStatus();
  }, [clientId]);

  const connect = (): void => {
    setConnecting(true);
    setConnectError(null);
    void window.jarvis.settings
      .spotifyConnect(clientId)
      .then((result) => {
        if (!result.ok) setConnectError(result.error);
        refreshStatus();
      })
      .finally(() => setConnecting(false));
  };

  const disconnect = (): void => {
    void window.jarvis.settings.spotifyDisconnect(clientId).then(refreshStatus);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Spotify</p>
      </div>

      <Field
        label="Identifiant client (Client ID)"
        hint="Crée une application sur developer.spotify.com/dashboard, puis copie son Client ID ici. Renseigne exactement http://127.0.0.1:53124/callback comme Redirect URI dans les réglages de l'application Spotify. Aucun Client Secret n'est nécessaire (authentification PKCE)."
      >
        <Input
          value={clientId}
          placeholder="Identifiant client Spotify…"
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>

      <StatusBadge status={status} loading={loadingStatus} clientId={clientId} />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="subtle"
          onClick={connect}
          disabled={!clientId.trim() || connecting}
        >
          {connecting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
          {connecting ? 'En attente de la validation dans le navigateur…' : 'Se connecter'}
        </Button>
        {status?.connected ? (
          <Button size="sm" variant="ghost" onClick={disconnect}>
            <LogOut className="size-3.5" />
            Se déconnecter
          </Button>
        ) : null}
      </div>

      {connectError ? (
        <p className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs leading-snug text-rose-100">
          {connectError}
        </p>
      ) : null}

      <p className="text-xs leading-snug text-slate-500">
        Le contrôle de lecture (lancer, mettre en pause, changer de morceau, régler le volume…)
        exige un abonnement <strong className="text-slate-400">Spotify Premium</strong> — c'est une
        limite de l'API Web de Spotify, pas de Jarvis. Sans Premium, ces outils échoueront avec un
        message d'erreur Spotify explicite.
      </p>
    </div>
  );
}

function StatusBadge({
  status,
  loading,
  clientId,
}: {
  status: SpotifyStatus | null;
  loading: boolean;
  clientId: string;
}) {
  if (!clientId.trim()) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
        <CircleSlash className="size-3.5 shrink-0" />
        <span>Renseigne l'identifiant client pour activer Spotify.</span>
      </p>
    );
  }

  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Vérification du statut…
      </p>
    );
  }

  if (status?.connected) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>Compte Spotify connecté.</span>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
      <CircleSlash className="size-3.5 shrink-0" />
      <span>Pas encore connecté : clique « Se connecter » ou lance un outil Spotify.</span>
    </p>
  );
}
