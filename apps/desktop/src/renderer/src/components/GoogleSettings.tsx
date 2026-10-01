import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react';
import { GOOGLE_REDIRECT_URI, type GoogleAccessMode } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { GoogleStatus } from '../../../shared/ipc';

interface GoogleSettingsSectionProps {
  clientId: string;
  clientSecret: string;
  access: GoogleAccessMode;
  onChange: (values: { googleClientId?: string; googleClientSecret?: string; googleAccess?: GoogleAccessMode }) => void;
}

/**
 * Réglages Google : identifiant et secret du client « Application de
 * bureau », mode lecture seule ou lecture et écriture, connexion dans le
 * navigateur, révocation. Comme Spotify, le brouillon du formulaire sert
 * tout de suite, sans « Enregistrer » préalable.
 */
export function GoogleSettingsSection({ clientId, clientSecret, access, onChange }: GoogleSettingsSectionProps) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const draft = { clientId, clientSecret, access };
  const refresh = useCallback(() => {
    void window.jarvis.settings
      .googleStatus({ clientId, clientSecret, access })
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [clientId, clientSecret, access]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = (): void => {
    setConnecting(true);
    setError(null);
    setNotice(null);
    void window.jarvis.settings
      .googleConnect(draft)
      .then((result) => {
        setStatus(result.status);
        if (result.ok) setNotice('Google est connecté. Pense à « Enregistrer » pour garder l’identifiant et le mode choisis.');
        else setError(result.error);
      })
      .catch(() => setError('La connexion Google a échoué. Réessaie.'))
      .finally(() => setConnecting(false));
  };

  const disconnect = (): void => {
    setConfirmDisconnect(false);
    setError(null);
    void window.jarvis.settings.googleDisconnect().then((result) => {
      setStatus(result.status);
      setNotice(result.message);
    });
  };

  const ready = clientId.trim().length > 0;
  const connected = status?.connected ?? false;
  const needsReconsent = status?.needsReconsent ?? false;

  return (
    <div className="flex flex-col gap-3" data-google-settings>
      <div className="mt-1 flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Google Workspace</span>
        <p className="text-xs leading-snug text-slate-500">
          Gmail, Agenda, Drive, Docs et Sheets avec ton propre accès Google, gratuit. Jarvis lit sans demander ; il
          te demande toujours avant d’écrire, et il n’efface jamais de mail.
        </p>
      </div>

      <StatusBadge status={status} loading={loading} ready={ready} />

      <div className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
        <Field
          label="Identifiant client (Client ID)"
          hint="Client OAuth de type « Application de bureau » (voir le guide plus bas)."
        >
          <Input
            value={clientId}
            spellCheck={false}
            autoComplete="off"
            placeholder="123456789-abc….apps.googleusercontent.com"
            onChange={(event) => onChange({ googleClientId: event.target.value })}
          />
        </Field>
        <Field
          label="Secret client"
          hint="Google l’affiche une seule fois, à la création du client. Gardé sur ce PC, envoyé uniquement à Google."
        >
          <Input
            type="password"
            value={clientSecret}
            spellCheck={false}
            autoComplete="off"
            placeholder="GOCSPX-…"
            onChange={(event) => onChange({ googleClientSecret: event.target.value })}
          />
        </Field>
        <Field
          label="Accès demandé"
          hint="En lecture seule, Jarvis ne demande à Google aucun droit d’écriture. Changer de mode demande de se reconnecter."
        >
          <Select value={access} onChange={(event) => onChange({ googleAccess: event.target.value as GoogleAccessMode })}>
            <option value="full">Lecture et écriture (chaque écriture te sera demandée)</option>
            <option value="readonly">Lecture seule</option>
          </Select>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={connected && !needsReconsent ? 'subtle' : 'default'} onClick={connect} disabled={!ready || connecting}>
            {connecting ? <Loader2 className="size-3.5 animate-spin" /> : connected ? <RefreshCw className="size-3.5" /> : <ExternalLink className="size-3.5" />}
            {connecting ? 'Valide dans ton navigateur…' : connected ? 'Se reconnecter' : 'Se connecter'}
          </Button>
          {connecting ? (
            <Button size="sm" variant="ghost" onClick={() => void window.jarvis.settings.googleCancel()}>
              <X className="size-3.5" />
              Annuler
            </Button>
          ) : null}
          {connected && !connecting ? (
            confirmDisconnect ? (
              <span className="flex items-center gap-2 text-xs text-slate-400">
                Révoquer l’accès et effacer les jetons ?
                <Button size="sm" variant="danger" onClick={disconnect}>
                  Oui, déconnecter
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(false)}>
                  Non
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)}>
                <LogOut className="size-3.5" />
                Se déconnecter
              </Button>
            )
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs leading-snug text-rose-100">
            {error}
          </p>
        ) : null}
        {notice ? <p className="text-xs leading-snug text-accent">{notice}</p> : null}
        {status?.clientMismatch ? (
          <p className="text-xs leading-snug text-amber-200">
            L’identifiant ci-dessus n’est pas celui qui a été autorisé. Jarvis continue avec l’ancien ; clique
            « Se reconnecter » pour passer au nouveau.
          </p>
        ) : null}
        {connected && status && status.requestedAccess !== status.access ? (
          <p className="text-xs leading-snug text-amber-200">
            {status.access === 'readonly'
              ? 'Connecté en lecture seule : clique « Se reconnecter » pour autoriser l’écriture.'
              : 'Lecture seule choisie : les écritures sont déjà coupées. « Se reconnecter » retire aussi les droits chez Google.'}
          </p>
        ) : null}
        {connected && status && !status.persistent ? (
          <p className="text-xs leading-snug text-amber-200">
            Le chiffrement de Windows n’est pas disponible : la connexion reste en mémoire et sera perdue au prochain
            démarrage.
          </p>
        ) : null}
      </div>

      {connected && status ? <ServicesGrid status={status} /> : null}

      <AlwaysAsks />

      <Guide defaultOpen={!loading && !connected} />
    </div>
  );
}

