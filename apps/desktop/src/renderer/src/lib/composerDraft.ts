/**
 * 5.0.64 — préremplissage du champ de saisie. Une carte dont la demande est à
 * compléter (« Analyse cette vidéo YouTube : » + lien) ne doit pas partir telle
 * quelle : elle est posée dans le composer, le curseur à la fin, et c'est
 * l'utilisateur qui complète puis envoie.
 */
export type ComposerDraftHandler = (text: string) => void;

const target: { current: ComposerDraftHandler | null; pending: string | null } = {
  current: null,
  pending: null,
};

export function setComposerDraftTarget(handler: ComposerDraftHandler | null): void {
  target.current = handler;
  if (handler && target.pending !== null) {
    const text = target.pending;
    target.pending = null;
    handler(text);
  }
}

/** Pose le texte dans le composer ; s'il n'est pas encore monté, le texte attend son montage. */
export function requestComposerDraft(text: string): void {
  if (target.current) target.current(text);
  else target.pending = text;
}

/** Une demande qui se termine par « : » attend un complément de l'utilisateur. */
export function needsCompletion(prompt: string): boolean {
  return /[:：]\s*$/.test(prompt);
}
