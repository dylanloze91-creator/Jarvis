/**
 * Autorisations Google demandées par Jarvis. Rien de plus que ce que les
 * outils utilisent :
 *
 * - Gmail : `gmail.readonly` (lire, chercher) + `gmail.compose` (brouillons
 *   et envoi). Toutes deux « restreintes » chez Google : écran « application
 *   non validée » au consentement, accepté pour un usage personnel.
 * - Agenda : `calendar.events` (ou `calendar.events.readonly`). Sensible.
 * - Drive : `drive.readonly` (chercher et lire le texte). Restreinte. Couvre
 *   aussi la lecture des Docs et Sheets.
 * - Docs : `documents` (créer, ajouter du texte). Sensible.
 * - Sheets : `spreadsheets` (ajouter des lignes, écrire une plage). Sensible.
 */

export const GOOGLE_OAUTH_PORT = 53125;
export const GOOGLE_REDIRECT_PATH = '/callback';
export const GOOGLE_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_OAUTH_PORT}${GOOGLE_REDIRECT_PATH}`;

export type GoogleAccessMode = 'full' | 'readonly';
export type GoogleService = 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets';

export const GOOGLE_SERVICES: GoogleService[] = ['gmail', 'calendar', 'drive', 'docs', 'sheets'];

export const GOOGLE_SERVICE_LABELS: Record<GoogleService, string> = {
  gmail: 'Gmail',
  calendar: 'Agenda',
  drive: 'Drive',
  docs: 'Docs',
  sheets: 'Sheets',
};

/** Nom de l'API à activer dans la bibliothèque Google Cloud. */
export const GOOGLE_API_NAMES: Record<GoogleService, { label: string; id: string }> = {
  gmail: { label: 'Gmail API', id: 'gmail.googleapis.com' },
  calendar: { label: 'Google Calendar API', id: 'calendar-json.googleapis.com' },
  drive: { label: 'Google Drive API', id: 'drive.googleapis.com' },
  docs: { label: 'Google Docs API', id: 'docs.googleapis.com' },
  sheets: { label: 'Google Sheets API', id: 'sheets.googleapis.com' },
};

const SCOPE = 'https://www.googleapis.com/auth/';

export const GOOGLE_SCOPE = {
  gmailRead: `${SCOPE}gmail.readonly`,
  gmailCompose: `${SCOPE}gmail.compose`,
  calendarEvents: `${SCOPE}calendar.events`,
  calendarEventsRead: `${SCOPE}calendar.events.readonly`,
  driveRead: `${SCOPE}drive.readonly`,
  docs: `${SCOPE}documents`,
  sheets: `${SCOPE}spreadsheets`,
} as const;

/** Autorisations demandées au consentement, selon le mode choisi dans les réglages. */
export function googleScopesFor(mode: GoogleAccessMode): string[] {
  if (mode === 'readonly') {
    return [GOOGLE_SCOPE.gmailRead, GOOGLE_SCOPE.calendarEventsRead, GOOGLE_SCOPE.driveRead];
  }
  return [
    GOOGLE_SCOPE.gmailRead,
    GOOGLE_SCOPE.gmailCompose,
    GOOGLE_SCOPE.calendarEvents,
    GOOGLE_SCOPE.driveRead,
    GOOGLE_SCOPE.docs,
    GOOGLE_SCOPE.sheets,
  ];
}

/** Restreintes chez Google (vérification renforcée si l'appli était publique). */
export const GOOGLE_RESTRICTED_SCOPES = [
  GOOGLE_SCOPE.gmailRead,
  GOOGLE_SCOPE.gmailCompose,
  GOOGLE_SCOPE.driveRead,
];

const ANY = (...names: string[]): string[] => names.map((name) => (name.startsWith('http') ? name : `${SCOPE}${name}`));

/** Une seule de ces autorisations suffit pour l'opération. */
const READ_SCOPES: Record<GoogleService, string[]> = {
  gmail: [...ANY('gmail.readonly', 'gmail.modify'), 'https://mail.google.com/'],
  calendar: ANY('calendar.events', 'calendar.events.readonly', 'calendar', 'calendar.readonly'),
  drive: ANY('drive.readonly', 'drive'),
  docs: ANY('documents', 'documents.readonly', 'drive.readonly', 'drive'),
  sheets: ANY('spreadsheets', 'spreadsheets.readonly', 'drive.readonly', 'drive'),
};

const WRITE_SCOPES: Record<GoogleService, string[]> = {
  gmail: [...ANY('gmail.compose', 'gmail.modify'), 'https://mail.google.com/'],
  calendar: ANY('calendar.events', 'calendar'),
  drive: [],
  docs: ANY('documents', 'drive'),
  sheets: ANY('spreadsheets', 'drive'),
};

export function canReadGoogle(service: GoogleService, granted: readonly string[]): boolean {
  return READ_SCOPES[service].some((scope) => granted.includes(scope));
}

export function canWriteGoogle(service: GoogleService, granted: readonly string[]): boolean {
  return WRITE_SCOPES[service].some((scope) => granted.includes(scope));
}

/** Les champs `scope` de Google sont séparés par des espaces. */
export function parseGrantedScopes(scope: string | undefined | null): string[] {
  return (scope ?? '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface GoogleServiceAccess {
  id: GoogleService;
  label: string;
  read: boolean;
  write: boolean;
  /** Écriture prévue par le mode, mais décochée au consentement. */
  writeMissing: boolean;
  /** Lecture décochée au consentement. */
  readMissing: boolean;
}

export function describeGoogleAccess(
  granted: readonly string[],
  mode: GoogleAccessMode,
): GoogleServiceAccess[] {
  return GOOGLE_SERVICES.map((id) => {
    const read = canReadGoogle(id, granted);
    const write = mode === 'full' && canWriteGoogle(id, granted);
    const writeExpected = mode === 'full' && WRITE_SCOPES[id].length > 0;
    return {
      id,
      label: GOOGLE_SERVICE_LABELS[id],
      read,
      write,
      writeMissing: writeExpected && !write,
      readMissing: !read,
    };
  });
}