function StatusBadge({ status, loading, ready }: { status: GoogleStatus | null; loading: boolean; ready: boolean }) {
  if (loading && !status) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Vérification de la connexion Google…
      </p>
    );
  }
  if (status?.connecting) {
    return (
      <Badge tone="info" icon={<Loader2 className="size-3.5 shrink-0 animate-spin" />}>
        Navigateur ouvert : choisis ton compte et accepte. Jarvis attend le retour de Google (5 min au plus).
      </Badge>
    );
  }
  if (status?.needsReconsent) {
    return (
      <Badge tone="warn" icon={<AlertTriangle className="size-3.5 shrink-0" />}>
        Connexion expirée ou retirée par Google (en mode Test, au bout de 7 jours). Clique « Se reconnecter ».
      </Badge>
    );
  }
  if (status?.connected) {
    return (
      <Badge tone="ok" icon={<CheckCircle2 className="size-3.5 shrink-0" />}>
        Connecté{status.account ? ` : ${status.account}` : ''} — {status.access === 'readonly' ? 'lecture seule' : 'lecture et écriture'}.
      </Badge>
    );
  }
  if (!ready) {
    return (
      <Badge tone="idle" icon={<CircleSlash className="size-3.5 shrink-0" />}>
        Google n’est pas connecté. Suis le guide ci-dessous, colle ton identifiant client et ton secret, puis « Se connecter ».
      </Badge>
    );
  }
  return (
    <Badge tone="idle" icon={<CircleSlash className="size-3.5 shrink-0" />}>
      Pas encore connecté : clique « Se connecter ».
    </Badge>
  );
}

function Badge({ tone, icon, children }: { tone: 'ok' | 'warn' | 'idle' | 'info'; icon: ReactNode; children: ReactNode }) {
  return (
    <p
      data-google-status={tone}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug',
        tone === 'ok' && 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
        tone === 'warn' && 'border-amber-400/25 bg-amber-400/10 text-amber-100',
        tone === 'info' && 'border-accent/25 bg-accent/10 text-cyan-100',
        tone === 'idle' && 'border-white/8 bg-white/[0.03] text-slate-400',
      )}
    >
      <span className="mt-px">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

function ServicesGrid({ status }: { status: GoogleStatus }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" aria-label="Accès accordés">
      {status.services.map((service) => (
        <div key={service.id} className="rounded-lg border border-white/8 bg-white/[0.02] px-2 py-2 text-center">
          <p className="text-xs font-medium text-slate-200">{service.label}</p>
          <p className={cn('mt-0.5 text-[11px]', service.read ? 'text-emerald-300' : 'text-amber-300')}>
            {service.read ? 'lecture' : 'lecture refusée'}
          </p>
          {service.id !== 'drive' ? (
            <p
              className={cn(
                'text-[11px]',
                service.write ? 'text-emerald-300' : service.writeMissing ? 'text-amber-300' : 'text-slate-500',
              )}
            >
              {service.write ? 'écriture' : service.writeMissing ? 'écriture refusée' : 'sans écriture'}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">lecture seule</p>
          )}
        </div>
      ))}
    </div>
  );
}

