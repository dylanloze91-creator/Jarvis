/**
 * Ouverture du micro : décisions pures (contraintes, choix de l'entrée,
 * messages d'erreur, journal). Le code DOM (`getUserMedia`, Web Audio) vit
 * dans `apps/desktop` ; ici, rien que des données testables sans micro.
 */
import type { AudioInputOption } from './audioInput.js';

/** Étape où la capture a échoué. */
export type CaptureStep =
  | 'permission'
  | 'enumerate'
  | 'getUserMedia'
  | 'audio-graph'
  | 'first-frame'
  | 'device-lost';

export interface CaptureFailure {
  /** Nom exact de l'erreur (`NotAllowedError`, `NotReadableError`…). Toujours affiché. */
  name: string;
  /** Message technique d'origine, tel que Chromium le donne (souvent en anglais). */
  message: string;
  step: CaptureStep;
  /** Titre court, en français. */
  title: string;
  /** Prochaine étape pour l'utilisateur, en français. */
  action: string;
  /** Vrai si le réglage « Confidentialité > Microphone » de Windows est la piste. */
  privacySettings: boolean;
}

/** Nom de nos propres erreurs (pas des `DOMException` de Chromium). */
export const CAPTURE_TIMEOUT_ERROR = 'TimeoutError';
export const CAPTURE_NO_AUDIO_ERROR = 'NoAudioError';
export const CAPTURE_DEVICE_LOST_ERROR = 'DeviceLostError';
export const CAPTURE_UNSUPPORTED_ERROR = 'UnsupportedError';

const PRIVACY_PATH =
  'Paramètres Windows > Confidentialité et sécurité > Microphone : active « Accès au microphone » et « Autoriser les applications de bureau à accéder à votre microphone »';

function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Error';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').trim();
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message.replace(/\s+/g, ' ').trim();
  return String(error ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Erreur de capture → titre, cause exacte et prochaine étape. Le nom de
 * l'erreur n'est jamais remplacé par un libellé générique.
 */
export function describeCaptureFailure(
  error: unknown,
  step: CaptureStep,
  deviceLabel = '',
): CaptureFailure {
  const name = errorName(error);
  const message = errorMessage(error);
  const device = deviceLabel.trim() ? `« ${deviceLabel.trim()} »` : 'ce micro';
  const base = { name, message, step };

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      if (/system/i.test(message)) {
        return {
          ...base,
          title: 'Windows bloque le micro pour Jarvis',
          action: `${PRIVACY_PATH}, puis clique « Réessayer ».`,
          privacySettings: true,
        };
      }
      return {
        ...base,
        title: 'Accès au micro refusé',
        action: `Vérifie ${PRIVACY_PATH}. Puis clique « Réessayer ».`,
        privacySettings: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        ...base,
        title: 'Aucune entrée audio trouvée',
        action:
          'Branche le micro (ou démarre le logiciel GoXLR), vérifie qu’il est activé dans Paramètres > Système > Son > Entrée, puis clique « Réessayer ».',
        privacySettings: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        ...base,
        title: 'Le micro choisi n’existe plus',
        action: 'Choisis un autre micro dans la liste, ou « Entrée par défaut de Windows ».',
        privacySettings: false,
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        ...base,
        title: `Windows n’a pas pu démarrer ${device}`,
        action:
          'Une autre application le tient peut-être en mode exclusif : Panneau de configuration Son > Enregistrement > ce micro > Propriétés > Avancé, décoche « Autoriser les applications à prendre le contrôle exclusif ». Sinon débranche et rebranche le micro, ou choisis-en un autre.',
        privacySettings: false,
      };
    case CAPTURE_TIMEOUT_ERROR:
      return {
        ...base,
        title: `Windows ne répond pas pour ${device}`,
        action:
          'Le pilote met trop de temps à ouvrir ce périphérique. Choisis un autre micro, ou redémarre le logiciel du périphérique (GoXLR), puis clique « Réessayer ».',
        privacySettings: false,
      };
    case CAPTURE_NO_AUDIO_ERROR:
      return {
        ...base,
        title: `${device.charAt(0).toUpperCase()}${device.slice(1)} est ouvert mais n’envoie aucun son`,
        action:
          'Vérifie qu’il n’est pas coupé (mute) et que son niveau bouge dans Paramètres > Système > Son > Entrée, ou choisis un autre micro.',
        privacySettings: false,
      };
    case CAPTURE_DEVICE_LOST_ERROR:
      return {
        ...base,
        title: 'Le micro s’est arrêté',
        action:
          'Débranché, mis en veille ou pilote redémarré. Jarvis le rouvre tout seul dès qu’il revient ; « Réessayer » force une reprise.',
        privacySettings: false,
      };
    case CAPTURE_UNSUPPORTED_ERROR:
      return {
        ...base,
        title: 'Capture audio indisponible dans cette fenêtre',
        action: 'Relance Jarvis. Si ça continue, réinstalle-le.',
        privacySettings: false,
      };
    case 'TypeError':
      return {
        ...base,
        title: 'Réglages du micro refusés par Chromium',
        action: 'Choisis « Entrée par défaut de Windows », puis clique « Réessayer ».',
        privacySettings: false,
      };
    default:
      return {
        ...base,
        title: 'Le micro ne s’ouvre pas',
        action: 'Clique « Réessayer ». Si ça continue, lance « Tester la voix » et copie le détail.',
        privacySettings: false,
      };
  }
}

