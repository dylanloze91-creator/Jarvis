type VoiceBarState = 'idle' | 'sleeping' | 'listening' | 'speaking' | 'error';

export const VOICE_BAR_STATE_LABEL: Record<VoiceBarState, string> = {
  idle: 'Commande vocale désactivée',
  sleeping: 'En veille — dis « Jarvis »',
  listening: 'À l’écoute…',
  speaking: 'Jarvis parle…',
  error: 'Micro indisponible',
};

const ERROR_TEXT = /indisponible|erreur|error_code|n['’]a pas pu|ne s['’]est pas chargé|bloqué|codes \d|réinstalle|tester la voix|introuvable|refusé/i;

/**
 * En veille, ne jamais remplacer le prompt « dis Jarvis » par un message
 * d'erreur (Whisper / openWakeWord) : l'erreur passe en détail. Pendant
 * l'écoute, la ligne montre la transcription en cours et n'hérite pas en
 * rouge d'une ancienne erreur.
 */
export function voiceBarStatusLines(input: {
  state: VoiceBarState;
  micError: string | null;
  whisperStatus: string | null;
  liveTranscript: string;
}): { primary: string; primaryIsError: boolean; detail: string | null; detailIsError: boolean } {
  if (input.state === 'error') {
    return {
      primary: input.micError ?? VOICE_BAR_STATE_LABEL.error,
      primaryIsError: true,
      detail: null,
      detailIsError: false,
    };
  }
  if (input.state === 'sleeping') {
    const detail = input.micError ?? input.whisperStatus ?? null;
    return {
      primary: VOICE_BAR_STATE_LABEL.sleeping,
      primaryIsError: false,
      detail,
      detailIsError: Boolean(detail && ERROR_TEXT.test(detail)),
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
    input.micError ?? input.whisperStatus ?? (input.liveTranscript || VOICE_BAR_STATE_LABEL[input.state]);
  return {
    primary,
    primaryIsError: Boolean(input.micError) || ERROR_TEXT.test(primary),
    detail: null,
    detailIsError: false,
  };
}
