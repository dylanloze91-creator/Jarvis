type VoiceBarState = 'idle' | 'sleeping' | 'listening' | 'speaking' | 'error';
type MicPhase = 'off' | 'opening' | 'open' | 'recovering' | 'error';

export const VOICE_BAR_STATE_LABEL: Record<VoiceBarState, string> = {
  idle: 'Commande vocale désactivée',
  sleeping: 'En veille — dis « Jarvis »',
  listening: 'À l’écoute…',
  speaking: 'Jarvis parle…',
  error: 'Micro en erreur',
};

export const MIC_OPENING_LABEL = 'Ouverture du micro…';
export const MIC_RECOVERING_LABEL = 'Micro perdu — reprise automatique…';

const ERROR_TEXT = /indisponible|erreur|error_code|n['’]a pas pu|ne s['’]est pas chargé|bloqué|codes \d|réinstalle|tester la voix|introuvable|refusé|Error\b/i;

/**
 * En veille, ne jamais remplacer le prompt « dis Jarvis » par un message
 * d'erreur (Whisper / openWakeWord / synthèse) : l'erreur passe en détail.
 * Seul un échec du micro lui-même devient la ligne principale, avec le nom
 * exact de l'erreur. Pendant l'écoute, la ligne montre la transcription en
 * cours et n'hérite pas en rouge d'une ancienne erreur.
 */
export function voiceBarStatusLines(input: {
  state: VoiceBarState;
  micPhase?: MicPhase;
  /** Échec du micro (déjà complet : titre, nom de l'erreur, prochaine étape). */
  micError: string | null;
  micNotice?: string | null;
  voiceError?: string | null;
  whisperStatus: string | null;
  liveTranscript: string;
}): { primary: string; primaryIsError: boolean; detail: string | null; detailIsError: boolean } {
  const voiceError = input.voiceError ?? null;
  if (input.state === 'error') {
    return {
      primary: input.micError ?? VOICE_BAR_STATE_LABEL.error,
      primaryIsError: true,
      detail: null,
      detailIsError: false,
    };
  }
  if (input.state === 'sleeping') {
    if (input.micPhase === 'opening') {
      return { primary: MIC_OPENING_LABEL, primaryIsError: false, detail: null, detailIsError: false };
    }
    if (input.micPhase === 'recovering') {
      return {
        primary: MIC_RECOVERING_LABEL,
        primaryIsError: false,
        detail: input.micError,
        detailIsError: Boolean(input.micError),
      };
    }
    const detail = input.micError ?? input.micNotice ?? voiceError ?? input.whisperStatus ?? null;
    return {
      primary: VOICE_BAR_STATE_LABEL.sleeping,
      primaryIsError: false,
      detail,
      detailIsError: Boolean(detail && (detail === input.micError || ERROR_TEXT.test(detail))),
    };
  }
  if (input.state === 'listening') {
    return {
      primary: input.liveTranscript || VOICE_BAR_STATE_LABEL.listening,
      primaryIsError: false,
      detail: null,
      detailIsError: false,
    };
  }
  const primary =
    voiceError ?? input.whisperStatus ?? (input.liveTranscript || VOICE_BAR_STATE_LABEL[input.state]);
  return {
    primary,
    primaryIsError: Boolean(voiceError) || ERROR_TEXT.test(primary),
    detail: null,
    detailIsError: false,
  };
}
