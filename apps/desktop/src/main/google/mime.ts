/** Messages Gmail : construction RFC 2822 (UTF-8) et lecture du corps. */

export interface OutgoingMail {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
  headers?: Array<{ name?: string; value?: string }>;
}

const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

/** « Paul <paul@x.fr>, marie@y.fr » → adresses valides ; `null` si une seule est douteuse. */
export function parseRecipients(value: string): string[] | null {
  const parts = value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const addresses: string[] = [];
  for (const part of parts) {
    const angle = part.match(/<([^<>]+)>\s*$/);
    const address = (angle?.[1] ?? part).trim();
    if (!ADDRESS.test(address)) return null;
    addresses.push(address.toLowerCase());
  }
  return addresses;
}

function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function cleanHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildRawMessage(mail: OutgoingMail): string {
  const body = Buffer.from(mail.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  const lines = [
    `To: ${cleanHeaderValue(mail.to)}`,
    mail.cc?.trim() ? `Cc: ${cleanHeaderValue(mail.cc)}` : '',
    `Subject: ${encodeHeader(mail.subject || '(sans objet)')}`,
    mail.inReplyTo ? `In-Reply-To: ${cleanHeaderValue(mail.inReplyTo)}` : '',
    mail.references ? `References: ${cleanHeaderValue(mail.references)}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
}

export function headerOf(part: GmailPart | undefined, name: string): string {
  const found = part?.headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() ?? '';
}

/** Décode un en-tête RFC 2047 (`=?UTF-8?B?…?=`, `=?…?Q?…?=`) tel que Gmail le renvoie parfois. */
export function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, _charset: string, encoding: string, text: string) => {
    try {
      if (encoding.toUpperCase() === 'B') return Buffer.from(text, 'base64').toString('utf8');
      const bytes = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(bytes, 'latin1').toString('utf8');
    } catch {
      return text;
    }
  });
}

function decodeData(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | null {
  if (!part) return null;
  if (part.mimeType?.toLowerCase().startsWith(mime) && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

/** Texte lisible d'un message Gmail : text/plain d'abord, sinon le HTML sans balises. */
export function extractMailText(payload: GmailPart | undefined): string {
  const plain = findPart(payload, 'text/plain');
  if (plain?.body?.data) return decodeData(plain.body.data).replace(/\r\n/g, '\n').trim();
  const html = findPart(payload, 'text/html');
  if (html?.body?.data) return stripHtml(decodeData(html.body.data));
  if (payload?.body?.data) return decodeData(payload.body.data).trim();
  return '';
}

export function listAttachments(payload: GmailPart | undefined): string[] {
  const names: string[] = [];
  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    if (part.filename) names.push(part.filename);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return names;
}

export function normalizeForCompare(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}
