import {
  GOOGLE_API_NAMES,
  GOOGLE_SERVICE_LABELS,
  classifyThrownError,
  redactSecrets,
  toolFailure,
  type GoogleService,
  type ToolOutcomeKind,
  type ToolResult,
} from '@jarvis/core';

export type GoogleErrorKind =
  | 'not_configured'
  | 'not_connected'
  | 'reconsent'
  | 'scope_missing'
  | 'api_disabled'
  | 'readonly'
  | 'rate_limited'
  | 'not_found'
  | 'invalid_request'
  | 'forbidden'
  | 'server'
  | 'network'
  | 'timeout'
  | 'verification_failed'
  | 'mismatch'
  | 'unsupported'
  | 'client_secret_missing'
  | 'invalid_client'
  | 'auth_cancelled'
  | 'auth_timeout'
  | 'auth_in_progress'
  | 'encryption_unavailable';

const OUTCOME: Record<GoogleErrorKind, Exclude<ToolOutcomeKind, 'success'>> = {
  not_configured: 'missing_dependency',
  not_connected: 'missing_dependency',
  reconsent: 'missing_dependency',
  scope_missing: 'missing_dependency',
  api_disabled: 'missing_dependency',
  readonly: 'definitive',
  rate_limited: 'recoverable',
  not_found: 'definitive',
  invalid_request: 'definitive',
  forbidden: 'definitive',
  server: 'recoverable',
  network: 'recoverable',
  timeout: 'timeout',
  verification_failed: 'definitive',
  mismatch: 'definitive',
  unsupported: 'definitive',
  client_secret_missing: 'missing_dependency',
  invalid_client: 'missing_dependency',
  auth_cancelled: 'cancelled',
  auth_timeout: 'timeout',
  auth_in_progress: 'recoverable',
  encryption_unavailable: 'missing_dependency',
};

export interface GoogleErrorOptions {
  service?: GoogleService;
  technicalDetail?: string;
  retryAfterSeconds?: number;
  status?: number;
}

/** Erreur Google typée : phrase française pour l'utilisateur, détail technique déjà sans secret. */
export class GoogleError extends Error {
  readonly kind: GoogleErrorKind;
  readonly service?: GoogleService;
  readonly technicalDetail: string;
  readonly retryAfterSeconds?: number;
  readonly status?: number;

  constructor(kind: GoogleErrorKind, userMessage: string, options: GoogleErrorOptions = {}) {
    super(userMessage);
    this.name = 'GoogleError';
    this.kind = kind;
    this.service = options.service;
    this.technicalDetail = redactSecrets(options.technicalDetail ?? `${kind}: ${userMessage}`);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.status = options.status;
  }

  get outcome(): Exclude<ToolOutcomeKind, 'success'> {
    return OUTCOME[this.kind];
  }
}

const SETTINGS_PATH = 'Réglages → Google';

export const GOOGLE_NOT_CONNECTED_MESSAGE = `Google n'est pas connecté. Ouvre ${SETTINGS_PATH}, colle ton identifiant client et ton secret, puis clique sur « Se connecter ». Rien n'a été fait.`;

export const GOOGLE_READONLY_MESSAGE = `Google est en lecture seule dans Jarvis : je peux lire, pas écrire. Pour autoriser l'écriture, choisis « Lecture et écriture » dans ${SETTINGS_PATH} puis reconnecte-toi. Rien n'a été fait.`;

export function notConfigured(): GoogleError {
  return new GoogleError(
    'not_configured',
    `Google n'est pas configuré. Ouvre ${SETTINGS_PATH} et suis le guide : identifiant client et secret d'un client « Application de bureau ». Rien n'a été fait.`,
  );
}

export function notConnected(): GoogleError {
  return new GoogleError('not_connected', GOOGLE_NOT_CONNECTED_MESSAGE);
}

export function reconsentRequired(detail: string): GoogleError {
  return new GoogleError(
    'reconsent',
    `La connexion Google a expiré ou a été retirée (en mode « Test », Google coupe l'accès au bout de 7 jours). Ouvre ${SETTINGS_PATH} et clique sur « Se reconnecter ». Rien n'a été fait.`,
    { technicalDetail: detail },
  );
}

export function scopeMissing(service: GoogleService, write: boolean, detail?: string): GoogleError {
  const label = GOOGLE_SERVICE_LABELS[service];
  const what = write ? `l'écriture dans ${label}` : `la lecture de ${label}`;
  return new GoogleError(
    'scope_missing',
    `Google n'a pas donné à Jarvis l'autorisation pour ${what} (case décochée au consentement). Ouvre ${SETTINGS_PATH}, clique sur « Se reconnecter » et coche ${label}. Rien n'a été fait.`,
    { service, technicalDetail: detail ?? `scope manquant: ${service} ${write ? 'écriture' : 'lecture'}` },
  );
}

export function apiDisabled(service: GoogleService, detail: string): GoogleError {
  const api = GOOGLE_API_NAMES[service];
  return new GoogleError(
    'api_disabled',
    `L'API « ${api.label} » n'est pas activée dans ton projet Google Cloud. Active-la (Google Cloud → API et services → Bibliothèque → ${api.label} → Activer), attends une minute, puis réessaie. Rien n'a été fait.`,
    { service, technicalDetail: detail },
  );
}

export function readonlyMode(): GoogleError {
  return new GoogleError('readonly', GOOGLE_READONLY_MESSAGE);
}

export function rateLimited(service: GoogleService, retryAfterSeconds: number | undefined, detail: string): GoogleError {
  const wait = retryAfterSeconds && retryAfterSeconds > 0 ? `dans ${Math.ceil(retryAfterSeconds)} s` : 'dans une minute';
  return new GoogleError(
    'rate_limited',
    `Google limite les requêtes de ${GOOGLE_SERVICE_LABELS[service]} pour le moment. Réessaie ${wait}. Rien n'a été fait.`,
    { service, technicalDetail: detail, retryAfterSeconds },
  );
}

export function verificationFailed(service: GoogleService, what: string, detail: string): GoogleError {
  return new GoogleError(
    'verification_failed',
    `Google a accepté la demande, mais la relecture ne confirme pas ${what}. Vérifie dans ${GOOGLE_SERVICE_LABELS[service]} avant de recommencer : je ne considère pas l'action comme faite.`,
    { service, technicalDetail: detail },
  );
}

/** Résultat d'outil à partir de n'importe quelle erreur levée par le code Google. */
export function googleFailure(error: unknown): ToolResult {
  if (error instanceof GoogleError) {
    return toolFailure(error.outcome, error.message, error.technicalDetail, {
      kind: error.kind,
      service: error.service,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  const classified = classifyThrownError(error);
  return toolFailure(
    classified.outcome,
    classified.outcome === 'definitive'
      ? `Google : l'action n'a pas abouti. Rien n'a été confirmé.`
      : classified.userMessage,
    classified.technicalDetail,
  );
}
