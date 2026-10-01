import { useCallback, useEffect, useRef, useState } from 'react';
import { Toggle } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { recordWakeTake } from '@/voice/wakeLearning/enrollment';
import { wakeLearningSession } from '@/voice/wakeLearning/session';
import type { WakeLearningStatus } from '../../../shared/ipc';

export const ENROLLMENT_TAKES = 8;
const MAX_TAKE_FAILURES = 4;

interface WakeLearningSectionProps {
  /** Valeur du brouillon (interrupteur). */
  enabled: boolean;
  /** Valeur enregistrée : l'enrôlement et l'étiquetage n'ont lieu qu'une fois l'option enregistrée. */
  savedEnabled: boolean;
  wakeWord: string;
  onChange: (wakeLearning: boolean) => void;
}

type Enrollment =
  | { phase: 'idle' }
  | { phase: 'running'; take: number; message: string | null }
  | { phase: 'done'; kept: number }
  | { phase: 'error'; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}

/** « jarvis » enregistré en minuscules → « Jarvis » à l'affichage. */
function displayWord(word: string): string {
  const trimmed = word.trim() || 'jarvis';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * « Apprendre ma voix » : la couche personnelle au-dessus de Vosk et
 * d'openWakeWord. Désactivée par défaut ; tout reste dans le dossier de
 * données de Jarvis, rien n'est envoyé.
 */
export function WakeLearningSection({ enabled, savedEnabled, wakeWord, onChange }: WakeLearningSectionProps) {
  const [status, setStatus] = useState<WakeLearningStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment>({ phase: 'idle' });
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.jarvis.wakeLearning.status());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
      wakeLearningSession.enrolling = false;
    };
  }, [refresh]);

  const enroll = async (): Promise<void> => {
    const controller = new AbortController();
    abortRef.current = controller;
    wakeLearningSession.enrolling = true;
    let kept = 0;
    let failures = 0;
    try {
      while (kept < ENROLLMENT_TAKES && !controller.signal.aborted) {
        const take = kept + 1;
        setEnrollment((current) => ({
          phase: 'running',
          take,
          message: current.phase === 'running' && current.take === take ? current.message : null,
        }));
        try {
          const clip = await recordWakeTake(controller.signal);
          if (!(await wakeLearningSession.addEnrollment(clip))) throw new Error('Modèles openWakeWord indisponibles.');
          kept += 1;
          failures = 0;
        } catch (error) {
          if (controller.signal.aborted) break;
          failures += 1;
          const message = error instanceof Error ? error.message : String(error);
          if (failures >= MAX_TAKE_FAILURES) throw new Error(message);
          setEnrollment({ phase: 'running', take, message });
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }
      }
      if (kept > 0) await window.jarvis.wakeLearning.retrain().catch(() => null);
      await wakeLearningSession.reload();
      setEnrollment(controller.signal.aborted && kept === 0 ? { phase: 'idle' } : { phase: 'done', kept });
    } catch (error) {
      setEnrollment({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      wakeLearningSession.enrolling = false;
      abortRef.current = null;
      void refresh();
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await window.jarvis.wakeLearning.clear());
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    setBusy(true);
    try {
      setStatus(await window.jarvis.wakeLearning.reset());
      await wakeLearningSession.reload();
      setConfirmReset(false);
    } finally {
      setBusy(false);
    }
  };

  const running = enrollment.phase === 'running';
  const model = status?.model ?? null;
  const stats = status?.stats;

  return (
    <section
      aria-label="Apprendre ma voix"
      className="flex flex-col gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3"
    >
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Apprendre ma voix</p>
        <p className="text-xs leading-snug text-slate-500">
          Jarvis garde de courts extraits (2 s) de tes réveils et apprend, sur ce PC, à mieux te reconnaître :
          moins de « Jarvis » ratés, moins de faux réveils. Les détecteurs Vosk et openWakeWord ne changent pas.
          Les extraits restent dans le dossier de données de Jarvis et ne sont jamais envoyés.
        </p>
      </div>

      <Toggle
        label="Apprentissage du réveil"
        hint={
          !enabled
            ? 'Désactivé : la détection reste exactement celle de la 0.4.16.'
            : savedEnabled
              ? 'Activé : chaque réveil et quasi-réveil est vérifié par ton modèle personnel.'
              : 'Enregistre les réglages pour l’activer.'
        }
        checked={enabled}
        onChange={onChange}
      />

      <div className="grid grid-cols-3 gap-2" aria-label="Statistiques des 7 derniers jours">
        <Stat label="Réveils réussis" value={stats?.successes} />
        <Stat label="« Jarvis » ratés" value={stats?.misses} />
        <Stat label="Faux réveils" value={stats?.falseWakes} />
      </div>
      <p className="-mt-1 text-[11px] text-slate-500">
        7 derniers jours{savedEnabled ? '' : ' · compté seulement quand l’apprentissage est actif'}
      </p>

      {loadError ? <p className="text-xs text-rose-300">État de l’apprentissage indisponible.</p> : null}

      <div className="flex flex-col gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-slate-200">Enrôlement (facultatif)</p>
            <p className="text-xs text-slate-500">
              {running
                ? `Prise ${enrollment.take} / ${ENROLLMENT_TAKES} : dis « ${displayWord(wakeWord)} », puis attends.`
                : enrollment.phase === 'done'
                  ? `${enrollment.kept} prise${enrollment.kept === 1 ? '' : 's'} gardée${enrollment.kept === 1 ? '' : 's'}. Le reste s’apprend à l’usage.`
                  : `Dis « ${displayWord(wakeWord)} » ${ENROLLMENT_TAKES} fois, comme d’habitude, pour démarrer plus vite.`}
            </p>
          </div>
          <Button
            size="sm"
            variant={running ? 'danger' : 'subtle'}
            disabled={!savedEnabled || busy}
            onClick={() => (running ? abortRef.current?.abort() : void enroll())}
          >
            {running ? 'Arrêter' : 'Commencer'}
          </Button>
        </div>
        {running ? (
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: ENROLLMENT_TAKES }, (_, index) => (
              <span
                key={index}
                className={`h-1 flex-1 rounded-full ${index < enrollment.take - 1 ? 'bg-accent' : index === enrollment.take - 1 ? 'animate-pulse bg-accent/60' : 'bg-white/10'}`}
              />
            ))}
          </div>
        ) : null}
        {running && enrollment.message ? <p className="text-xs text-amber-200">{enrollment.message}</p> : null}
        {enrollment.phase === 'error' ? <p className="text-xs text-rose-300">{enrollment.message}</p> : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm text-slate-200">
            {status ? `${status.clips} extrait${status.clips === 1 ? '' : 's'} · ${formatBytes(status.clipBytes)}` : 'Chargement…'}
          </p>
          <p className="text-xs text-slate-500">
            {status
              ? `Au plus ${status.maxClips} extraits et ${formatBytes(status.maxClipBytes)} ; les plus anciens partent d’abord.`
              : ' '}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" disabled={busy || running || !status?.clips} onClick={() => void clear()}>
            Effacer
          </Button>
          {confirmReset ? (
            <>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmReset(false)}>
                Annuler
              </Button>
              <Button size="sm" variant="danger" disabled={busy || running} onClick={() => void reset()}>
                Confirmer
              </Button>
            </>
          ) : (
            <Button size="sm" variant="subtle" disabled={busy || running} onClick={() => setConfirmReset(true)}>
              Réinitialiser
            </Button>
          )}
        </div>
      </div>
      <p className="-mt-1 text-[11px] leading-snug text-slate-500">
        Effacer supprime les extraits audio et garde ce qui est appris. Réinitialiser supprime tout : retour à la
        détection de base.
      </p>

      <Disclosure title="Détails du vérificateur">
        {model ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-slate-500">Entraîné le</dt>
            <dd className="text-slate-300">{new Date(model.trainedAt).toLocaleString('fr-FR')}</dd>
            <dt className="text-slate-500">Exemples</dt>
            <dd className="text-slate-300">
              {model.positives} positifs · {model.negatives} négatifs
            </dd>
            <dt className="text-slate-500">Veto des faux réveils</dt>
            <dd className="text-slate-300">
              {model.vetoEnabled ? `actif (sous ${Math.round(model.vetoThreshold * 100)} %)` : 'inactif (pas encore assez sûr)'}
            </dd>
            <dt className="text-slate-500">Rattrapage des ratés</dt>
            <dd className="text-slate-300">
              {model.rescueThreshold === null ? 'inactif' : `actif (au-dessus de ${Math.round(model.rescueThreshold * 100)} %)`}
            </dd>
            <dt className="text-slate-500">Validation croisée</dt>
            <dd className="text-slate-300">
              {Math.round(model.cvRecall * 100)} % de vrais réveils gardés · {Math.round(model.cvRejection * 100)} % de faux écartés
            </dd>
          </dl>
        ) : (
          <p className="text-xs text-slate-500">
            Pas encore de vérificateur : il faut au moins 8 réveils réussis et 8 exemples négatifs (faux réveils
            annulés, bruit de fond). {status ? `Actuellement ${status.positives} positifs, ${status.negatives} négatifs.` : ''}
          </p>
        )}
      </Disclosure>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <p className="text-lg font-semibold text-slate-100 tabular-nums">{value ?? '–'}</p>
      <p className="text-[11px] leading-tight text-slate-500">{label}</p>
    </div>
  );
}
