import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Plus, RefreshCw, Speaker, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

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

  return (
    <div className="flex flex-col gap-4">
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

          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Ajouter une enceinte</p>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                placeholder="Nom de la pièce (Salon, Cuisine…)"
                maxLength={40}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addSpeaker();
                }}
              />
              <Button variant="default" disabled={!name.trim() || loading} onClick={addSpeaker}>
                <Plus className="size-4" />
                Ajouter
              </Button>
            </div>
          </div>

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
                  <Button size="sm" variant="danger" onClick={() => run(() => window.jarvis.speaker.remove(speaker.id))}>
                    <Trash2 className="size-3.5" />
                    Retirer
                  </Button>
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
