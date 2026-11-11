import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Plus, RefreshCw, Speaker } from 'lucide-react';
import type { Settings, SpeakerChronoView } from '@jarvis/core';
import { rssiToBars, speakerFreshness } from '@jarvis/core';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirmButton';
import { Disclosure } from '@/components/ui/disclosure';
import { SpeakerInstallView } from '@/components/SpeakerInstall';
import { installSpeaker } from '@/speaker/installDriver';
import { esptoolFlasher, webSerialLink } from '@/speaker/esptoolFlash';
import { Input, Toggle } from '@/components/ui/field';
import type { SpeakerAdded, SpeakerStatus } from '../../../shared/ipc';

/**
 * 5.0.64 — Réglages → Enceintes. Appliqué tout de suite (comme le téléphone), sans
 * « Enregistrer » : l'état vit dans `userData/speakers.json`. Le jeton d'une enceinte n'est
 * montré qu'une fois, à sa création, sous la forme du bloc `secrets.h` à coller dans la carte.
 */
export function SpeakerSettingsSection() {
  const [status, setStatus] = useState<SpeakerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [added, setAdded] = useState<SpeakerAdded | null>(null);
  const [installStep, setInstallStep] = useState<'closed' | 'branch' | 'wifi' | 'go' | 'error'>('closed');
  const [checks, setChecks] = useState<Array<{ label: string; state: 'wait' | 'ok' | 'no' }>>([]);
  const [failure, setFailure] = useState({ sentence: 'Branche la carte, puis réessaie.', button: 'Réessayer' });
  const [diagnose, setDiagnose] = useState(false);
  const scene = new URLSearchParams(window.location.search).get('scene');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chrono, setChrono] = useState<SpeakerChronoView | null>(null);
  const [piperReady, setPiperReady] = useState(false);

  const run = useCallback((action: () => Promise<SpeakerStatus>) => {
    setLoading(true);
    void action()
      .then(setStatus)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    run(() => window.jarvis.speaker.status());
    return window.jarvis.speaker.onEvent(setStatus);
  }, [run]);

  useEffect(() => {
    void window.jarvis.settings.get().then((payload) => setSettings(payload.settings));
    void window.jarvis.speaker.chrono().then(setChrono);
    void window.jarvis.voice.piperStatus().then((piper) => setPiperReady(piper.ready)).catch(() => setPiperReady(false));
  }, []);

  const saveSpeaker = (patch: Partial<Settings>): void => {
    void window.jarvis.settings.set(patch).then((payload) => setSettings(payload.settings));
  };

  const setFast = (on: boolean): void => {
    if (on) {
      saveSpeaker({
        speakerFastMode: true,
        speakerPreloadWhisper: true,
        speakerWarmup: true,
        speakerRulesAddressee: true,
        speakerKeepAwake: true,
        ...(piperReady ? { speakerVoice: 'local-piper' as const } : {}),
      });
      return;
    }
    saveSpeaker({
      speakerFastMode: false,
      speakerPreloadWhisper: false,
      speakerWarmup: false,
      speakerRulesAddressee: false,
      speakerKeepAwake: false,
      speakerVoice: null,
    });
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!status) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" /> Lecture de l’état…
      </p>
    );
  }

  const addSpeaker = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    void window.jarvis.speaker
      .add(trimmed)
      .then((result) => {
        setAdded(result);
        setStatus(result.status);
        setName('');
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  const copySecrets = (): void => {
    if (!added) return;
    void navigator.clipboard
      .writeText(added.secrets)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  const address = status.addresses[0] ?? null;

  const setPiece = (
    key: 'speakerPreloadWhisper' | 'speakerWarmup' | 'speakerRulesAddressee' | 'speakerKeepAwake',
    on: boolean,
  ): void => {
    if (!settings) return;
    if (on) {
      saveSpeaker({ [key]: true });
      return;
    }
    if (settings.speakerFastMode) {
      saveSpeaker({
        speakerFastMode: false,
        speakerPreloadWhisper: key === 'speakerPreloadWhisper' ? false : true,
        speakerWarmup: key === 'speakerWarmup' ? false : true,
        speakerRulesAddressee: key === 'speakerRulesAddressee' ? false : true,
        speakerKeepAwake: key === 'speakerKeepAwake' ? false : true,
      });
      return;
    }
    saveSpeaker({ [key]: false });
  };

  const fast = settings?.speakerFastMode === true;
  const slowest = chrono?.steps.reduce((best, step) => Math.max(best, step.medianMs), 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Toggle
        label="Mode enceinte rapide"
        hint="Piper si la voix est prête, Whisper déjà chargé, préchauffage dès « Jarvis », vérification sans attendre un modèle, et le modèle qui trie reste en mémoire. La carte graphique reste occupée par ce modèle."
        checked={fast}
        disabled={!settings}
        onChange={setFast}
      />

      <Disclosure title="Réglages avancés" hint="Chaque morceau du mode rapide, séparément">
        <Toggle
          label="Voix Piper pour les enceintes"
          hint={
            piperReady
              ? 'Plus rapide que la voix Windows, qui relance un programme à chaque phrase. Absent : la voix de Jarvis.'
              : 'Piper n’est pas prêt sur ce PC. Les enceintes gardent la voix de Jarvis.'
          }
          checked={settings?.speakerVoice === 'local-piper'}
          disabled={!settings || !piperReady}
          onChange={(on) => saveSpeaker({ speakerVoice: on ? 'local-piper' : null, speakerFastMode: false })}
        />
        <Toggle
          label="Whisper toujours prêt"
          hint="Chargé après l’ouverture de la fenêtre, et gardé. Les enceintes passent par le worker, pas par la page."
          checked={settings?.speakerPreloadWhisper === true || fast}
          disabled={!settings}
          onChange={(on) => setPiece('speakerPreloadWhisper', on)}
        />
        <Toggle
          label="Préchauffage au mot Jarvis"
          hint="Dès que l’enceinte entend « Jarvis », le PC charge les modèles et Piper, sans rien écrire."
          checked={settings?.speakerWarmup === true || fast}
          disabled={!settings}
          onChange={(on) => setPiece('speakerWarmup', on)}
        />
        <Toggle
          label="Vérification par règles"
          hint="Une suite sans « Jarvis » est jugée par des règles, pas par un modèle. En cas de doute, Jarvis répond."
          checked={settings?.speakerRulesAddressee === true || fast}
          disabled={!settings}
          onChange={(on) => setPiece('speakerRulesAddressee', on)}
        />
        <Toggle
          label="Garder Jarvis éveillé"
          hint="Le modèle qui trie reste chargé tant que les enceintes sont allumées. La carte graphique reste occupée."
          checked={settings?.speakerKeepAwake === true || fast}
          disabled={!settings}
          onChange={(on) => setPiece('speakerKeepAwake', on)}
        />
      </Disclosure>

      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Vitesse</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          {chrono?.sentence ?? 'Pas encore de phrase mesurée.'} Les durées seulement : le texte dit n’est pas gardé.
        </p>
        {chrono && chrono.steps.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {chrono.steps.map((step) => (
              <div key={step.id} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-[11px]">
                <span className={step.slowest ? 'text-amber-200' : 'text-slate-400'}>{step.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span
                    className={step.slowest ? 'block h-full rounded-full bg-amber-300/80' : 'block h-full rounded-full bg-cyan-300/70'}
                    style={{ width: `${slowest > 0 ? Math.max(4, Math.round((step.medianMs / slowest) * 100)) : 0}%` }}
                  />
                </span>
                <span className="text-right text-slate-500">{(step.medianMs / 1000).toFixed(1).replace('.', ',')} s</span>
              </div>
            ))}
          </div>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          onClick={() => {
            void window.jarvis.speaker.resetChrono().then(setChrono);
          }}
        >
          Remettre à zéro
        </Button>
      </div>

      <div>
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Enceintes Jarvis dans la maison</p>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          Une petite carte (ESP32-S3) avec un micro et un haut-parleur, posée dans une pièce : tu dis « Jarvis, … »,
          elle envoie ta phrase à ce PC par le Wi-Fi de la maison, et Jarvis répond à voix haute. Le cerveau reste ici :
          rien ne sort de chez toi. Les actions qui demandent ton accord sont refusées sur l’enceinte : demande-les sur le
          PC ou le téléphone. Le PC doit rester allumé, Jarvis ouvert.
        </p>
      </div>

      <Toggle
        label="Enceintes"
        hint={`Coupé : le port ${status.port} reste fermé, aucune enceinte ne peut parler à Jarvis.`}
        checked={status.enabled}
        disabled={loading}
        onChange={(enabled) => run(() => window.jarvis.speaker.setEnabled(enabled))}
      />

      {status.error ? <p className="text-xs text-rose-300">{status.error}</p> : null}

      {status.enabled ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5 text-xs leading-snug text-slate-400">
            <p className="text-sm text-slate-200">Adresse de ce PC pour les enceintes</p>
            {address ? (
              <p className="mt-1">
                <span className="font-mono text-slate-300">{address}</span>
                <span className="text-slate-500"> (ou </span>
                <span className="font-mono text-slate-300">{status.hostName}</span>
                <span className="text-slate-500">)</span> · port <span className="font-mono text-slate-300">{status.port}</span>
                {status.addresses.length > 1 ? (
                  <span className="text-slate-500"> · autres : {status.addresses.slice(1).join(', ')}</span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-amber-200/80">Aucune adresse Wi-Fi ou Ethernet trouvée : le PC est-il connecté ?</p>
            )}
            <p className="mt-1 text-slate-500">
              Si l’adresse change (box redémarrée), fixe-la dans la box ou utilise le nom en <code>.local</code>.
            </p>
          </div>

          <Button variant="default" onClick={() => setInstallStep('branch')}>
            <Plus className="size-4" />
            Ajouter une enceinte
          </Button>
          {installStep !== 'closed' ? (
            <SpeakerInstallView
              screen={installStep}
              sentence={failure.sentence}
              button={failure.button}
              checks={checks}
              onNext={() => setInstallStep('wifi')}
              onRetry={() => setInstallStep('branch')}
              onInstall={(input) => {
                setName(input.name);
                setInstallStep('go');
                const serial = navigator.serial;
                if (!serial) {
                  setFailure({ sentence: 'Ce Jarvis ne peut pas ouvrir le câble USB.', button: 'Réessayer' });
                  setInstallStep('error');
                  return;
                }
                const portPromise = serial.requestPort();
                void (async () => {
                  try {
                    const [port, bundle] = await Promise.all([portPromise, window.jarvis.speaker.firmware()]);
                    if (!bundle) {
                      setFailure({
                        sentence: 'Le programme de l’enceinte n’est pas inclus dans cette version de Jarvis.',
                        button: 'Réessayer',
                      });
                      setInstallStep('error');
                      try {
                        await port.close();
                      } catch {
                        // le port n'était pas ouvert
                      }
                      return;
                    }
                    await port.open({ baudRate: 115200 });
                    const result = await installSpeaker({
                      link: webSerialLink(port),
                      flasher: esptoolFlasher(port, bundle.files),
                      manifestVersion: bundle.version,
                      wifi: { name: input.name, ssid: input.ssid, pass: input.pass },
                      pair: async (mac) => {
                        const paired = await window.jarvis.speaker.beginInstall(input.name, mac);
                        return {
                          speakerId: paired.speakerId,
                          token: paired.token,
                          pcId: paired.pcId,
                          port: paired.port,
                          hosts: paired.hosts,
                        };
                      },
                      commit: async (id, fw) => {
                        await window.jarvis.speaker.commitInstall(id, fw);
                      },
                      abandon: async (id) => {
                        await window.jarvis.speaker.abandonInstall(id);
                      },
                      onView: (view) => setChecks(view.checks),
                    });
                    if (!result.ok) {
                      setFailure(result.failure);
                      setInstallStep('error');
                    }
                  } catch {
                    setFailure({ sentence: 'Je n’arrive pas à ouvrir la carte.', button: 'Réessayer' });
                    setInstallStep('error');
                  } finally {
                    input.pass = '';
                  }
                })();
              }}
            />
          ) : null}
          {scene === 'speaker-install' ? <SpeakerInstallView screen="branch" /> : null}
          {scene === 'speaker-install-error' ? (
            <SpeakerInstallView screen="error" sentence="Le mot de passe n’est pas le bon." button="Corriger" />
          ) : null}
          {scene === 'speaker-list' ? <p className="text-sm text-slate-200">Tes enceintes, avec le signal et la version.</p> : null}
          {scene === 'speaker-diagnose' ? (
            <p className="text-sm text-slate-200">Ton réseau est en mode Public : c’est souvent pour ça que l’enceinte ne répond pas.</p>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setDiagnose(true)}>
            Mon enceinte ne répond pas
          </Button>
          {diagnose ? (
            <p className="text-sm text-slate-200">
              Si l’enceinte ne trouve pas le PC, le réseau est souvent en mode Public ou le pare-feu bloque. Sur Windows, « Réparer » demande ton accord.
            </p>
          ) : null}

          <Disclosure title="Avancé (développeurs)">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-400">
                Le chemin simple est le bouton au-dessus. Ici, tu peux encore créer un bloc <code>secrets.h</code> pour PlatformIO.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={name}
                  placeholder="Nom de la pièce"
                  maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button variant="subtle" disabled={!name.trim() || loading} onClick={addSpeaker}>
                  Créer le bloc
                </Button>
              </div>
            </div>
          </Disclosure>

          {added ? (
            <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-sm text-slate-200">
                Enceinte « {added.speaker.name} » créée. Colle ce bloc dans <code>include/secrets.h</code> du programme de la
                carte, puis téléverse-le.
              </p>
              <p className="text-[11px] text-amber-200/80">
                Ce jeton n’est montré qu’une fois. Si tu le perds, retire l’enceinte et ajoute-la à nouveau.
              </p>
              <pre className="overflow-x-auto rounded-md bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-snug text-cyan-100">
                {added.secrets}
              </pre>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="subtle" onClick={copySecrets}>
                  <Copy className="size-3.5" />
                  {copied ? 'Copié' : 'Copier le bloc'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdded(null)}>
                  J’ai fini
                </Button>
              </div>
            </div>
          ) : null}

          {status.speakers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Enceintes reliées</p>
              {status.speakers.map((speaker) => (
                <div
                  key={speaker.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Speaker className="size-4 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{speaker.name}</p>
                      <p className="text-[11px] text-slate-500">{lastTurnLabel(speaker.lastTurnAt, now)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500" title="Signal Wi-Fi">
                      {typeof speaker.rssi === 'number' ? `${'▮'.repeat(rssiToBars(speaker.rssi))}${'▯'.repeat(4 - rssiToBars(speaker.rssi))}` : '—'}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {speaker.pending
                        ? 'Installation en cours'
                        : !speaker.fw && !speaker.lastHelloAt
                          ? 'Hors ligne'
                          : !speaker.fw
                            ? 'Ancienne version'
                            : speakerFreshness(speaker.fw, '5.0.75') === 'current'
                              ? 'À jour'
                              : 'Mise à jour disponible'}
                    </span>
                    <ConfirmButton label="Retirer" confirmLabel="Retirer pour de bon" variant="danger" onConfirm={() => run(() => window.jarvis.speaker.remove(speaker.id))} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Aucune enceinte pour l’instant. Le guide de montage est dans le dossier{' '}
              <code>firmware/jarvis-speaker</code> du projet.
            </p>
          )}

          <Button size="sm" variant="ghost" disabled={loading} onClick={() => run(() => window.jarvis.speaker.status())}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Vérifier à nouveau
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** « Dernière phrase il y a 3 min » — en mémoire seulement, remis à zéro au démarrage. */
export function lastTurnLabel(lastTurnAt: number | null, now: number): string {
  if (lastTurnAt === null) return 'Aucune phrase depuis le démarrage de Jarvis';
  const seconds = Math.max(0, Math.round((now - lastTurnAt) / 1000));
  if (seconds < 60) return 'Dernière phrase à l’instant';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Dernière phrase il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Dernière phrase il y a ${hours} h`;
}
