import { useCallback, useEffect, useState } from 'react';
import { Loader2, OctagonX, RefreshCw } from 'lucide-react';
import { SecretInput } from '@/components/SecretInput';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirmButton';
import { Field, Input, Toggle } from '@/components/ui/field';
import type { AppendiceStatus, AppendiceView } from '../../../shared/ipc';

const GENRES: Record<AppendiceView['genre'], string> = {
  oeil: 'Œil',
  bras: 'Bras',
  jambes: 'Jambes',
  oreille: 'Oreille',
  sens: 'Sens',
  main: 'Main sur la maison',
  ecran: 'Écran',
  energie: 'Énergie',
};
const RISKS: Record<AppendiceView['risque'], string> = {
  lire: 'lit',
  agir: 'agit',
  bouger: 'bouge ou chauffe',
};
const STATES: Record<NonNullable<AppendiceView['etat']>, string> = {
  pret: 'Prêt',
  occupe: 'Occupé',
  arrete: 'Arrêté',
  arret_urgence: 'En arrêt d’urgence',
  erreur: 'En erreur',
};

/** Vrai dans Jarvis Test seulement : dans Jarvis Live, la section n'existe pas. */
export function useAppendicesAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let stop = false;
    void window.jarvis.appendices
      ?.status()
      .then((status) => {
        if (!stop) setAllowed(status.allowed);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);
  return allowed;
}

/**
 * Réglages → Appendices (Jarvis Test). Appliqué tout de suite, sans « Enregistrer » : le registre
 * vit dans `appendices.json`, pas dans le brouillon des réglages. Le jeton n'est jamais réaffiché.
 */
export function AppendicesSettingsSection() {
  const [status, setStatus] = useState<AppendiceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback((action: () => Promise<AppendiceStatus>) => {
    setLoading(true);
    void action()
      .then(setStatus)
      .catch(() => setNotice('Jarvis n’a pas répondu.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    run(() => window.jarvis.appendices.status(true));
  }, [run]);

  if (!status?.allowed) return null;

  const add = (): void => {
    setLoading(true);
    setNotice(null);
    void window.jarvis.appendices
      .add({ baseUrl, token })
      .then((reply) => {
        setStatus(reply.status);
        if (reply.ok) {
          setBaseUrl('');
          setToken('');
        } else {
          setNotice(reply.sentence);
        }
      })
      .catch(() => setNotice('Jarvis n’a pas répondu.'))
      .finally(() => setLoading(false));
  };

  const stopAll = (): void => {
    setLoading(true);
    void window.jarvis.appendices
      .stopAll()
      .then((reply) => {
        setStatus(reply.status);
        setNotice(reply.sentence || 'Rien à arrêter.');
      })
      .catch(() => setNotice('Jarvis n’a pas répondu. Utilise le bouton d’arrêt d’urgence.'))
      .finally(() => setLoading(false));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-snug text-slate-500">
        Les appendices sont les bras, capteurs et lampes que Jarvis commande sur le réseau de la maison. Chaque action
        demande ton accord sur une carte ; « stop » et « Jarvis, arrête tout » partent tout de suite. Coupé : rien
        n’apparaît dans Jarvis.
      </p>

      <Toggle
        label="Appendices"
        hint="Jarvis Test seulement. Réseau local, un jeton par appendice."
        checked={status.enabled}
        disabled={loading}
        onChange={(enabled) => run(() => window.jarvis.appendices.setEnabled(enabled))}
      />

      {!status.encryption ? (
        <p className="text-xs text-amber-200">
          Ce PC ne peut pas chiffrer les jetons : ils restent en mémoire et seront à redonner après un redémarrage.
        </p>
      ) : null}

      {status.appendices.length ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" onClick={stopAll} disabled={loading} className="text-rose-100">
            <OctagonX className="size-3.5" />
            Tout arrêter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={loading || !status.enabled}
            onClick={() => run(() => window.jarvis.appendices.status(true))}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Relire l’état
          </Button>
        </div>
      ) : null}

      {notice ? <p className="text-xs text-amber-200 select-text">{notice}</p> : null}

      {status.appendices.map((appendice) => (
        <div key={appendice.id} className="flex flex-col gap-1 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-white">
                {appendice.nom}
                {appendice.piece ? <span className="text-slate-400"> · {appendice.piece}</span> : null}
              </p>
              <p className="text-xs text-slate-500">
                {GENRES[appendice.genre]} · {RISKS[appendice.risque]} · version {appendice.version} · {appendice.baseUrl}
              </p>
            </div>
            <ConfirmButton
              label="Retirer"
              disabled={loading}
              onConfirm={() => run(() => window.jarvis.appendices.remove(appendice.id))}
            />
          </div>
          <p className="text-xs text-slate-300">
            {appendice.reachable === false
              ? `Ne répond pas${appendice.error ? ` : ${appendice.error}` : '.'}`
              : appendice.etat
                ? STATES[appendice.etat]
                : status.enabled
                  ? 'État pas encore relu.'
                  : 'Registre coupé : aucun contact.'}
            {!appendice.hasToken ? ' Jeton à redonner : ajoute-le de nouveau avec son adresse.' : ''}
          </p>
          <p className="text-xs text-slate-500">
            Sait faire : {appendice.capacites.map((capacity) => capacity.nom).join(', ') || 'rien d’annoncé'}
          </p>
        </div>
      ))}

      {status.enabled ? (
        <div className="flex flex-col gap-3 rounded-lg border border-white/8 px-3 py-3">
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Relier un appendice</p>
          <Field
            label="Adresse"
            hint="Réseau local seulement (IP 192.168.x.x, nom en .local ou localhost). Pour essayer sans matériel : node apps/desktop/scripts/fake-appendice.mjs, puis l’adresse qu’il affiche."
          >
            <Input value={baseUrl} placeholder="http://127.0.0.1:8770" onChange={(event) => setBaseUrl(event.target.value)} />
          </Field>
          <Field label="Jeton" hint="Affiché par l’appendice à son installation. Gardé chiffré, jamais réaffiché.">
            <SecretInput value={token} placeholder="Jeton de l’appendice…" onChange={setToken} />
          </Field>
          <Button
            size="sm"
            variant="subtle"
            onClick={add}
            disabled={loading || !baseUrl.trim() || !token.trim() || status.appendices.length >= status.max}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Relier
          </Button>
        </div>
      ) : null}
    </div>
  );
}
