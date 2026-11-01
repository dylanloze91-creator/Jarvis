import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleDashed, Copy, Loader2, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { encodeQr, qrSvgPath } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/field';
import type { PhoneStatus } from '../../../shared/ipc';

/**
 * 5.0.63 — Réglages → Téléphone. Appliqué tout de suite (comme le micro), sans « Enregistrer » :
 * l'état vit dans `userData/phone.json`, pas dans le brouillon des réglages.
 */
export function PhoneSettingsSection() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const run = useCallback((action: () => Promise<PhoneStatus>) => {
    setLoading(true);
    void action()
      .then(setStatus)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    run(() => window.jarvis.phone.status());
    return window.jarvis.phone.onEvent(setStatus);
  }, [run]);

  // Compte à rebours du code ; à l'expiration, l'état est relu.
  const pairing = status?.pairing ?? null;
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);
  useEffect(() => {
    if (pairing && now > pairing.expiresAt) run(() => window.jarvis.phone.cancelPairing());
  }, [now, pairing, run]);

  if (!status) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Lecture de l’état…
      </p>
    );
  }

  const { tailscale } = status;
  const tailscaleReady = tailscale.online && !!tailscale.dnsName;
  const copyCommand = (): void => {
    void navigator.clipboard
      .writeText(status.serveCommand)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };
  const remaining = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Jarvis sur ton téléphone</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Le cerveau reste sur ce PC : ton iPhone lui envoie tes demandes et affiche ses réponses, de chez toi ou de
          l’extérieur, par Tailscale (réseau privé et gratuit entre tes appareils). Rien n’est ouvert sur Internet. Les
          actions sensibles demandent ton accord sur le téléphone, comme ici. Le PC doit rester allumé, Jarvis ouvert.
        </p>
      </div>

      <Toggle
        label="Accès depuis le téléphone"
        hint="Coupé : aucun accès possible, même pour un téléphone déjà relié."
        checked={status.enabled}
        onChange={(enabled) => run(() => window.jarvis.phone.setEnabled(enabled))}
      />

      {status.error ? <p className="text-xs text-rose-300">{status.error}</p> : null}

      {status.enabled ? (
        <div className="flex flex-col gap-3">
          <Step
            done={tailscaleReady}
            title="1. Tailscale sur ce PC et sur l’iPhone"
            doneText={`Connecté : ${tailscale.dnsName ?? ''}`}
          >
            <p>
              {tailscale.installed
                ? 'Tailscale est installé mais pas connecté : ouvre-le et connecte-toi.'
                : 'Installe Tailscale sur ce PC et sur l’iPhone (App Store), puis connecte-toi avec le même compte sur les deux.'}{' '}
              <a className="text-accent underline" href="https://tailscale.com/download" target="_blank" rel="noreferrer">
                tailscale.com/download
              </a>
            </p>
          </Step>

          <Step
            done={tailscale.served === true}
            title="2. Publier Jarvis sur ton réseau Tailscale (une seule fois)"
            doneText="Publié en HTTPS, visible seulement par tes appareils."
          >
            <p>Ouvre PowerShell et tape cette commande, puis « Vérifier à nouveau » :</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 rounded-md bg-black/40 px-2 py-1.5 font-mono text-[12px] text-cyan-100">
                {status.serveCommand}
              </code>
              <Button size="sm" variant="subtle" onClick={copyCommand}>
                <Copy className="size-3.5" />
                {copied ? 'Copié' : 'Copier'}
              </Button>
            </div>
            <p className="mt-1.5">
              Si Tailscale affiche un lien pour activer HTTPS, ouvre-le et clique sur « Enable » : c’est gratuit.
              {tailscale.served === null && tailscaleReady ? ' (État non lu : vérifie quand même.)' : ''}
            </p>
          </Step>

          <Step done={status.devices.length > 0} title="3. Relier ton iPhone" doneText="Téléphone relié.">
            <p>Le code dure 10 minutes. Tu peux relier plusieurs appareils.</p>
          </Step>

          {pairing ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-4 text-center">
              {pairing.url ? <QrImage text={pairing.url} /> : null}
              <p className="text-xs text-slate-300">
                {pairing.url
                  ? 'Scanne avec l’appareil photo de l’iPhone, puis suis les étapes affichées. Code à taper :'
                  : 'Ouvre l’adresse de Jarvis sur ton iPhone et tape ce code :'}
              </p>
              <p className="font-mono text-3xl font-semibold tracking-[0.3em] text-cyan-100">{pairing.code}</p>
              <p className="text-[11px] text-slate-500">
                Expire dans {Math.floor(remaining / 60)} min {String(remaining % 60).padStart(2, '0')} s
              </p>
              <Button size="sm" variant="ghost" onClick={() => run(() => window.jarvis.phone.cancelPairing())}>
                Annuler
              </Button>
            </div>
          ) : (
            <Button
              variant="default"
              disabled={!status.running || loading}
              onClick={() => run(() => window.jarvis.phone.startPairing())}
            >
              <Smartphone className="size-4" />
              Relier un téléphone
            </Button>
          )}

          {status.url ? (
            <p className="text-[11px] text-slate-500">
              Adresse de Jarvis sur tes appareils : <span className="font-mono text-slate-300">{status.url}</span>
            </p>
          ) : null}

          {status.devices.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Appareils reliés</p>
              {status.devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-slate-200">{device.name}</p>
                    <p className="text-[11px] text-slate-500">
                      Relié le {new Date(device.createdAt).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => run(() => window.jarvis.phone.revoke(device.id))}>
                    <Trash2 className="size-3.5" />
                    Retirer
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <Button size="sm" variant="ghost" disabled={loading} onClick={() => run(() => window.jarvis.phone.status())}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Vérifier à nouveau
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Step({
  done,
  title,
  doneText,
  children,
}: {
  done: boolean;
  title: string;
  doneText: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-slate-500" />
      )}
      <div className="min-w-0 flex-1 text-xs leading-snug text-slate-400">
        <p className="text-sm text-slate-200">{title}</p>
        {done ? <p className="mt-0.5 text-emerald-200/80">{doneText}</p> : <div className="mt-1">{children}</div>}
      </div>
    </div>
  );
}

function QrImage({ text }: { text: string }) {
  const matrix = useMemo(() => encodeQr(text), [text]);
  const size = matrix.size + 8;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-48 rounded-lg"
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code de jumelage"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrSvgPath(matrix)} fill="#000" />
    </svg>
  );
}
