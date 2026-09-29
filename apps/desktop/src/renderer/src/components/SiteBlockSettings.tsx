import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, Loader2 } from 'lucide-react';
import { DEFAULT_SITEBLOCK_BASE_URL } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import type { SiteBlockStatus } from '../../../shared/ipc';

interface SiteBlockSettingsSectionProps {
  baseUrl: string;
  token: string;
  onChange: (values: { siteBlockBaseUrl?: string; siteBlockToken?: string }) => void;
}

/**
 * Réglages SiteBlock : URL loopback et jeton Bearer. Pas de variable
 * d'environnement — le secret reste dans settings.json. « Tester »
 * sonde l'API locale avec les valeurs du formulaire, avant Enregistrer.
 */
export function SiteBlockSettingsSection({
  baseUrl,
  token,
  onChange,
}: SiteBlockSettingsSectionProps) {
  const [status, setStatus] = useState<SiteBlockStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = (): void => {
    setLoading(true);
    void window.jarvis.settings
      .siteBlockStatus({ baseUrl, token })
      .then(setStatus)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, [baseUrl, token]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
          Blocage de sites
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Jarvis parle à l'application SiteBlock déjà installée — il ne réécrit pas le fichier
          hosts. L'app doit tourner sur ce PC, API locale allumée.
        </p>
      </div>

      <Field
        label="URL de l'API locale"
        hint={`Uniquement 127.0.0.1, localhost ou ::1. Défaut : ${DEFAULT_SITEBLOCK_BASE_URL}. Si SiteBlock a écrit %APPDATA%\\SiteBlock\\api.json, Jarvis y lit le port réel tant que cette URL reste le défaut.`}
      >
        <Input
          value={baseUrl}
          placeholder={DEFAULT_SITEBLOCK_BASE_URL}
          onChange={(event) => onChange({ siteBlockBaseUrl: event.target.value })}
        />
      </Field>

      <Field
        label="Jeton d'accès"
        hint="Secret local, collé ici — jamais une variable d'environnement. Tu le copies depuis SiteBlock, ou tu laisses vide : Jarvis le lit alors dans api.json si SiteBlock tourne."
      >
        <Input
          type="password"
          value={token}
          placeholder="Jeton Bearer SiteBlock…"
          onChange={(event) => onChange({ siteBlockToken: event.target.value })}
        />
      </Field>

      <StatusBadge status={status} loading={loading} />

      <Button size="sm" variant="subtle" onClick={refresh} disabled={loading}>
        {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Tester la connexion
      </Button>
    </div>
  );
}

function StatusBadge({ status, loading }: { status: SiteBlockStatus | null; loading: boolean }) {
  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Vérification de SiteBlock…
      </p>
    );
  }

  if (status?.reachable) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
        <CheckCircle2 className="size-3.5 shrink-0" />
        <span>
          SiteBlock joignable
          {status.blockingActiveNow ? ' — blocage actuellement actif.' : ' — blocage inactif.'}
        </span>
      </p>
    );
  }

  if (status && !status.configured) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
        <CircleSlash className="size-3.5 shrink-0" />
        <span>{status.error ?? 'Renseigne le jeton, ou lance SiteBlock.'}</span>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
      <CircleSlash className="size-3.5 shrink-0" />
      <span>{status?.error ?? 'SiteBlock n’est pas joignable pour l’instant.'}</span>
    </p>
  );
}
