import type { UpdateFailure } from './types.js';

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** Codes d'erreur propres à electron-updater (voir `builder-util-runtime`/`electron-updater`). */
const NOT_FOUND_ERROR_CODES = new Set([
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
]);

/**
 * Classe une erreur de mise à jour automatique en une des quatre familles
 * ci-dessus, avec un message en français prêt à afficher. Ne lève jamais
 * d'exception : une erreur non reconnue retombe sur `unknown`, jamais un
 * crash de la classification elle-même — la mise à jour automatique ne doit
 * jamais faire échouer l'application, y compris dans son propre code
 * d'erreur.
 */
export function classifyUpdateError(error: unknown): UpdateFailure {
  const code = extractCode(error);
  const statusCode = extractStatusCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const raw = code ? `${code}: ${message}` : message;

  if (code === 'ERR_CHECKSUM_MISMATCH' || /checksum mismatch/i.test(message)) {
    return {
      kind: 'corrupted',
      message:
        'Le fichier de mise à jour téléchargé est corrompu ou incomplet. Jarvis réessaiera automatiquement lors du prochain contrôle.',
      raw,
    };
  }

  if (
    (code && NOT_FOUND_ERROR_CODES.has(code)) ||
    statusCode === 404 ||
    /cannot find .*\.yml/i.test(message)
  ) {
    return {
      kind: 'not-found',
      message:
        "Aucune GitHub Release n'est publiée pour l'instant. Jarvis a bien vérifié : il n'y a rien à installer. Les mises à jour automatiques commenceront dès qu'une version supérieure sera mise en ligne.",
      raw,
    };
  }

  if (
    (code && NETWORK_ERROR_CODES.has(code)) ||
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|failed to fetch|fetch failed|networkerror/i.test(
      message,
    )
  ) {
    return {
      kind: 'network',
      message:
        'Impossible de vérifier les mises à jour : pas de connexion Internet, ou serveur GitHub injoignable.',
      raw,
    };
  }

  return {
    kind: 'unknown',
    message:
      'La vérification des mises à jour a échoué pour une raison inattendue. Jarvis continue de fonctionner normalement.',
    raw,
  };
}

function extractCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function extractStatusCode(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown } | undefined)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}