function AlwaysAsks() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-slate-500" />
      <div className="text-xs leading-snug text-slate-500">
        <p className="text-slate-400">Toujours demandé avant d’agir (même si les réglages de confirmation sont sur « jamais »)</p>
        <p className="mt-1">
          Créer un brouillon, un événement, un document ; modifier un événement ; ajouter du texte ou des lignes.
        </p>
        <p className="mt-1">
          <span className="text-slate-400">Confirmation incompressible :</span> envoyer un mail (la carte montre
          destinataire, objet et texte exacts), supprimer un événement, écraser une plage de cellules.
        </p>
        <p className="mt-1">Après chaque écriture, Jarvis relit chez Google avant de dire « c’est fait ».</p>
      </div>
    </div>
  );
}

const CONSOLE = 'https://console.cloud.google.com';

function Guide({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-lg border border-white/8 bg-white/[0.02]"
    >
      <summary className="no-drag flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-slate-500 transition-transform group-open:rotate-90" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Guide : ton accès Google en 6 étapes</span>
          <span className="text-xs text-slate-500">Gratuit, sans carte bancaire, environ dix minutes.</span>
        </span>
      </summary>
      <ol className="flex list-decimal flex-col gap-2.5 border-t border-white/8 py-3 pr-3 pl-8 text-xs leading-relaxed text-slate-400 marker:text-slate-500">
        <li>
          Crée un projet sur <Link href={`${CONSOLE}/projectcreate`}>Google Cloud</Link> (nom : « Jarvis »), puis
          sélectionne-le en haut de la page.
        </li>
        <li>
          Active les cinq API (API et services → Bibliothèque → « Activer ») :{' '}
          <Link href={`${CONSOLE}/apis/library/gmail.googleapis.com`}>Gmail API</Link>,{' '}
          <Link href={`${CONSOLE}/apis/library/calendar-json.googleapis.com`}>Google Calendar API</Link>,{' '}
          <Link href={`${CONSOLE}/apis/library/drive.googleapis.com`}>Google Drive API</Link>,{' '}
          <Link href={`${CONSOLE}/apis/library/docs.googleapis.com`}>Google Docs API</Link>,{' '}
          <Link href={`${CONSOLE}/apis/library/sheets.googleapis.com`}>Google Sheets API</Link>.
        </li>
        <li>
          Écran de consentement : <Link href={`${CONSOLE}/auth/overview`}>Google Auth Platform</Link> → « Commencer »
          (Get started). Nom de l’appli « Jarvis », ton adresse en e-mail d’assistance ; Audience : « Externe »
          (External) ; ton adresse en contact ; accepte la règle, puis « Créer ».
        </li>
        <li>
          <Link href={`${CONSOLE}/auth/audience`}>Audience</Link> : laisse l’état de publication sur « Test » (Testing).
          Sous « Utilisateurs test » (Test users) → « Ajouter des utilisateurs » → ton adresse Gmail → « Enregistrer ».
        </li>
        <li>
          <Link href={`${CONSOLE}/auth/clients`}>Clients</Link> → « Créer un client » → type « Application de bureau »
          (Desktop app) → nom « Jarvis » → « Créer ». Copie tout de suite l’ID client et le secret client : Google ne
          montre le secret qu’une fois (sinon « Télécharger le JSON »).
        </li>
        <li>
          Colle-les ci-dessus, choisis le mode, clique « Se connecter ». Dans le navigateur : ton compte → « Google n’a
          pas validé cette application » → « Continuer » → coche les accès → « Continuer ». Reviens ici : « Connecté ».
        </li>
      </ol>
      <div className="flex flex-col gap-1.5 border-t border-white/8 px-3 py-3 text-xs leading-snug text-slate-500">
        <p>
          <span className="text-slate-400">Mode Test : 7 jours.</span> Google coupe l’accès d’une appli en mode Test au
          bout de 7 jours. Jarvis te le dit en français ; un clic sur « Se reconnecter » suffit.
        </p>
        <p>
          <span className="text-slate-400">Autorisations « restreintes ».</span> Lire Gmail, écrire des brouillons ou
          envoyer, et lire tout Drive sont classés « restreints » par Google : c’est pour ça que l’écran « application
          non validée » s’affiche. Pour ton usage personnel en mode Test, aucune validation Google n’est nécessaire.
        </p>
        <p>
          Adresse de retour utilisée : <code className="text-slate-400">{GOOGLE_REDIRECT_URI}</code> (rien à saisir pour un
          client « Application de bureau » ; différente de Spotify).
        </p>
      </div>
    </details>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="no-drag text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}