/** Une ligne : titre, nom exact de l'erreur et son message, puis la prochaine étape. */
export function captureFailureText(failure: CaptureFailure): string {
  const cause = failure.message ? `${failure.name} : ${failure.message}` : failure.name;
  return `${failure.title} (${cause}). ${failure.action}`;
}

export function captureFailureCause(failure: CaptureFailure): string {
  return failure.message ? `${failure.name} : ${failure.message}` : failure.name;
}

/** Identifiants virtuels de Chromium sous Windows. */
export const DEFAULT_INPUT_ID = 'default';
export const COMMUNICATIONS_INPUT_ID = 'communications';

/** `''` et `default` désignent tous deux l'entrée par défaut de Windows. */
export function isSystemDefaultInput(deviceId: string): boolean {
  return deviceId === '' || deviceId === DEFAULT_INPUT_ID;
}

/**
 * Contraintes `getUserMedia`. Aucun traitement WebRTC : l'annulation d'écho,
 * la réduction de bruit et surtout le contrôle de gain (qui, sous Windows,
 * modifie le volume d'entrée du périphérique pour toutes les applications)
 * sont coupés. openWakeWord et Whisper attendent le signal brut. L'entrée
 * par défaut est demandée sans `deviceId` : Chromium ouvre celle de Windows.
 * Un choix explicite est `exact` : jamais un autre micro en silence.
 */
export function captureConstraints(deviceId: string): MediaTrackConstraintsLike {
  const raw: MediaTrackConstraintsLike = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 1 },
  };
  if (isSystemDefaultInput(deviceId)) return raw;
  return { ...raw, deviceId: { exact: deviceId } };
}

/** Sous-ensemble de `MediaTrackConstraints` (le core n'a pas les types DOM). */
export interface MediaTrackConstraintsLike {
  deviceId?: { exact: string };
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  channelCount: { ideal: number };
}

export interface CaptureTarget {
  /** `''` = entrée par défaut de Windows. */
  deviceId: string;
  /** Vrai si le micro enregistré est absent et qu'on se replie sur le défaut. */
  fallback: boolean;
}

/**
 * Entrée à ouvrir. Un choix enregistré présent dans la liste est ouvert tel
 * quel. S'il a disparu, l'entrée par défaut de Windows prend le relais (et
 * le choix est repris quand il revient). Sans liste lisible (identifiants
 * vides avant autorisation), on tente l'identifiant enregistré.
 */
export function resolveCaptureTarget(inputs: AudioInputOption[], preferredId: string): CaptureTarget {
  if (isSystemDefaultInput(preferredId)) return { deviceId: '', fallback: false };
  const listed = inputs.filter((input) => input.deviceId);
  if (listed.length === 0) return { deviceId: preferredId, fallback: false };
  if (listed.some((input) => input.deviceId === preferredId)) {
    return { deviceId: preferredId, fallback: false };
  }
  return { deviceId: '', fallback: true };
}

/** Faut-il réessayer l'entrée par défaut après cet échec sur un choix explicite ? */
export function shouldFallbackToDefault(errorNameValue: string, deviceId: string): boolean {
  if (isSystemDefaultInput(deviceId)) return false;
  return errorNameValue === 'OverconstrainedError' || errorNameValue === 'NotFoundError';
}

export type DeviceChangeAction = 'none' | 'retry' | 'reopen' | 'return-to-preferred';

