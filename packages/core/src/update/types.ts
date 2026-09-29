/**
 * Familles d'échec de mise à jour automatique. Le détail technique (code
 * d'erreur electron-updater, message HTTP…) reste dans `raw`, jamais affiché
 * tel quel à l'utilisateur : seule `message` est prête pour l'interface.
 *
 * - `network`   : pas de connexion Internet, DNS, pare-feu, délai dépassé.
 * - `not-found` : aucune publication GitHub disponible (dépôt vide, retiré,
 *                 ou le fichier de métadonnées de la publication est absent).
 * - `corrupted` : le fichier téléchargé ne correspond pas à l'empreinte
 *                 attendue (téléchargement interrompu ou altéré).
 * - `unknown`   : tout le reste — l'application continue de fonctionner
 *                 normalement, seule la mise à jour automatique échoue.
 */
export type UpdateFailureKind = 'network' | 'not-found' | 'corrupted' | 'unknown';

export interface UpdateFailure {
  kind: UpdateFailureKind;
  /** Message en français, prêt à afficher tel quel dans l'interface. */
  message: string;
  /** Détail technique brut (code, message d'origine) — pour les journaux, jamais affiché. */
  raw: string;
}
