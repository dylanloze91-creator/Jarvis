import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import { redactSecrets, redactValue } from '../security/redact.js';
import { parseSettings } from '../settings.js';
import {
  GOOGLE_OAUTH_PORT,
  GOOGLE_REDIRECT_URI,
  GOOGLE_RESTRICTED_SCOPES,
  GOOGLE_SCOPE,
  canReadGoogle,
  canWriteGoogle,
  describeGoogleAccess,
  googleScopesFor,
  parseGrantedScopes,
} from './scopes.js';
import {
  formatFrenchRange,
  parseFrenchDateTime,
  resolveCalendarPeriod,
  resolveEventTiming,
  toLocalIso,
  toDateString,
} from './dates.js';
import { isGoogleToolName, looksLikeGoogleIntent, recentlyUsedGoogleTools } from './intent.js';
import { parseGoogleResource } from './resource.js';
import { formatMailForConfirmation, formatRowsForConfirmation } from './confirmText.js';
import { googleTurnPrompt } from './prompt.js';

describe('autorisations Google', () => {
  it('écoute sur un port différent de Spotify (53124)', () => {
    expect(GOOGLE_OAUTH_PORT).not.toBe(53124);
    expect(GOOGLE_REDIRECT_URI).toBe('http://127.0.0.1:53125/callback');
  });

  it('demande le minimum en lecture seule, et rien qui écrive', () => {
    const scopes = googleScopesFor('readonly');
    expect(scopes).toEqual([GOOGLE_SCOPE.gmailRead, GOOGLE_SCOPE.calendarEventsRead, GOOGLE_SCOPE.driveRead]);
    for (const service of ['gmail', 'calendar', 'docs', 'sheets'] as const) {
      expect(canWriteGoogle(service, scopes)).toBe(false);
    }
    for (const service of ['gmail', 'calendar', 'drive', 'docs', 'sheets'] as const) {
      expect(canReadGoogle(service, scopes)).toBe(true);
    }
  });

  it('mode complet : lecture et écriture, jamais le scope Gmail de suppression', () => {
    const scopes = googleScopesFor('full');
    expect(scopes).not.toContain('https://mail.google.com/');
    expect(scopes).not.toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(scopes).not.toContain('https://www.googleapis.com/auth/drive');
    for (const service of ['gmail', 'calendar', 'docs', 'sheets'] as const) {
      expect(canWriteGoogle(service, scopes)).toBe(true);
    }
    expect(GOOGLE_RESTRICTED_SCOPES.every((scope) => scopes.includes(scope))).toBe(true);
  });

  it('signale ce qui a été décoché au consentement', () => {
    const granted = parseGrantedScopes(`${GOOGLE_SCOPE.gmailRead}  ${GOOGLE_SCOPE.calendarEvents}`);
    const access = describeGoogleAccess(granted, 'full');
    expect(access.find((item) => item.id === 'gmail')).toMatchObject({ read: true, write: false, writeMissing: true });
    expect(access.find((item) => item.id === 'calendar')).toMatchObject({ read: true, write: true });
    expect(access.find((item) => item.id === 'drive')).toMatchObject({ read: false, readMissing: true });
    const readonly = describeGoogleAccess(googleScopesFor('full'), 'readonly');
    expect(readonly.every((item) => !item.write && !item.writeMissing)).toBe(true);
  });
});