/**
 * Réaction à `devicechange`. `retry` : on était en échec ou en reprise ;
 * `reopen` : le périphérique ouvert a disparu de la liste ; `return-to-preferred` :
 * le micro choisi est revenu alors qu'on écoutait le défaut.
 */
export function actionOnDeviceChange(input: {
  phase: 'off' | 'opening' | 'open' | 'recovering' | 'error';
  inputs: AudioInputOption[];
  preferredId: string;
  openedId: string;
  openedLabel?: string;
  usingFallback: boolean;
}): DeviceChangeAction {
  if (input.phase === 'off' || input.phase === 'opening') return 'none';
  if (input.phase === 'error' || input.phase === 'recovering') return 'retry';
  const ids = input.inputs.map((device) => device.deviceId).filter(Boolean);
  if (ids.length === 0) return 'none';
  if (input.usingFallback && !isSystemDefaultInput(input.preferredId) && ids.includes(input.preferredId)) {
    return 'return-to-preferred';
  }
  if (input.openedId && !isSystemDefaultInput(input.openedId) && !ids.includes(input.openedId)) {
    return 'reopen';
  }
  if (isSystemDefaultInput(input.preferredId) && input.openedLabel) {
    const current = input.inputs.find((device) => device.deviceId === DEFAULT_INPUT_ID)?.label ?? '';
    const now = withoutDefaultPrefix(current);
    const opened = withoutDefaultPrefix(input.openedLabel);
    if (now && opened && now !== opened) return 'reopen';
  }
  return 'none';
}

/** « Default - Micro (X) » / « Par défaut - Micro (X) » → « Micro (X) ». */
export function withoutDefaultPrefix(label: string): string {
  return label.replace(/^[^-]{1,24}\s-\s/, '').trim();
}

/** Délai avant la n-ième reprise automatique (0 = première). */
export function recoveryDelayMs(attempt: number): number {
  const steps = [300, 1_000, 2_000, 5_000, 10_000];
  return steps[Math.min(Math.max(0, attempt), steps.length - 1)]!;
}

/**
 * Identifiant de périphérique pour le journal : Chromium le dérive d'un sel
 * propre au profil ; il n'a rien à faire en clair dans un fichier copié.
 */
export function redactDeviceId(deviceId: string): string {
  if (deviceId === '') return 'défaut Windows';
  if (deviceId === DEFAULT_INPUT_ID || deviceId === COMMUNICATIONS_INPUT_ID) return deviceId;
  return `${deviceId.slice(0, 6)}…`;
}

export interface CaptureTimings {
  /** État de `navigator.permissions` (`granted`, `denied`, `prompt`, `inconnu`). */
  permission?: string;
  permissionMs?: number;
  enumerateMs?: number;
  inputCount?: number;
  getUserMediaMs?: number;
  graphMs?: number;
  /** Depuis le début de l'ouverture. */
  firstFrameMs?: number;
  /** Depuis le début de l'ouverture. */
  firstWakeScoreMs?: number;
}

function ms(value: number | undefined): string | null {
  return value === undefined ? null : `${Math.round(value)} ms`;
}

/** Une ligne lisible : chaque étape et sa durée. */
export function formatCaptureTimings(timings: CaptureTimings): string {
  const parts = [
    timings.permission !== undefined
      ? `autorisation ${timings.permission}${timings.permissionMs !== undefined ? ` (${ms(timings.permissionMs)})` : ''}`
      : null,
    timings.enumerateMs !== undefined
      ? `liste ${ms(timings.enumerateMs)}${timings.inputCount !== undefined ? ` (${timings.inputCount} entrées)` : ''}`
      : null,
    timings.getUserMediaMs !== undefined ? `getUserMedia ${ms(timings.getUserMediaMs)}` : null,
    timings.graphMs !== undefined ? `Web Audio ${ms(timings.graphMs)}` : null,
    timings.firstFrameMs !== undefined ? `1re trame ${ms(timings.firstFrameMs)}` : null,
    timings.firstWakeScoreMs !== undefined ? `1er score réveil ${ms(timings.firstWakeScoreMs)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(' · ');
}

/** Durée lisible : « 36 ms » sous la seconde, « 1,2 s » au-delà. */
export function formatSeconds(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))} ms`;
  return `${(milliseconds / 1000).toFixed(1).replace('.', ',')} s`;
}
