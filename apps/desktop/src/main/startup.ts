/**
 * Affiche la fenêtre dès la première frame. Le chargement du renderer peut
 * continuer ensuite : Whisper, openWakeWord, Ollama, Spotify et le réseau
 * ne sont pas sur ce chemin.
 */
export async function presentWindow(
  target: {
    once(event: 'ready-to-show', listener: () => void): void;
    show(): void;
  },
  load: () => Promise<void>,
): Promise<void> {
  let shown = false;
  const show = (): void => {
    if (shown) return;
    shown = true;
    target.show();
  };
  target.once('ready-to-show', show);
  try {
    await load();
  } finally {
    show();
  }
}
