/**
 * Choix du micro. Windows expose aussi des mixages de sortie (GoXLR
 * « Broadcast Stream Mix », « Mixage stéréo », « Stereo Mix »…) comme des
 * entrées. Ce ne sont pas des micros : y écouter mélange la musique et le
 * bureau, souvent déjà saturés.
 */

export interface AudioInputOption {
  deviceId: string;
  label: string;
}

export interface MicrophoneChoice {
  deviceId: string;
  label: string;
  /** Vrai seulement s'il n'existe aucun vrai micro : l'entrée retenue est un mixage. */
  loopback: boolean;
}

/** Mixage / loopback, pas une capsule. Les libellés vides ne sont pas classés. */
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

/**
 * Micro à ouvrir. Un identifiant enregistré qui pointe encore un vrai micro
 * est conservé. Un mixage enregistré ou le défaut Windows est écarté dès
 * qu'un autre micro existe.
 */
export function chooseMicrophone(inputs: AudioInputOption[], savedId: string): MicrophoneChoice | null {
  const real = inputs.filter((input) => input.deviceId && !isLoopbackOrMixInput(input.label));
  const saved = inputs.find((input) => input.deviceId === savedId);
  if (saved && !isLoopbackOrMixInput(saved.label)) {
    return { deviceId: saved.deviceId, label: saved.label, loopback: false };
  }
  const preferred = real[0];
  if (preferred) return { deviceId: preferred.deviceId, label: preferred.label, loopback: false };
  const fallback = saved ?? inputs.find((input) => input.deviceId);
  if (!fallback) return null;
  return {
    deviceId: fallback.deviceId,
    label: fallback.label,
    loopback: isLoopbackOrMixInput(fallback.label),
  };
}

export function microphoneOptionLabel(label: string, loopback: boolean): string {
  const name = label.trim() || 'Microphone sans nom';
  return loopback ? `${name} — mixage, pas un micro` : name;
}

export function loopbackInputMessage(label: string): string {
  const name = label.trim();
  const who = name ? `« ${name} »` : 'Ce périphérique';
  return `${who} est un mixage de la sortie (musique et bureau compris), pas un microphone. Choisis un vrai micro dans la liste.`;
}

export class LoopbackInputError extends Error {
  readonly label: string;

  constructor(label: string) {
    super(loopbackInputMessage(label));
    this.name = 'LoopbackInputError';
    this.label = label;
  }
}
