import { z } from 'zod';
import {
  defineTool,
  formatEventForConfirmation,
  formatFrenchRange,
  formatMailForConfirmation,
  formatRowsForConfirmation,
  formatTextForConfirmation,
  resolveEventTiming,
  summarizeMailDraft,
  summarizeMailSend,
  toolSuccess,
  type RegisteredTool,
  type ToolResult,
} from '@jarvis/core';
import type { GoogleActionResult } from '../google/context.js';
import { GOOGLE_NOT_CONNECTED_MESSAGE, GOOGLE_READONLY_MESSAGE, googleFailure } from '../google/errors.js';
import type { GoogleRuntime } from '../google/runtime.js';

async function run(action: () => Promise<GoogleActionResult>): Promise<ToolResult> {
  try {
    const result = await action();
    return toolSuccess(result.text, result.data);
  } catch (error) {
    return googleFailure(error);
  }
}

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const grid = z.array(z.array(cell)).min(1).max(200);

function toRows(rows: Array<Array<string | number | boolean | null>>): string[][] {
  return rows.map((row) => row.map((value) => (value === null ? '' : String(value))));
}

const mailFields = {
  to: z.string().min(3).max(500).describe('Adresse(s) du destinataire, séparées par des virgules.'),
  cc: z.string().max(500).optional(),
  subject: z.string().min(1).max(250),
  body: z.string().min(1).max(20_000).describe('Texte complet du mail, signature comprise.'),
  replyToMessageId: z.string().max(200).optional().describe('Id du mail auquel on répond (renvoyé par google_gmail_search).'),
};

const eventTimeFields = {
  start: z.string().min(1).max(80).describe('Début : « demain 14h », « jeudi 9h30 » ou ISO local 2026-10-02T14:00. Sans heure : journée entière.'),
  end: z.string().max(80).optional().describe('Fin (même format, ou seulement l’heure « 16h »). Sinon 1 h.'),
  durationMinutes: z.number().int().min(5).max(20_160).optional(),
};

function whenOf(input: { start: string; end?: string; durationMinutes?: number; allDay?: boolean }): string {
  const timing = resolveEventTiming(input);
  return timing.ok ? formatFrenchRange(timing.start, timing.end) : `⚠ ${timing.error}`;
}

/**
 * Gmail, Agenda, Drive, Docs, Sheets. Absents du catalogue tant qu'aucun
 * compte Google n'est connecté ; écritures absentes en lecture seule.
 * Toute écriture demande confirmation (aucune catégorie : la politique des
 * réglages ne peut pas la retirer). Envoyer, supprimer ou écraser :
 * `forceConfirm`. Aucun outil ne supprime un mail.
 */
