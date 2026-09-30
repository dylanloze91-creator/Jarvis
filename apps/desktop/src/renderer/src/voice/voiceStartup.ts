/**
 * Décision de démarrage vocal. Whisper n'en fait pas partie : il ne se charge
 * que lorsqu'un réveil demande une transcription (confirmation ou dictée).
 */
export type VoiceBootAction = 'off' | 'wait' | 'start-wake';

export function voiceBootAction(input: {
  voiceEnabled: boolean;
  windowVisible: boolean;
}): VoiceBootAction {
  if (!input.voiceEnabled) return 'off';
  if (!input.windowVisible) return 'wait';
  return 'start-wake';
}

export interface WindowShownApi {
  isVisible(): Promise<boolean>;
  /** Ne doit pas appeler `listener` de façon synchrone. */
  onShown(listener: () => void): () => void;
}

/**
 * Résout quand la fenêtre est visible. `isVisible` et `onShown` se couvrent
 * l'un l'autre : un événement émis entre les deux n'est pas perdu.
 */
export function waitForWindowShown(api: WindowShownApi, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      resolve();
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new DOMException('aborted', 'AbortError'));
    };
    unsubscribe = api.onShown(finish);
    if (settled) unsubscribe();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    void api.isVisible().then(
      (visible) => {
        if (visible) finish();
      },
      () => finish(),
    );
  });
}

/** Démarre le moteur de réveil seulement une fois la fenêtre visible. */
export async function startWakeWhenWindowVisible(
  api: WindowShownApi,
  start: () => void,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  let visible = false;
  try {
    visible = await api.isVisible();
  } catch {
    visible = false;
  }
  if (signal?.aborted) return;
  if (voiceBootAction({ voiceEnabled: true, windowVisible: visible }) === 'start-wake') {
    start();
    return;
  }
  await waitForWindowShown(api, signal);
  if (signal?.aborted) return;
  start();
}
