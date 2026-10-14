const LOCK = /\b(EPERM|EBUSY|EACCES)\b|resource busy|operation not permitted|access (?:is )?denied|index\.lock|cannot (?:access|rename|unlink)/i;

/**
 * Traduit les verrous Windows fréquents (OneDrive, antivirus, Explorateur,
 * index Git) en une action compréhensible au lieu de laisser un code EPERM.
 */
export function windowsLockMessage(detail: string, target?: string): string | null {
  const text = detail.trim();
  if (!LOCK.test(text)) return null;
  const where = target?.trim() ? ` « ${target.trim()} »` : '';
  return (
    `Windows bloque momentanément le dossier${where} (OneDrive, antivirus ou fichier ouvert). ` +
    `Ferme les fenêtres et éditeurs qui l’utilisent, mets la synchronisation OneDrive en pause ` +
    `ou autorise ce dossier dans l’antivirus, puis relance. Détail : ${text.slice(0, 240)}`
  );
}

