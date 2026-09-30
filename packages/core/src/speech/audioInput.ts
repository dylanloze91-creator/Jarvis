/**
 * Choix de l'entrée audio. Windows expose aussi des mixages (GoXLR
 * « Broadcast Stream Mix », « Mixage stéréo », « Stereo Mix »…) comme des
 * entrées. C'est souvent l'entrée déjà utilisée par les autres applications :
 * un choix enregistré, ou le défaut Windows, est ouvert tel quel.
 */

export interface AudioInputOption {
  deviceId: string;
  label: string;
}

export interface MicrophoneChoice {
  deviceId: string;
  label: string;
  /** Vrai si l'entrée retenue est un mixage. Cela n'empêche pas de l'ouvrir. */
  loopback: boolean;
}

/** Mixage / loopback. Les libellés vides ne sont pas classés. */
export function isLoopbackOrMixInput(label: string): boolean {
  const normalized = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return (
    /broadcast\s+stream\s+mix/.test(normalized) ||
    /stereo\s+mix/.test(normalized) ||
    /stereomix/.test(normalized) ||
    /what\s+u\s+hear/.test(normalized) ||
    /\bwave\s+out\b/.test(normalized) ||
    /mixage\s+stereo/.test(normalized)
  );
}

function toChoice(input: AudioInputOption): MicrophoneChoice {
  return {
    deviceId: input.deviceId,
    label: input.label,
    loopback: isLoopbackOrMixInput(input.label),
  };
}

/**
 * Entrée par défaut de Windows : l'identifiant `default` de Chromium, sinon
 * la première entrée listée. Un mixage n'est pas sauté.
 */
export function windowsDefaultInput(inputs: AudioInputOption[]): AudioInputOption | null {
  const listed = inputs.filter((input) => input.deviceId);
  const marked = listed.find((input) => input.deviceId === 'default');
  if (marked) return marked;
  return listed.find((input) => input.deviceId !== 'communications') ?? listed[0] ?? null;
}

/**
 * Entrée à ouvrir. Un identifiant enregistré qui existe encore est conservé,
 * mixage compris. Sans choix (ou si l'identifiant a disparu), c'est le défaut
 * Windows — le même périphérique que les autres applications.
 */
export function chooseMicrophone(inputs: AudioInputOption[], savedId: string): MicrophoneChoice | null {
  const listed = inputs.filter((input) => input.deviceId);
  if (listed.length === 0) return null;
  const saved = savedId ? listed.find((input) => input.deviceId === savedId) : undefined;
  if (saved) return toChoice(saved);
  const fallback = windowsDefaultInput(listed);
  return fallback ? toChoice(fallback) : null;
}

export function microphoneOptionLabel(label: string, _loopback = false): string {
  return label.trim() || 'Microphone sans nom';
}

export function loopbackInputMessage(label: string): string {
  const name = label.trim();
  const who = name ? `« ${name} »` : 'Ce périphérique';
  return `${who} est un mixage de la sortie. Jarvis l'utilise s'il est choisi ou s'il est l'entrée par défaut de Windows.`;
}

export class LoopbackInputError extends Error {
  readonly label: string;

  constructor(label: string) {
    super(loopbackInputMessage(label));
    this.name = 'LoopbackInputError';
    this.label = label;
  }
}
