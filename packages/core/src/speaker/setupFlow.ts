/**
 * Déroulé « Ajouter une enceinte ». Pur : la carte et Electron sont branchés par l'appelant.
 * Une annulation ne laisse pas d'entrée en attente (l'appelant retire le jeton).
 */
import { sameFirmware } from './manifest.js';
import { failureCopy, type FailureCopy, type WifiSeen } from './provisioning.js';

export type SetupMark = 'wait' | 'ok' | 'no';

export interface SetupCheck {
  id: 'card' | 'program' | 'wifi' | 'pc' | 'voice';
  label: string;
  state: SetupMark;
}

export interface SetupView {
  checks: SetupCheck[];
  progress: number | null;
  failure: FailureCopy | null;
  done: boolean;
  /** L'écriture a été sautée : la carte avait déjà cette version. */
  skippedFlash: boolean;
}

export interface HelloCard {
  fw: string;
  mac: string;
  configured: boolean;
}

export interface ChipInfo {
  name: string;
  flashBytes: number;
}

export interface SetupIo {
  /** `hello` sur le port déjà ouvert, ou null si la carte ne parle pas encore. */
  hello(timeoutMs: number): Promise<HelloCard | null>;
  /** Lit la puce. `boot` si elle n'entre pas en programmation. */
  identifyChip(): Promise<{ ok: true; chip: ChipInfo } | { ok: false; boot: boolean }>;
  flash(onProgress: (percent: number) => void): Promise<boolean>;
  reboot(): Promise<void>;
  scan(): Promise<WifiSeen[]>;
  sendConfig(): Promise<{ ok: true } | { ok: false; error: string }>;
  test(): Promise<Array<{ step: 'wifi' | 'pc' | 'bridge' | 'voice'; ok: boolean; error?: string }>>;
  /** Oublie les réglages de la carte si l'installation a déjà été écrite. */
  forget(): Promise<void>;
}

export interface SetupInput {
  manifestVersion: string;
  /** Délais du `hello`. Les valeurs par défaut conviennent à la carte ; les tests les raccourcissent. */
  helloTimeoutMs?: number;
  helloAfterFlashMs?: number;
}

export interface SetupHooks {
  onView: (view: SetupView) => void;
  /** Après la reconnaissance (et le programme), avant les réglages. La liste vient du scan. */
  onNetworks?: (networks: WifiSeen[]) => Promise<void>;
}

export type SetupResult =
  | { ok: true; mac: string; fw: string; skippedFlash: boolean }
  | { ok: false; failure: FailureCopy; mac: string | null; failedStep?: 'wifi' | 'pc' | 'bridge' | 'voice' };

const LABELS: SetupCheck[] = [
  { id: 'card', label: 'Carte reconnue', state: 'wait' },
  { id: 'program', label: 'Programme installé', state: 'wait' },
  { id: 'wifi', label: 'Wi-Fi connecté', state: 'wait' },
  { id: 'pc', label: 'PC trouvé', state: 'wait' },
  { id: 'voice', label: 'Essai de voix', state: 'wait' },
];

function view(partial: Partial<SetupView> & { checks: SetupCheck[] }): SetupView {
  return {
    checks: partial.checks,
    progress: partial.progress ?? null,
    failure: partial.failure ?? null,
    done: partial.done ?? false,
    skippedFlash: partial.skippedFlash ?? false,
  };
}

function mark(checks: SetupCheck[], id: SetupCheck['id'], state: SetupMark): SetupCheck[] {
  return checks.map((check) => (check.id === id ? { ...check, state } : check));
}

function chipFailure(chip: ChipInfo): FailureCopy | null {
  if (chip.name !== 'ESP32-S3') {
    return { sentence: 'Cette carte n’est pas une ESP32-S3.', button: 'Réessayer' };
  }
  if (chip.flashBytes < 8 * 1024 * 1024) {
    return { sentence: 'Cette carte n’a pas assez de mémoire. Il faut 8 Mo.', button: 'Réessayer' };
  }
  return null;
}

export async function runSpeakerSetup(io: SetupIo, input: SetupInput, hooks?: SetupHooks): Promise<SetupResult> {
  let checks = LABELS.map((item) => ({ ...item }));
  let skippedFlash = false;
  let mac: string | null = null;
  let fw = '';
  const show = (next: SetupView): void => hooks?.onView(next);

  const fail = async (failure: FailureCopy, forgetCard: boolean): Promise<SetupResult> => {
    if (forgetCard) await io.forget().catch(() => undefined);
    show(view({ checks, failure, skippedFlash }));
    return { ok: false, failure, mac };
  };

  show(view({ checks }));
  const already = await io.hello(input.helloTimeoutMs ?? 1500);
  if (already && sameFirmware(already.fw, input.manifestVersion)) {
    mac = already.mac;
    fw = already.fw;
    skippedFlash = true;
    checks = mark(mark(checks, 'card', 'ok'), 'program', 'ok');
    show(view({ checks, skippedFlash }));
  } else {
    const chip = await io.identifyChip();
    if (!chip.ok) {
      checks = mark(checks, 'card', 'no');
      return fail(
        chip.boot
          ? { sentence: 'Maintiens BOOT, appuie sur RESET, puis relâche BOOT.', button: 'Réessayer' }
          : { sentence: 'Je n’arrive pas à lire la carte.', button: 'Réessayer' },
        false,
      );
    }
    const refused = chipFailure(chip.chip);
    if (refused) {
      checks = mark(checks, 'card', 'no');
      return fail(refused, false);
    }
    checks = mark(checks, 'card', 'ok');
    show(view({ checks, progress: 0 }));
    const flashed = await io.flash((percent) => {
      show(view({ checks, progress: percent, skippedFlash }));
    });
    if (!flashed) {
      checks = mark(checks, 'program', 'no');
      return fail({ sentence: 'L’écriture du programme s’est arrêtée.', button: 'Réessayer' }, false);
    }
    checks = mark(checks, 'program', 'ok');
    show(view({ checks, progress: 100 }));
    await io.reboot();
    const hello = await io.hello(input.helloAfterFlashMs ?? 8000);
    if (!hello) {
      return fail({ sentence: 'La carte ne répond pas après l’installation.', button: 'Réessayer' }, false);
    }
    mac = hello.mac;
    fw = hello.fw;
  }

  const networks = await io.scan();
  await hooks?.onNetworks?.(networks);
  const sent = await io.sendConfig();
  if (!sent.ok) {
    return fail(failureCopy(sent.error), true);
  }
  const steps = await io.test();
  for (const step of steps) {
    const id = step.step === 'wifi' ? 'wifi' : step.step === 'voice' ? 'voice' : 'pc';
    checks = mark(checks, id, step.ok ? 'ok' : 'no');
    show(view({ checks, skippedFlash }));
    if (!step.ok) {
      const outcome = await fail(failureCopy(step.error), true);
      return outcome.ok ? outcome : { ...outcome, failedStep: step.step };
    }
  }
  if (!steps.some((step) => step.step === 'voice' && step.ok)) {
    return fail(failureCopy('timeout'), true);
  }
  show(view({ checks, done: true, skippedFlash }));
  return { ok: true, mac: mac ?? '', fw, skippedFlash };
}

export function replacePrompt(existingName: string): string {
  return `Remplacer l’enceinte ${existingName}`;
}
