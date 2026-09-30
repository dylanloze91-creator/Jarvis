/**
 * Autorisations Chromium pour le micro. Electron accorde tout par défaut
 * tant qu'aucun gestionnaire n'est posé ; Jarvis pose les deux (demande et
 * vérification) pour n'accorder que l'audio, et pour tracer chaque décision
 * dans le journal de capture.
 */

export interface MediaRequestDetails {
  mediaTypes?: string[];
  requestingUrl?: string;
}

/** Page de l'interface elle-même : `file://` empaqueté, ou le serveur Vite en dev. */
export function isAppDocumentUrl(url: string, devServerUrl?: string): boolean {
  if (!url) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:') return true;
  if (!devServerUrl) return false;
  try {
    return parsed.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/** Demande `getUserMedia` : micro seul, depuis l'interface. Tout le reste est refusé (comme avant). */
export function allowPermissionRequest(
  permission: string,
  details: MediaRequestDetails,
  devServerUrl?: string,
): boolean {
  if (permission !== 'media') return false;
  if ((details.mediaTypes ?? []).includes('video')) return false;
  return isAppDocumentUrl(details.requestingUrl ?? '', devServerUrl);
}

/**
 * Vérification (libellés d'`enumerateDevices`, `permissions.query`) :
 * l'audio est accordé, la caméra non. Les autres vérifications gardent le
 * comportement par défaut d'Electron (accordées, sauf la lecture
 * synchrone du presse-papiers).
 */
export function allowPermissionCheck(permission: string, mediaType?: string): boolean {
  if (permission === 'media') return mediaType !== 'video';
  return permission !== 'deprecated-sync-clipboard-read';
}

/** Origine seule pour le journal : jamais le chemin d'installation (nom d'utilisateur). */
export function originForLog(url: string | undefined): string {
  if (!url) return '(inconnue)';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
  } catch {
    return '(illisible)';
  }
}