export function createGoogleTools(google: GoogleRuntime): RegisteredTool[] {
  const { account } = google;
  const read = {
    risk: 'safe' as const,
    isAvailable: () => account.isConnected(),
    unavailableMessage: GOOGLE_NOT_CONNECTED_MESSAGE,
  };
  const write = {
    risk: 'confirm' as const,
    isAvailable: () => account.isConnected() && account.canWriteNow(),
    unavailableMessage: () => (account.isConnected() ? GOOGLE_READONLY_MESSAGE : GOOGLE_NOT_CONNECTED_MESSAGE),
  };

  return [
    defineTool({
      ...read,
      name: 'google_gmail_search',
      description:
        'Liste ou cherche des mails Gmail (expéditeur, objet, date, extrait, id). query suit la syntaxe Gmail : from:paul, is:unread, newer_than:2d, subject:devis. Sans query : boîte de réception.',
      schema: z.object({
        query: z.string().max(300).optional(),
        unreadOnly: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(20).optional(),
      }),
      execute: (input) => run(() => google.gmail.search(input)),
    }),
    defineTool({
      ...read,
      name: 'google_gmail_read',
      description: "Lit un mail Gmail complet à partir de son id (renvoyé par google_gmail_search).",
      schema: z.object({ messageId: z.string().min(1).max(200) }),
      execute: ({ messageId }) => run(() => google.gmail.read(messageId)),
    }),
    defineTool({
      ...write,
      name: 'google_gmail_draft',
      description:
        "Crée un brouillon Gmail (nouveau mail ou réponse avec replyToMessageId). N'envoie rien. Confirmation demandée.",
      isDestructive: false,
      schema: z.object(mailFields),
      summarize: ({ to }) => summarizeMailDraft(to),
      describeCommand: (input) => formatMailForConfirmation({ ...input, inReplyTo: input.replyToMessageId }),
      execute: (input) => run(() => google.gmail.createDraft(input)),
    }),
    defineTool({
      ...write,
      name: 'google_gmail_send',
      description:
        "Envoie un mail depuis Gmail. Confirmation obligatoire : l'utilisateur voit destinataire, objet et texte exacts. draftId : envoie ce brouillon s'il est identique.",
      forceConfirm: true,
      isDestructive: true,
      schema: z.object({ ...mailFields, draftId: z.string().max(200).optional() }),
      summarize: ({ to }) => summarizeMailSend(to),
      describeCommand: (input) => formatMailForConfirmation({ ...input, inReplyTo: input.replyToMessageId }),
      execute: (input) => run(() => google.gmail.send(input)),
    }),
    defineTool({
      ...read,
      name: 'google_calendar_list',
      description:
        "Lit l'agenda Google : period = today, tomorrow, week, next7days, weekend ou month ; ou from/to (« demain », « 12/10 », ISO). Renvoie titre, horaire, lieu et id.",
      schema: z.object({
        period: z.enum(['today', 'tomorrow', 'week', 'next7days', 'weekend', 'month']).optional(),
        from: z.string().max(80).optional(),
        to: z.string().max(80).optional(),
        query: z.string().max(200).optional(),
        maxResults: z.number().int().min(1).max(50).optional(),
      }),
      execute: (input) => run(() => google.calendar.list(input)),
    }),
    defineTool({
      ...write,
      name: 'google_calendar_create',
      description: "Crée un événement dans l'agenda Google. Confirmation demandée.",
      isDestructive: false,
      schema: z.object({
        title: z.string().min(1).max(250),
        ...eventTimeFields,
        allDay: z.boolean().optional(),
        location: z.string().max(300).optional(),
        description: z.string().max(4_000).optional(),
      }),
      summarize: ({ title }) => `Créer l'événement « ${title} » dans ton agenda Google.`,
      describeCommand: (input) =>
        formatEventForConfirmation({ title: input.title, when: whenOf(input), location: input.location, description: input.description }),
      execute: (input) => run(() => google.calendar.create(input)),
    }),
    defineTool({
      ...write,
      name: 'google_calendar_update',
      description:
        "Modifie un événement existant (id et titre actuel renvoyés par google_calendar_list). Seuls les champs donnés changent. Confirmation demandée.",
      isDestructive: false,
      schema: z.object({
        eventId: z.string().min(1).max(300),
        eventTitle: z.string().min(1).max(250).describe("Titre actuel de l'événement, pour vérifier qu'il s'agit du bon."),
        title: z.string().max(250).optional(),
        start: eventTimeFields.start.optional(),
        end: eventTimeFields.end,
        durationMinutes: eventTimeFields.durationMinutes,
        location: z.string().max(300).optional(),
        description: z.string().max(4_000).optional(),
      }),
      summarize: ({ eventTitle }) => `Modifier l'événement « ${eventTitle} » de ton agenda Google.`,
      describeCommand: (input) =>
        [
          `Événement : ${input.eventTitle} (id ${input.eventId})`,
          input.title ? `Nouveau titre : ${input.title}` : '',
          input.start ? `Nouvel horaire : ${whenOf({ start: input.start, end: input.end, durationMinutes: input.durationMinutes })}` : '',
          !input.start && input.end ? `Nouvelle fin : ${input.end}` : '',
          input.location !== undefined ? `Lieu : ${input.location || '(retiré)'}` : '',
          input.description !== undefined ? `Description : ${input.description.slice(0, 600) || '(retirée)'}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      execute: (input) => run(() => google.calendar.update(input)),
    }),
    defineTool({
      ...write,
      name: 'google_calendar_delete',
      description:
        "Supprime un événement de l'agenda Google (id et titre renvoyés par google_calendar_list). Confirmation obligatoire.",
      forceConfirm: true,
      isDestructive: true,
      schema: z.object({
        eventId: z.string().min(1).max(300),
        eventTitle: z.string().min(1).max(250),
      }),
      summarize: ({ eventTitle }) => `Supprimer l'événement « ${eventTitle} » de ton agenda Google.`,
      describeCommand: ({ eventId, eventTitle }) => `Événement : ${eventTitle}\nId : ${eventId}`,
      execute: (input) => run(() => google.calendar.remove(input)),
    }),
    defineTool({
      ...read,
      name: 'google_drive_search',
      description:
        'Cherche des fichiers dans Google Drive par nom ou contenu (type : doc, sheet, slides, pdf, folder, any). Sans query : fichiers récents.',
      schema: z.object({
        query: z.string().max(200).optional(),
        type: z.enum(['doc', 'sheet', 'slides', 'pdf', 'folder', 'any']).optional(),
        maxResults: z.number().int().min(1).max(25).optional(),
      }),
      execute: (input) => run(() => google.drive.search(input)),
    }),
    defineTool({
      ...read,
      name: 'google_drive_read',
      description: "Lit le texte d'un fichier Drive (Google Doc, Sheet, Slides ou fichier texte) à partir de son lien ou id.",
      schema: z.object({ file: z.string().min(1).max(500) }),
      execute: (input) => run(() => google.drive.readFile(input)),
    }),
    defineTool({
      ...read,
      name: 'google_docs_read',
      description: "Lit un Google Doc (lien ou id).",
      schema: z.object({ document: z.string().min(1).max(500) }),
      execute: (input) => run(() => google.docs.read(input)),
    }),
    defineTool({
      ...write,
      name: 'google_docs_create',
      description: 'Crée un Google Doc, avec un texte de départ facultatif. Confirmation demandée.',
      isDestructive: false,
      schema: z.object({
        title: z.string().min(1).max(250),
        content: z.string().max(50_000).optional(),
      }),
      summarize: ({ title }) => `Créer le Google Doc « ${title} ».`,
      describeCommand: ({ title, content }) =>
        `Titre : ${title}${content?.trim() ? `\n\n${formatTextForConfirmation(content)}` : '\n(document vide)'}`,
      execute: (input) => run(() => google.docs.create(input)),
    }),
    defineTool({
      ...write,
      name: 'google_docs_append',
      description: "Ajoute du texte à la fin d'un Google Doc existant (lien ou id). Rien n'est effacé. Confirmation demandée.",
      isDestructive: false,
      schema: z.object({
        document: z.string().min(1).max(500),
        text: z.string().min(1).max(50_000),
      }),
      summarize: ({ document }) => `Ajouter ce texte à la fin du Google Doc ${document}.`,
      describeCommand: ({ text }) => formatTextForConfirmation(text),
      execute: (input) => run(() => google.docs.append(input)),
    }),
    defineTool({
      ...read,
      name: 'google_sheets_read',
      description: "Lit une plage d'une Google Sheet (lien ou id ; range comme « Budget!A1:D20 »). Sans range : 50 premières lignes du premier onglet.",
      schema: z.object({
        spreadsheet: z.string().min(1).max(500),
        range: z.string().max(200).optional(),
      }),
      execute: (input) => run(() => google.sheets.read(input)),
    }),
    defineTool({
      ...write,
      name: 'google_sheets_append',
      description:
        "Ajoute des lignes à la fin d'une Google Sheet (rows = liste de lignes, chaque ligne = liste de cellules). Rien n'est écrasé. Confirmation demandée.",
      isDestructive: false,
      schema: z.object({
        spreadsheet: z.string().min(1).max(500),
        range: z.string().max(200).optional().describe('Onglet ou plage de départ, par ex. « Dépenses!A1 ». Sinon le premier onglet.'),
        rows: grid,
      }),
      summarize: ({ spreadsheet, range, rows }) =>
        `Ajouter ${rows.length} ligne(s) à la Google Sheet ${spreadsheet}${range ? ` (${range})` : ''}.`,
      describeCommand: ({ rows }) => formatRowsForConfirmation(toRows(rows)),
      execute: (input) => run(() => google.sheets.append({ ...input, rows: toRows(input.rows) })),
    }),
    defineTool({
      ...write,
      name: 'google_sheets_write',
      description:
        'Écrit des valeurs dans une plage précise d’une Google Sheet, en remplaçant ce qui s’y trouve. Confirmation obligatoire.',
      forceConfirm: true,
      isDestructive: true,
      schema: z.object({
        spreadsheet: z.string().min(1).max(500),
        range: z.string().min(1).max(200).describe('Plage A1, par ex. « Budget!B2:C4 ».'),
        values: grid,
      }),
      summarize: ({ spreadsheet, range }) =>
        `Écrire dans ${range} de la Google Sheet ${spreadsheet}. Les cellules existantes de cette plage seront remplacées.`,
      describeCommand: ({ range, values }) => `Plage : ${range}\n${formatRowsForConfirmation(toRows(values))}`,
      execute: (input) => run(() => google.sheets.write({ ...input, values: toRows(input.values) })),
    }),
  ];
}
