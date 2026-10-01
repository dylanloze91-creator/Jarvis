/**
 * Texte exact des cartes de confirmation Google. Partagé par les outils
 * (processus principal) et l'aperçu de l'interface : ce que l'utilisateur
 * lit est ce qui part.
 */

export interface MailConfirmation {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** Réponse à un mail existant. */
  inReplyTo?: string;
}

const BODY_PREVIEW_LIMIT = 4_000;

export function summarizeMailSend(to: string): string {
  return `Envoyer ce mail depuis ton Gmail à ${to}. Un mail envoyé ne peut pas être rappelé.`;
}

export function summarizeMailDraft(to: string): string {
  return `Créer un brouillon Gmail pour ${to}. Il ne sera pas envoyé.`;
}

export function formatMailForConfirmation(mail: MailConfirmation): string {
  const body = mail.body.length > BODY_PREVIEW_LIMIT ? `${mail.body.slice(0, BODY_PREVIEW_LIMIT)}\n… (${mail.body.length - BODY_PREVIEW_LIMIT} caractères de plus)` : mail.body;
  return [
    `À : ${mail.to.trim()}`,
    mail.cc?.trim() ? `Cc : ${mail.cc.trim()}` : '',
    `Objet : ${mail.subject.trim() || '(sans objet)'}`,
    mail.inReplyTo ? `En réponse au mail ${mail.inReplyTo}` : '',
    '',
    body,
  ]
    .filter((line, index) => line !== '' || index === 4)
    .join('\n');
}

export interface EventConfirmation {
  title: string;
  when: string;
  location?: string;
  description?: string;
}

export function formatEventForConfirmation(event: EventConfirmation): string {
  return [
    `Titre : ${event.title.trim() || '(sans titre)'}`,
    `Quand : ${event.when}`,
    event.location?.trim() ? `Lieu : ${event.location.trim()}` : '',
    event.description?.trim() ? `Description : ${event.description.trim().slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const MAX_PREVIEW_ROWS = 20;

/** Lignes d'une feuille, une par ligne, cellules séparées par « | ». */
export function formatRowsForConfirmation(rows: readonly (readonly string[])[]): string {
  const shown = rows.slice(0, MAX_PREVIEW_ROWS).map((row) => row.map((cell) => cell.replace(/\s+/g, ' ')).join(' | '));
  if (rows.length > MAX_PREVIEW_ROWS) shown.push(`… (${rows.length - MAX_PREVIEW_ROWS} lignes de plus)`);
  return shown.join('\n');
}

export function formatTextForConfirmation(text: string, limit = BODY_PREVIEW_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} caractères de plus)` : text;
}
