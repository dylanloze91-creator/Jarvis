import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, Loader2 } from 'lucide-react';
import { checkRoverBaseUrl, DEFAULT_ROVER_BASE_URL } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import type { RoverConnectionStatus } from '../../../shared/ipc';

interface RoverSettingsSectionProps {
  baseUrl: string;
  token: string;
  onChange: (values: { roverBaseUrl?: string; roverToken?: string }) => void;
}

/**
 * Réglages du robot Jarvis Rover : adresse sur le réseau local et jeton
 * affiché par l'installation sur le Raspberry Pi. Le jeton reste dans
 * settings.json. « Tester » sonde le robot avec les valeurs du formulaire,
 * avant Enregistrer. Adresse vide = robot absent du catalogue d'outils.
 */
export function RoverSettingsSection({ baseUrl, token, onChange }: RoverSettingsSectionProps) {
  const [status, setStatus] = useState<RoverConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const urlCheck = baseUrl.trim() ? checkRoverBaseUrl(baseUrl) : null;

  const refresh = (): void => {
    if (!baseUrl.trim()) {
      setStatus(null);
      return;
    }
    setLoading(true);
    void window.jarvis.settings
      .roverStatus({ baseUrl, token })
      .then(setStatus)
      .finally(() => setLoading(false));
  };

  // Pas de sonde à chaque frappe : le robot peut être éteint, chaque essai attend 5 s.
  useEffect(() => {
    setStatus(null);
  }, [baseUrl, token]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Robot Jarvis Rover</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Jarvis pilote le robot par le Wi-Fi de la maison : « avance de 50 cm », « tourne à gauche de 90° »,
          « stop ». Chaque mouvement passe par une carte de confirmation ; « stop » et l’arrêt d’urgence partent
          tout de suite. Sans adresse, rien du robot n’apparaît dans Jarvis.
        </p>
      </div>

      <Field
        label="Adresse du robot"
        hint={`Réseau local seulement (nom en .local, IP 192.168.x.x ou localhost). Sur le Pi : ${DEFAULT_ROVER_BASE_URL}. Pour essayer le simulateur sur ce PC : http://127.0.0.1:8765.`}
      >
        <Input
          value={baseUrl}
          placeholder={DEFAULT_ROVER_BASE_URL}
          onChange={(event) => onChange({ roverBaseUrl: event.target.value })}
        />
      </Field>
      {urlCheck && !urlCheck.ok ? <p className="text-xs text-amber-200">{urlCheck.reason}</p> : null}

      <Field
        label="Jeton du robot"
        hint="Affiché à la fin de l’installation sur le Pi (ou par « python -m jarvis_rover --afficher-jeton »). Secret local, jamais une variable d’environnement."
      >
        <Input
          type="password"
          value={token}
          placeholder="Jeton du robot…"
          onChange={(event) => onChange({ roverToken: event.target.value })}
        />
      </Field>

      <StatusBadge status={status} loading={loading} />

      <Button size="sm" variant="subtle" onClick={refresh} disabled={loading || !baseUrl.trim()}>
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Tester la connexion
      </Button>
    </div>
  );
}

function StatusBadge({ status, loading }: { status: RoverConnectionStatus | null; loading: boolean }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Recherche du robot…
      </p>
    );
  }
  if (!status) return null;

  if (status.reachable && status.authorized) {
    const mode = status.mode === 'simulation' ? 'en simulation (aucun moteur réel)' : 'connecté au matériel';
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>
          Robot joint, jeton accepté — {mode}
          {status.version ? ` (service ${status.version})` : ''}. Pense à enregistrer.
        </span>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
      <CircleSlash className="size-3.5 shrink-0" />
      <span>{status.error ?? 'Le robot n’est pas joignable pour l’instant.'}</span>
    </p>
  );
}
