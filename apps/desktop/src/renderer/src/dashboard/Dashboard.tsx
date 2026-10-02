import {
  Brain,
  Camera,
  Clapperboard,
  CalendarClock,
  Code2,
  Globe2,
  History,
  Home,
  Mail,
  MessageSquare,
  Mic,
  Monitor,
  Music,
  ScrollText,
  Settings as SettingsIcon,
  Shrink,
  StickyNote,
  UserRound,
  Workflow,
  AppWindow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatSeconds, type Conversation, type Settings } from '@jarvis/core';
import { AuditPanel } from '@/components/AuditPanel';
import { Composer } from '@/components/Composer';
import { ConfirmationCard } from '@/components/ConfirmationCard';
import { DeveloperPanel } from '@/components/developer/DeveloperPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Messages } from '@/components/Messages';
import { SettingsPanel, openSettingsOnTab } from '@/components/SettingsPanel';
import type { SettingsTabId } from '@/components/SettingsTabs';
import { VoiceBar } from '@/components/VoiceBar';
import { formatBytes, formatModelTemperature, formatPercent } from '@/dashboard/format';
import { useMachineSnapshot } from '@/dashboard/useMachine';
import { isDemoRuntime } from '@/lib/runtimeStatus';
import { cn } from '@/lib/utils';
import type { UseVoiceResult } from '@/voice/useVoice';
import type { RuntimeStatus, ToolInfo } from '../../../shared/ipc';
import type { ChatItem, PendingConfirmation } from '@/hooks/useChat';
import { JarvisOrb } from '@/components/JarvisOrb';
import './dashboard.css';

type View = 'chat' | 'history' | 'settings' | 'audit';

interface FunctionCard {
  id: string;
  label: string;
  hint: string;
  prompt: string | null;
  icon: LucideIcon;
  soon: boolean;
  /** Demande un compte Google : sans connexion, ouvre Réglages → Google. */
  google?: boolean;
}

const FUNCTIONS: FunctionCard[] = [
  {
    id: 'search',
    label: 'Recherche web',
    hint: 'Actualités et sources',
    prompt: 'Cherche les dernières infos importantes',
    icon: Globe2,
    soon: false,
  },
  {
    id: 'system',
    label: 'Système',
    hint: 'État de la machine',
    prompt: 'Que se passe-t-il sur mon PC ?',
    icon: Monitor,
    soon: false,
  },
  {
    id: 'memory',
    label: 'Mémoire',
    hint: 'Ce que Jarvis a retenu',
    prompt: 'Rappelle-moi ce que tu sais de mes projets',
    icon: Brain,
    soon: false,
  },
  {
    id: 'music',
    label: 'Musique',
    hint: 'Lecture Spotify',
    prompt: 'Que joue Spotify en ce moment ?',
    icon: Music,
    soon: false,
  },
  {
    id: 'video',
    label: 'Analyse vidéo',
    hint: 'Résumé et mémoire',
    prompt: 'Analyse cette vidéo YouTube : ',
    icon: Clapperboard,
    soon: false,
  },
  {
    id: 'google',
    label: 'Google',
    hint: 'Agenda, Gmail, Drive',
    prompt: "Qu'est-ce que j'ai à l'agenda aujourd'hui ?",
    icon: Mail,
    soon: false,
    google: true,
  },
  {
    id: 'auto',
    label: 'Automatisation',
    hint: 'Scénarios',
    prompt: null,
    icon: Workflow,
    soon: true,
  },
];

interface QuickAction {
  id: string;
  label: string;
  prompt: string | null;
  icon: LucideIcon;
  soon: boolean;
  google?: boolean;
}

const QUICK: QuickAction[] = [
  { id: 'chrome', label: 'Ouvrir Chrome', prompt: 'Ouvre Google Chrome.', icon: AppWindow, soon: false },
  { id: 'note', label: 'Nouvelle note', prompt: 'Ouvre le Bloc-notes.', icon: StickyNote, soon: false },
  { id: 'mail', label: 'Lire mes emails', prompt: 'Lis mes derniers emails non lus.', icon: Mail, soon: false, google: true },
  { id: 'shot', label: 'Capture d’écran', prompt: 'Prends une capture de l’écran.', icon: Camera, soon: false },
];

