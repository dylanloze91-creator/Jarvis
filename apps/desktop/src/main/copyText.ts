/**
 * Copie demandée par la fenêtre (bouton « Copier »), faite par le processus principal avec
 * `clipboard.writeText` d'Electron. `navigator.clipboard` ne marche pas dans la fenêtre : le
 * gestionnaire d'autorisations n'accorde que le micro, et « Copier le bloc » des enceintes ne
 * copiait rien, sans message (16 novembre 2026).
 *
 * La fenêtre ne peut qu'écrire du texte, jamais lire le presse-papiers.
 */

/** Même plafond que « Copier le détail » du diagnostic de la voix. */
export const COPY_TEXT_MAX = 20_000;

export function isCopyableText(text: unknown): text is string {
  return typeof text === 'string' && text.length > 0 && text.length <= COPY_TEXT_MAX;
}