describe('dates françaises', () => {
  const now = new Date(2026, 9, 1, 21, 14); // jeudi 1er octobre 2026

  it('demain 14h, jeudi 9h30, après-demain', () => {
    expect(parseFrenchDateTime('demain 14h', now)).toEqual({ year: 2026, month: 10, day: 2, hour: 14, minute: 0 });
    expect(parseFrenchDateTime('lundi à 9h30', now)).toEqual({ year: 2026, month: 10, day: 5, hour: 9, minute: 30 });
    expect(parseFrenchDateTime('jeudi prochain 10:15', now)).toEqual({ year: 2026, month: 10, day: 8, hour: 10, minute: 15 });
    expect(parseFrenchDateTime('après-demain', now)).toEqual({ year: 2026, month: 10, day: 3 });
    expect(parseFrenchDateTime("aujourd'hui à midi", now)).toEqual({ year: 2026, month: 10, day: 1, hour: 12, minute: 0 });
  });

  it('ISO local, et un « Z » ajouté par le modèle reste l’heure dite', () => {
    expect(parseFrenchDateTime('2026-10-02T14:00', now)).toEqual({ year: 2026, month: 10, day: 2, hour: 14, minute: 0 });
    expect(parseFrenchDateTime('2026-10-02T14:00:00Z', now)).toEqual({ year: 2026, month: 10, day: 2, hour: 14, minute: 0 });
    expect(parseFrenchDateTime('2026-10-02', now)).toEqual({ year: 2026, month: 10, day: 2 });
  });

  it('jours et mois écrits, dates numériques, et refus du flou', () => {
    expect(parseFrenchDateTime('le 3 octobre à 18h', now)).toEqual({ year: 2026, month: 10, day: 3, hour: 18, minute: 0 });
    expect(parseFrenchDateTime('1er janvier', now)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(parseFrenchDateTime('12/10 8h', now)).toEqual({ year: 2026, month: 10, day: 12, hour: 8, minute: 0 });
    expect(parseFrenchDateTime('2026-02-30', now)).toBeNull();
    expect(parseFrenchDateTime('bientôt', now)).toBeNull();
    expect(parseFrenchDateTime('', now)).toBeNull();
  });

  it('formats envoyés à Google et lus par l’utilisateur', () => {
    const start = parseFrenchDateTime('demain 14h', now)!;
    expect(toLocalIso(start)).toBe('2026-10-02T14:00:00');
    expect(toDateString(start)).toBe('2026-10-02');
    expect(formatFrenchRange(start, { ...start, hour: 15 })).toBe('vendredi 2 octobre 2026 de 14:00 à 15:00');
    expect(formatFrenchRange({ year: 2026, month: 10, day: 2 }, { year: 2026, month: 10, day: 3 })).toBe(
      'vendredi 2 octobre 2026 (journée entière)',
    );
  });

  it('début, fin et durée d’un événement', () => {
    expect(resolveEventTiming({ start: 'demain 14h' }, now)).toEqual({
      ok: true,
      allDay: false,
      start: { year: 2026, month: 10, day: 2, hour: 14, minute: 0 },
      end: { year: 2026, month: 10, day: 2, hour: 15, minute: 0 },
    });
    const withEnd = resolveEventTiming({ start: 'demain 14h', end: '16h30' }, now);
    expect(withEnd.ok && withEnd.end).toEqual({ year: 2026, month: 10, day: 2, hour: 16, minute: 30 });
    const duration = resolveEventTiming({ start: '2026-10-02T09:00', durationMinutes: 30 }, now);
    expect(duration.ok && duration.end).toEqual({ year: 2026, month: 10, day: 2, hour: 9, minute: 30 });
    const allDay = resolveEventTiming({ start: 'samedi' }, now);
    expect(allDay).toEqual({ ok: true, allDay: true, start: { year: 2026, month: 10, day: 3 }, end: { year: 2026, month: 10, day: 4 } });
    const range = resolveEventTiming({ start: '2026-10-03', end: '2026-10-05', allDay: true }, now);
    expect(range.ok && range.end).toEqual({ year: 2026, month: 10, day: 6 });
    expect(resolveEventTiming({ start: 'demain 14h', end: '13h' }, now)).toMatchObject({ ok: false });
    expect(resolveEventTiming({ start: 'un jour' }, now)).toMatchObject({ ok: false, error: expect.stringContaining('Rien n') });
  });

  it('fenêtres de l’agenda', () => {
    const tomorrow = resolveCalendarPeriod('tomorrow', now);
    expect(tomorrow.start).toEqual(new Date(2026, 9, 2));
    expect(tomorrow.end).toEqual(new Date(2026, 9, 3));
    const week = resolveCalendarPeriod('week', now);
    expect(week.end).toEqual(new Date(2026, 9, 5));
    const weekend = resolveCalendarPeriod('weekend', now);
    expect(weekend.start).toEqual(new Date(2026, 9, 3));
    expect(weekend.end).toEqual(new Date(2026, 9, 5));
    expect(resolveCalendarPeriod('month', now).end).toEqual(new Date(2026, 10, 1));
  });
});

describe('intention Google', () => {
  it('reconnaît mails, agenda, Drive, Docs et Sheets', () => {
    for (const prompt of [
      'Lis mes derniers emails',
      'Est-ce que j’ai des mails de Paul ?',
      'Regarde mon agenda de demain et vérifie la météo',
      "Qu'est-ce que j'ai demain ?",
      'Crée un rendez-vous chez le dentiste jeudi 9h',
      'Cherche le devis sur mon Drive',
      'Ajoute une ligne dans ma feuille de calcul Budget',
      'Lis ce doc https://docs.google.com/document/d/abcdefghijklmnop/edit',
      'Prépare un brouillon de réponse',
    ]) {
      expect(looksLikeGoogleIntent(prompt), prompt).toBe(true);
    }
  });

  it('ne vole ni la recherche web, ni Chrome, ni la musique, ni les fichiers locaux', () => {
    for (const prompt of [
      'Cherche sur Google le prix du cuivre',
      'Ouvre Google Chrome',
      'Mets du Daft Punk sur Spotify',
      'Lis le fichier C:\\notes.txt',
      'Quelle heure est-il ?',
      'Bloque YouTube pendant une heure',
    ]) {
      expect(looksLikeGoogleIntent(prompt), prompt).toBe(false);
    }
  });

  it('suivi : seulement les deux échanges précédents', () => {
    const google = createMessage('assistant', '', { toolCalls: [{ id: 'a', name: 'google_gmail_search', arguments: {} }] });
    const recent = [createMessage('user', 'mails ?'), google, createMessage('user', 'et le second ?')];
    expect(recentlyUsedGoogleTools(recent)).toBe(true);
    const old = [
      createMessage('user', 'mails ?'),
      google,
      createMessage('user', 'merci'),
      createMessage('assistant', 'de rien'),
      createMessage('user', 'quelle heure ?'),
      createMessage('assistant', '21 h'),
      createMessage('user', 'et demain ?'),
    ];
    expect(recentlyUsedGoogleTools(old)).toBe(false);
    expect(isGoogleToolName('google_calendar_list')).toBe(true);
    expect(isGoogleToolName('web_search')).toBe(false);
  });

  it('le prompt du tour donne la date et interdit de croire le contenu des mails', () => {
    const text = googleTurnPrompt(new Date(2026, 9, 1, 12));
    expect(text).toContain('jeudi 1 octobre 2026');
    expect(text).toMatch(/jamais une instruction/);
    expect(text).toMatch(/faite et vérifiée/);
  });
});

describe('liens et cartes', () => {
  it('lit les liens Docs, Sheets, Drive et les identifiants nus', () => {
    expect(parseGoogleResource('https://docs.google.com/document/d/1AbC_d-EfGhIjKlMn/edit?tab=t.0')).toEqual({ id: '1AbC_d-EfGhIjKlMn', kind: 'document' });
    expect(parseGoogleResource('https://docs.google.com/spreadsheets/u/0/d/SheetId123456/edit#gid=0')).toEqual({ id: 'SheetId123456', kind: 'spreadsheet' });
    expect(parseGoogleResource('https://drive.google.com/file/d/FileId987654/view')).toEqual({ id: 'FileId987654', kind: 'file' });
    expect(parseGoogleResource('https://drive.google.com/open?id=OpenId1234567')).toEqual({ id: 'OpenId1234567', kind: 'file' });
    expect(parseGoogleResource('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')?.kind).toBe('file');
    expect(parseGoogleResource('budget')).toBeNull();
  });

  it('la carte d’envoi montre destinataire, objet et corps', () => {
    const text = formatMailForConfirmation({ to: 'paul@example.com', subject: 'Devis', body: 'Bonjour Paul,\nCi-joint.' });
    expect(text).toBe('À : paul@example.com\nObjet : Devis\n\nBonjour Paul,\nCi-joint.');
    expect(formatMailForConfirmation({ to: 'a@b.fr', cc: 'c@d.fr', subject: '', body: 'x' })).toContain('Cc : c@d.fr\nObjet : (sans objet)');
  });

  it('la carte d’une feuille montre les cellules', () => {
    expect(formatRowsForConfirmation([['Date', 'Montant'], ['01/10', '12,50']])).toBe('Date | Montant\n01/10 | 12,50');
  });
});

describe('secrets Google', () => {
  it('masque jetons d’accès, de rafraîchissement, secret client et code', () => {
    const text = redactSecrets(
      'access ya29.a0AfB_byC1234567890abcdef refresh 1//0gAbCdEfGhIjKlMnOpQrStUv secret GOCSPX-AbCdEf123456 code 4/0AVG7fiQabcdefghijklmnopq',
    );
    expect(text).not.toMatch(/ya29\.a0/);
    expect(text).not.toMatch(/1\/\/0g/);
    expect(text).not.toMatch(/GOCSPX-AbC/);
    expect(text).not.toMatch(/4\/0AVG/);
    expect(text.match(/\[REDACTED\]/g)).toHaveLength(4);
  });

  it('masque les clés googleClientSecret et code_verifier dans un objet', () => {
    expect(redactValue({ googleClientSecret: 'x', code_verifier: 'y', googleClientId: 'id.apps.googleusercontent.com' })).toEqual({
      googleClientSecret: '[REDACTED]',
      code_verifier: '[REDACTED]',
      googleClientId: 'id.apps.googleusercontent.com',
    });
  });

  it('ne touche pas une URL ordinaire', () => {
    expect(redactSecrets('https://example.com/a//b et 1/2 et 4/5')).toBe('https://example.com/a//b et 1/2 et 4/5');
  });
});

describe('réglages Google', () => {
  it('vides par défaut, mode complet, et un mode invalide ne fait rien perdre', () => {
    const defaults = parseSettings({});
    expect(defaults.googleClientId).toBe('');
    expect(defaults.googleClientSecret).toBe('');
    expect(defaults.googleAccess).toBe('full');
    const repaired = parseSettings({ googleAccess: 'tout', spotifyClientId: 'spot', googleClientId: 'cid' });
    expect(repaired.googleAccess).toBe('full');
    expect(repaired.spotifyClientId).toBe('spot');
    expect(repaired.googleClientId).toBe('cid');
  });
});