export interface DashboardProps {
  view: View;
  setView: (view: View) => void;
  settings: Settings | null;
  status: RuntimeStatus | null;
  tools: ToolInfo[];
  booting: boolean;
  bootError: string | null;
  chat: {
    items: ChatItem[];
    busy: boolean;
    confirmation: PendingConfirmation | null;
    send: (text: string, source?: 'voice' | 'text') => void;
    cancel: () => void;
    respond: (requestId: string, approved: boolean) => void;
  };
  voice: UseVoiceResult;
  onSaved: (payload: { settings: Settings; status: RuntimeStatus }) => void;
  onOpenConversation: (conversation: Conversation) => void;
  onNew: () => void;
  onAnalyzeMachine?: () => void;
}

export function Dashboard({
  view,
  setView,
  settings,
  status,
  tools,
  booting,
  bootError,
  chat,
  voice,
  onSaved,
  onOpenConversation,
  onNew,
  onAnalyzeMachine,
}: DashboardProps) {
  const machine = useMachineSnapshot();
  const [profileInitial, setProfileInitial] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.jarvis.settings
      .personalizationGet()
      .then((profile) => {
        if (cancelled) return;
        const name = [profile.user.prenom, profile.user.prénom, profile.user.nom, profile.user.name]
          .find((value) => typeof value === 'string' && value.trim().length > 0)
          ?.trim();
        setProfileInitial(name ? name.slice(0, 1).toLocaleUpperCase('fr-FR') : null);
      })
      .catch(() => {
        if (!cancelled) setProfileInitial(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [googleReady, setGoogleReady] = useState(false);
  const [settingsTab, setSettingsTab] = useState<{ tab: SettingsTabId; at: number } | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void window.jarvis.settings
      .googleStatus()
      .then((google) => {
        if (!cancelled) setGoogleReady(google.connected && !google.needsReconsent);
      })
      .catch(() => {
        if (!cancelled) setGoogleReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, settings]);

  useEffect(() => {
    if (view !== 'settings') setSettingsTab(undefined);
  }, [view]);

  // Jarvis Développeur : entrée visible seulement quand le mode est activé.
  const [developerScene] = useState(() => (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('scene') ?? '') : ''));
  const [developerOpen, setDeveloperOpen] = useState(() => /^developer-(panel|confirm|model|pull|bench|task-plan|task-run|task-report)$/.test(developerScene));
  const developerEnabled = settings?.developer.enabled ?? false;
  const showDeveloper = developerOpen && developerEnabled;
  const navigate = (next: View): void => {
    setDeveloperOpen(false);
    setView(next);
  };

  const ask = (prompt: string): void => {
    navigate('chat');
    chat.send(prompt);
  };

  const openGoogleSettings = (): void => {
    openSettingsOnTab('google');
    setSettingsTab({ tab: 'google', at: Date.now() });
    navigate('settings');
  };

  const openDeveloperSettings = (): void => {
    openSettingsOnTab('developer');
    setSettingsTab({ tab: 'developer', at: Date.now() });
    navigate('settings');
  };

  const runGoogle = (prompt: string | null): void => {
    if (!googleReady) openGoogleSettings();
    else if (prompt) ask(prompt);
  };

  const presence = presenceOf(status, booting, bootError);
  const temperature = settings ? formatModelTemperature(settings.temperature) : booting ? 'chargement' : 'indisponible';
  const temperatureRatio =
    typeof settings?.temperature === 'number' ? Math.max(0, Math.min(1, settings.temperature / 2)) : 0;

  return (
    <div
      className="dashboard"
      data-ui-ready={booting ? 'no' : 'yes'}
      data-ui-view={view}
      data-ui-layout="dashboard"
    >
      <aside className="dash-side">
        <div className="side-logo" aria-hidden>
          J
        </div>
        <nav className="side-nav" aria-label="Navigation">
          <SideButton label="Accueil" icon={Home} active={!showDeveloper && view === 'chat' && chat.items.length === 0} onClick={() => navigate('chat')} />
          <SideButton label="Discussion" icon={MessageSquare} active={!showDeveloper && view === 'chat' && chat.items.length > 0} onClick={() => navigate('chat')} />
          <SideButton label="Historique" icon={History} active={!showDeveloper && view === 'history'} onClick={() => navigate(view === 'history' ? 'chat' : 'history')} />
          <SideButton label="Google" icon={CalendarClock} onClick={openGoogleSettings} />
          <SideButton label="Automatisation" icon={Workflow} soon />
          {developerEnabled ? <SideButton label="Développeur" icon={Code2} active={showDeveloper} onClick={() => setDeveloperOpen((open) => !open)} /> : null}
          <SideButton label="Micro" icon={Mic} active={false} onClick={() => navigate('settings')} />
          <SideButton label="Journal" icon={ScrollText} active={!showDeveloper && view === 'audit'} onClick={() => navigate(view === 'audit' ? 'chat' : 'audit')} />
          <SideButton label="Réglages" icon={SettingsIcon} active={!showDeveloper && view === 'settings'} onClick={() => navigate(view === 'settings' ? 'chat' : 'settings')} />
        </nav>
        <div className="side-spacer" />
        <div className="side-profile" title={profileInitial ? 'Profil local' : 'Profil'} aria-label={profileInitial ? 'Profil local' : 'Profil'}>
          {profileInitial ?? <UserRound className="size-4" />}
        </div>
      </aside>

      <main className="dash-main">
        <header className="dash-top drag-region">
          <div className="dash-title">
            <h1>JARVIS</h1>
            <p>{presence.hint}</p>
          </div>
          <div className={cn('presence no-drag', presence.tone)}>
            <i />
            {presence.label}
          </div>
          <button
            type="button"
            className="icon-btn no-drag"
            onClick={() => void window.jarvis.window.setChrome('compact')}
          >
            <Shrink className="size-4" /> Réduire
          </button>
        </header>

        {showDeveloper ? (
          <section className="dash-panel">
            <button type="button" className="panel-back" onClick={() => setDeveloperOpen(false)}>
              Retour à l’accueil
            </button>
            <DeveloperPanel
              onOpenSettings={openDeveloperSettings}
              settings={settings}
              onSaved={onSaved}
              initialTab={/^developer-(model|pull|bench)$/.test(developerScene) ? 'model' : developerScene.startsWith('developer-task') ? 'task' : 'project'}
            />
          </section>
        ) : view === 'chat' ? (
          <>
            <section className="dash-stage" aria-label="Assistant">
              <JarvisOrb listening={voice.state === 'listening'} level={voice.level} />
              <div className="temp-readout">
                <svg className="temp-ring" viewBox="0 0 64 64" aria-hidden>
                  <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    stroke="#67e8ff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${(2 * Math.PI * 26 * temperatureRatio).toFixed(2)} ${(2 * Math.PI * 26).toFixed(2)}`}
                    transform="rotate(-90 32 32)"
                  />
                </svg>
                <span>Température du modèle</span>
                <strong>{temperature}</strong>
              </div>
            </section>

            <div className="fn-row">
              {FUNCTIONS.filter((card) => card.id !== 'video' || settings?.videoAnalysis !== false).map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className="fn-card"
                  disabled={card.soon || chat.busy}
                  title={card.soon ? 'Bientôt' : card.google && !googleReady ? 'À connecter dans Réglages → Google' : card.hint}
                  onClick={() => {
                    if (card.google) runGoogle(card.prompt);
                    else if (card.prompt) ask(card.prompt);
                  }}
                >
                  <card.icon className="size-4 text-cyan-200" />
                  <b>{card.label}</b>
                  <small>{card.google && !googleReady ? 'À connecter' : card.hint}</small>
                  {card.soon ? <span className="soon-tag">Bientôt</span> : null}
                </button>
              ))}
            </div>

            <section className="dash-chat" aria-label="Discussion">
              <div className="dash-chat-head">
                <MessageSquare className="size-4" />
                Discussion
                <button type="button" className="icon-btn" onClick={onNew}>
                  Nouvelle
                </button>
              </div>
              <div className="dash-chat-body">
                {bootError ? (
                  <div className="error-card m-4">{bootError}</div>
                ) : booting && chat.items.length === 0 ? (
                  <div className="dash-loading">Démarrage de Jarvis…</div>
                ) : chat.items.length === 0 ? (
                  <div className="dash-empty">
                    Aucune conversation.
                    <br />
                    Pose une question, ou choisis une fonction.
                  </div>
                ) : (
                  <Messages items={chat.items} />
                )}
              </div>
              {chat.confirmation ? (
                <ConfirmationCard confirmation={chat.confirmation} onRespond={chat.respond} />
              ) : null}
              <Composer busy={chat.busy} onSend={chat.send} onCancel={chat.cancel} />
              <VoiceBar voice={voice} voiceEnabled={settings?.voice.enabled ?? false} />
            </section>
          </>
        ) : (
          <section className="dash-panel">
            <button type="button" className="panel-back" onClick={() => setView('chat')}>
              Retour à l’accueil
            </button>
            {view === 'history' ? <HistoryPanel onOpen={onOpenConversation} /> : null}
            {view === 'audit' ? <AuditPanel /> : null}
            {view === 'settings' ? (
              booting ? (
                <div className="dash-loading">Chargement des réglages…</div>
              ) : bootError ? (
                <div className="error-card m-4">Impossible de charger les réglages : {bootError}</div>
              ) : settings && status ? (
                <SettingsPanel
                  settings={settings}
                  status={status}
                  onSaved={onSaved}
                  requestedTab={settingsTab}
                  onAnalyzeMachine={onAnalyzeMachine}
                />
              ) : (
                <div className="error-card m-4">Réglages indisponibles pour le moment.</div>
              )
            ) : null}
          </section>
        )}
        {tools.length === 0 && !booting && !bootError ? (
          <p className="sr-only">Aucun outil annoncé pour le moment.</p>
        ) : null}
      </main>

      <aside className="dash-rail">
        <section className="rail-card" aria-label="Système">
          <h2>Système</h2>
          <Metric
            label="CPU"
            value={machineValue(machine.loading, machine.error, formatPercent(machine.snapshot?.cpuPercent ?? null))}
            ratio={machine.snapshot?.cpuPercent ?? null}
            detail={
              machine.snapshot?.logicalCores
                ? `${machine.snapshot.logicalCores.toLocaleString('fr-FR')} cœurs logiques`
                : null
            }
          />
          <Metric
            label="RAM"
            value={ramValue(machine.loading, machine.error, machine.snapshot?.ramUsedBytes ?? null, machine.snapshot?.ramTotalBytes ?? null)}
            ratio={ramRatio(machine.snapshot?.ramUsedBytes ?? null, machine.snapshot?.ramTotalBytes ?? null)}
          />
          <Metric
            label="Modèle"
            value={status?.model ?? (booting ? 'chargement' : 'indisponible')}
            detail={status?.providerLabel ?? null}
          />
          <Metric
            label="Version"
            value={versionValue(machine.loading, machine.error, machine.snapshot?.version ?? null)}
          />
        </section>

        <section className="rail-card" aria-label="Micro">
          <h2>Micro</h2>
          <p className="mic-live">{micTitle(settings, voice, booting)}</p>
          <p className="metric-sub">{micDetail(settings, voice, booting)}</p>
          <p className="metric-sub">{micDevice(settings, voice)}</p>
          {settings?.voice.enabled && (voice.mic.phase === 'error' || voice.mic.phase === 'recovering') ? (
            <button type="button" className="quick-btn" onClick={voice.retryMicrophone}>
              Réessayer le micro
            </button>
          ) : null}
          {voice.state === 'listening' ? (
            <div className="meter" aria-hidden>
              <span style={{ width: `${Math.round(Math.max(0, Math.min(1, voice.level)) * 100)}%` }} />
            </div>
          ) : null}
        </section>

        <section className="rail-card" aria-label="Outils rapides">
          <h2>Outils rapides</h2>
          <div className="quick-list">
            {QUICK.map((action) => (
              <button
                key={action.id}
                type="button"
                className="quick-btn"
                disabled={action.soon || chat.busy}
                title={action.soon ? 'Bientôt' : action.google && !googleReady ? 'À connecter dans Réglages → Google' : action.label}
                onClick={() => {
                  if (action.google) runGoogle(action.prompt);
                  else if (action.prompt) ask(action.prompt);
                }}
              >
                <span className="flex items-center gap-2">
                  <action.icon className="size-3.5" />
                  {action.label}
                </span>
                {action.soon ? <span className="soon-tag">Bientôt</span> : null}
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function SideButton({
  label,
  icon: Icon,
  active = false,
  soon = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn('side-btn no-drag', active && 'is-active', soon && 'is-soon')}
      aria-label={soon ? `${label}, bientôt` : label}
      title={soon ? 'Bientôt' : label}
      disabled={soon}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {soon ? <span className="side-soon">Bientôt</span> : null}
    </button>
  );
}

function Metric({
  label,
  value,
  detail,
  ratio = null,
}: {
  label: string;
  value: string;
  detail?: string | null;
  ratio?: number | null;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      {ratio !== null && Number.isFinite(ratio) ? (
        <div className="meter" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, ratio))}%` }} />
        </div>
      ) : null}
      {detail ? <div className="metric-sub">{detail}</div> : null}
    </div>
  );
}

function machineValue(loading: boolean, error: string | null, formatted: string): string {
  if (loading) return 'chargement';
  if (error) return 'indisponible';
  return formatted;
}

function ramValue(
  loading: boolean,
  error: string | null,
  used: number | null,
  total: number | null,
): string {
  if (loading) return 'chargement';
  if (error || used === null || total === null) return 'indisponible';
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

function ramRatio(used: number | null, total: number | null): number | null {
  if (used === null || total === null || total <= 0) return null;
  return (used / total) * 100;
}

function versionValue(loading: boolean, error: string | null, version: string | null): string {
  if (loading) return 'chargement';
  if (error || !version) return 'indisponible';
  return version.startsWith('v') ? version : `v${version}`;
}

function presenceOf(
  status: RuntimeStatus | null,
  booting: boolean,
  bootError: string | null,
): { label: string; tone: string; hint: string } {
  if (bootError) {
    return { label: 'Erreur', tone: 'error', hint: 'Impossible de joindre Jarvis.' };
  }
  if (booting || !status) {
    return { label: 'Chargement', tone: 'loading', hint: 'Initialisation…' };
  }
  if (isDemoRuntime(status)) {
    return {
      label: 'Démonstration',
      tone: 'demo',
      hint: 'Mode démonstration — aucun modèle connecté.',
    };
  }
  return { label: 'En ligne', tone: 'online', hint: 'Prêt à vous assister' };
}

function micTitle(
  settings: Settings | null,
  voice: UseVoiceResult,
  booting: boolean,
): string {
  if (booting || !settings) return 'Chargement du micro…';
  if (!settings.voice.enabled) return 'Micro désactivé';
  if (voice.mic.phase === 'error') return voice.mic.failure?.title ?? 'Micro en erreur';
  if (voice.mic.phase === 'recovering') return 'Micro perdu — reprise automatique…';
  if (voice.mic.phase === 'opening') return 'Ouverture du micro…';
  if (voice.state === 'listening') return 'Micro actif';
  if (voice.state === 'speaking') return 'Jarvis parle';
  if (voice.state === 'sleeping') return 'En veille';
  return 'Micro inactif';
}

function micDetail(
  settings: Settings | null,
  voice: UseVoiceResult,
  booting: boolean,
): string {
  if (booting || !settings) return 'Lecture des réglages…';
  if (!settings.voice.enabled) return 'Active l’écoute dans les réglages pour dire « Jarvis ».';
  if (voice.micError) return voice.micError;
  if (voice.micNotice) return voice.micNotice;
  if (voice.state === 'listening') return voice.liveTranscript || 'À l’écoute…';
  if (voice.state === 'sleeping') {
    return voice.voiceError ? `Dis « Jarvis ». Hors micro : ${voice.voiceError}` : 'Dis « Jarvis »';
  }
  return 'La commande vocale est prête.';
}

/** Le périphérique réellement ouvert, pas celui qu'on croit avoir choisi. */
function micDevice(settings: Settings | null, voice: UseVoiceResult): string {
  if (!settings?.voice.enabled) return 'Périphérique : non ouvert (écoute coupée)';
  const { mic } = voice;
  if (mic.phase === 'open') {
    const opened = mic.timings.getUserMediaMs;
    return `Périphérique ouvert : ${mic.label || 'sans nom'}${opened !== undefined ? ` · ${formatSeconds(opened)}` : ''}`;
  }
  if (mic.phase === 'opening') return 'Périphérique : ouverture…';
  return `Périphérique : ${mic.preferredId ? 'micro choisi' : 'entrée par défaut de Windows'} (non ouvert)`;
}
