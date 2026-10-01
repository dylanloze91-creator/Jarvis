import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, get as httpGet, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_SCOPE, googleScopesFor, parseSettings, type GoogleAccessMode, type Settings } from '@jarvis/core';
import { createGoogleRuntime, GOOGLE_TOKEN_FILE, type GoogleRuntime } from './runtime.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FakeGoogle, fakeCipher } from './fakeGoogle.testkit.js';
import { GoogleError } from './errors.js';
import { parseRetryAfter } from './http.js';

function visit(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

interface Harness {
  fake: FakeGoogle;
  runtime: GoogleRuntime;
  dir: string;
  opened: string[];
  pages: Array<{ status: number; body: string }>;
  logs: string[];
  sleeps: number[];
  settings: () => Settings;
  setSettings: (patch: Partial<Settings>) => void;
  consent: { outcome: 'allow' | 'deny' | 'ignore' };
}

let dirs: string[] = [];

function harness(options: { access?: GoogleAccessMode; port?: number; authTimeoutMs?: number; withSecret?: boolean } = {}): Harness {
  const fake = new FakeGoogle();
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-google-'));
  dirs.push(dir);
  let settings = parseSettings({
    googleClientId: FAKE_CLIENT_ID,
    googleClientSecret: options.withSecret === false ? '' : FAKE_CLIENT_SECRET,
    googleAccess: options.access ?? 'full',
  });
  const opened: string[] = [];
  const pages: Array<{ status: number; body: string }> = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const consent: Harness['consent'] = { outcome: 'allow' };
  const runtime = createGoogleRuntime({
    userDataPath: () => dir,
    cipher: fakeCipher,
    fetch: fake.fetch,
    openExternal: async (url) => {
      opened.push(url);
      if (consent.outcome === 'ignore') return;
      const back = fake.consent(url, consent.outcome);
      // Le navigateur revient sur la boucle locale après le clic.
      setTimeout(() => void visit(back).then((page) => pages.push(page)), 5);
    },
    getSettings: () => settings,
    log: (line) => logs.push(line),
    oauthPort: options.port ?? 0,
    authTimeoutMs: options.authTimeoutMs,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => new Date(2026, 9, 1, 21, 14),
    timeZone: () => 'Europe/Paris',
  });
  return {
    fake,
    runtime,
    dir,
    opened,
    pages,
    logs,
    sleeps,
    consent,
    settings: () => settings,
    setSettings: (patch) => {
      settings = parseSettings({ ...settings, ...patch });
    },
  };
}

async function connected(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  const h = harness(options);
  const result = await h.runtime.account.connect();
  if (!result.ok) throw new Error(result.error);
  return h;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('connexion OAuth (bureau, PKCE, boucle locale)', () => {
  it('ouvre le navigateur système avec PKCE S256, hors ligne, et enregistre des jetons chiffrés', async () => {
    const h = harness();
    const result = await h.runtime.account.connect();
    expect(result.ok).toBe(true);

    const url = new URL(h.opened[0]!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(FAKE_CLIENT_ID);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(googleScopesFor('full'));
    expect(url.searchParams.has('client_secret')).toBe(false);

    const status = await h.runtime.account.status();
    expect(status).toMatchObject({ connected: true, needsReconsent: false, account: 'thedexios@gmail.com', access: 'full', persistent: true });
    expect(status.services.every((service) => service.read)).toBe(true);
    expect(h.pages[0]?.body).toContain('Google est connecté à Jarvis');

    const bytes = await readFile(join(h.dir, GOOGLE_TOKEN_FILE));
    const raw = bytes.toString('latin1');
    expect(raw).not.toContain('ya29.');
    expect(raw).not.toContain('1//0');
    expect(raw).not.toContain(FAKE_CLIENT_SECRET);
    expect(JSON.parse(fakeCipher.decryptString(bytes))).toMatchObject({ clientId: FAKE_CLIENT_ID, mode: 'full' });
    if (process.platform !== 'win32') expect((await stat(join(h.dir, GOOGLE_TOKEN_FILE))).mode & 0o777).toBe(0o600);
  });

  it('écoute par défaut sur 127.0.0.1:53125, et prend un port libre si 53125 est occupé', async () => {
    const busy: Server = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', () => resolve()));
    const port = (busy.address() as AddressInfo).port;
    try {
      const h = harness({ port });
      expect((await h.runtime.account.connect()).ok).toBe(true);
      const redirect = new URL(new URL(h.opened[0]!).searchParams.get('redirect_uri')!);
      expect(redirect.hostname).toBe('127.0.0.1');
      expect(Number(redirect.port)).not.toBe(port);
    } finally {
      busy.close();
    }
    const defaults = harness({ port: undefined as unknown as number });
    // Port réel par défaut : on vérifie seulement l'URL, sans terminer la connexion.
    const runtime = createGoogleRuntime({
      userDataPath: () => defaults.dir,
      cipher: fakeCipher,
      fetch: defaults.fake.fetch,
      openExternal: async (url) => {
        expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:53125/callback');
        runtime.account.cancelConnect();
      },
      getSettings: () => defaults.settings(),
    });
    const result = await runtime.account.connect();
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('annulée') });
  });

  it('refus dans Google, annulation et délai dépassé : message français, rien enregistré', async () => {
    const denied = harness();
    denied.consent.outcome = 'deny';
    const refused = await denied.runtime.account.connect();
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('utilisateurs test') });
    expect(refused.status.connected).toBe(false);

    const slow = harness({ authTimeoutMs: 50 });
    slow.consent.outcome = 'ignore';
    const late = await slow.runtime.account.connect();
    expect(late).toMatchObject({ ok: false, error: expect.stringContaining('Audience') });
    await expect(readFile(join(slow.dir, GOOGLE_TOKEN_FILE))).rejects.toThrow();
  });

  it('secret absent alors que Google l’exige : explique où le coller', async () => {
    const h = harness({ withSecret: false });
    const result = await h.runtime.account.connect();
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('secret du client') });
  });

  it('sans identifiant client : pas de navigateur, guide vers les réglages', async () => {
    const h = harness();
    h.setSettings({ googleClientId: '' });
    const result = await h.runtime.account.connect();
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Réglages → Google') });
    expect(h.opened).toHaveLength(0);
  });

  it('lecture seule : ne demande que les autorisations de lecture', async () => {
    const h = await connected({ access: 'readonly' });
    expect(new URL(h.opened[0]!).searchParams.get('scope')?.split(' ')).toEqual(googleScopesFor('readonly'));
    const status = await h.runtime.account.status();
    expect(status.access).toBe('readonly');
    expect(status.services.some((service) => service.write)).toBe(false);
  });
});

describe('jetons : rafraîchissement, reconnexion, révocation', () => {
  it('rafraîchit un jeton expiré et rejoue la requête après un 401', async () => {
    const h = await connected();
    h.fake.expireAccessTokens();
    const result = await h.runtime.gmail.search({});
    expect(result.text).toContain('Devis cuisine');
    const grants = h.fake.calls.filter((call) => call.url.pathname === '/token').map((call) => new URLSearchParams(call.body).get('grant_type'));
    expect(grants).toEqual(['authorization_code', 'refresh_token']);
  });

  it('jeton de rafraîchissement refusé (7 jours en mode Test) : reconnexion demandée en français', async () => {
    const h = await connected();
    h.fake.revokeEverything();
    const error = await h.runtime.gmail.search({}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GoogleError);
    expect((error as GoogleError).kind).toBe('reconsent');
    expect((error as GoogleError).message).toMatch(/7 jours.*Se reconnecter/);
    const status = await h.runtime.account.status();
    expect(status).toMatchObject({ connected: true, needsReconsent: true });
    // Plus aucun appel réseau tant qu'il ne s'est pas reconnecté.
    const before = h.fake.calls.length;
    await expect(h.runtime.calendar.list({})).rejects.toMatchObject({ kind: 'reconsent' });
    expect(h.fake.calls.length).toBe(before);

    expect((await h.runtime.account.connect()).ok).toBe(true);
    expect((await h.runtime.account.status()).needsReconsent).toBe(false);
  });

  it('401 persistant après rafraîchissement : reconnexion, pas de boucle', async () => {
    const h = await connected();
    const unauthorized = () => new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 });
    h.fake.overrides.push(
      { match: (call) => call.url.host === 'gmail.googleapis.com', respond: unauthorized },
      { match: (call) => call.url.host === 'gmail.googleapis.com', respond: unauthorized },
    );
    await expect(h.runtime.gmail.search({})).rejects.toMatchObject({ kind: 'reconsent' });
  });

  it('se déconnecter révoque chez Google et efface le fichier, même si la révocation échoue', async () => {
    const h = await connected();
    const refresh = [...h.fake.refreshTokens.keys()][0]!;
    const result = await h.runtime.account.disconnect();
    expect(result).toMatchObject({ revoked: true, message: expect.stringContaining('révoqué') });
    expect(h.fake.revoked).toEqual([refresh]);
    await expect(readFile(join(h.dir, GOOGLE_TOKEN_FILE))).rejects.toThrow();
    expect(result.status.connected).toBe(false);

    const offline = await connected();
    offline.fake.overrides.push({ match: (call) => call.url.pathname === '/revoke', respond: () => { throw new TypeError('fetch failed'); } });
    const wiped = await offline.runtime.account.disconnect();
    expect(wiped).toMatchObject({ revoked: false, message: expect.stringContaining('myaccount.google.com/permissions') });
    await expect(readFile(join(offline.dir, GOOGLE_TOKEN_FILE))).rejects.toThrow();
  });

  it('jamais de jeton, de code ni de secret dans le journal', async () => {
    const h = await connected();
    h.fake.revokeEverything();
    await h.runtime.gmail.search({}).catch(() => undefined);
    await h.runtime.account.disconnect();
    const text = h.logs.join('\n');
    expect(text).toContain('[google]');
    expect(text).not.toMatch(/ya29\.|1\/\/0|GOCSPX|4\/0/);
  });

  it('chiffrement Windows indisponible : jeton en mémoire seulement, jamais en clair sur le disque', async () => {
    const h = harness();
    const runtime = createGoogleRuntime({
      userDataPath: () => h.dir,
      cipher: { ...fakeCipher, isEncryptionAvailable: () => false },
      fetch: h.fake.fetch,
      openExternal: async (url) => {
        setTimeout(() => void visit(h.fake.consent(url)), 5);
      },
      getSettings: () => h.settings(),
      oauthPort: 0,
    });
    const result = await runtime.account.connect();
    expect(result.ok).toBe(true);
    expect(result.status.persistent).toBe(false);
    await expect(readFile(join(h.dir, GOOGLE_TOKEN_FILE))).rejects.toThrow();
  });
});

describe('erreurs de l’API', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await connected();
  });

  it('403 autorisation décochée : dit laquelle et comment la rendre', async () => {
    const partial = harness();
    partial.fake.grant = [GOOGLE_SCOPE.calendarEvents, GOOGLE_SCOPE.driveRead];
    expect((await partial.runtime.account.connect()).ok).toBe(true);
    // Vérifié localement, sans appel réseau inutile…
    await expect(partial.runtime.gmail.search({})).rejects.toMatchObject({ kind: 'scope_missing', message: expect.stringContaining('coche Gmail') });
    // …et traduit aussi si Google répond 403 lui-même.
    h.fake.overrides.push({
      match: (call) => call.url.host === 'sheets.googleapis.com',
      respond: () =>
        new Response(
          JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }),
          { status: 403 },
        ),
    });
    await expect(h.runtime.sheets.read({ spreadsheet: 'sheet-budget' })).rejects.toMatchObject({ kind: 'scope_missing', message: expect.stringContaining('Sheets') });
  });

  it('403 API non activée : nomme l’API à activer', async () => {
    h.fake.overrides.push({
      match: (call) => call.url.host === 'docs.googleapis.com',
      respond: () =>
        new Response(
          JSON.stringify({ error: { code: 403, message: 'Google Docs API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }] } }),
          { status: 403 },
        ),
    });
    await expect(h.runtime.docs.read({ document: 'docNotesAtlas01' })).rejects.toMatchObject({ kind: 'api_disabled', message: expect.stringContaining('Google Docs API') });
  });

  it('429 avec Retry-After court : attend puis réessaie', async () => {
    h.fake.overrides.push({
      match: (call) => call.url.host === 'www.googleapis.com' && call.url.pathname.includes('/calendar/'),
      respond: () => new Response('{"error":{"code":429,"message":"Rate Limit Exceeded"}}', { status: 429, headers: { 'Retry-After': '2' } }),
    });
    const result = await h.runtime.calendar.list({ period: 'tomorrow' });
    expect(result.text).toContain('Rien dans ton agenda demain');
    expect(h.sleeps).toEqual([2_000]);
  });

  it('429 avec Retry-After long : ne bloque pas, donne le délai', async () => {
    h.fake.overrides.push({
      match: (call) => call.url.host === 'gmail.googleapis.com',
      respond: () => new Response('{"error":{"code":429,"message":"Too many requests"}}', { status: 429, headers: { 'Retry-After': '120' } }),
    });
    await expect(h.runtime.gmail.search({})).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 120, message: expect.stringContaining('120 s') });
    expect(h.sleeps).toEqual([]);
  });

  it('un POST n’est pas rejoué après un 503 (pas de doublon)', async () => {
    h.fake.overrides.push({
      match: (call) => call.method === 'POST' && call.url.host === 'docs.googleapis.com',
      respond: () => new Response('{"error":{"code":503}}', { status: 503 }),
    });
    await expect(h.runtime.docs.create({ title: 'Test' })).rejects.toMatchObject({ kind: 'server' });
    expect(h.fake.calls.filter((call) => call.method === 'POST' && call.url.host === 'docs.googleapis.com')).toHaveLength(1);
  });

  it('réseau coupé : message français, détail technique sans secret', async () => {
    h.fake.overrides.push({ match: () => true, respond: () => { throw new TypeError('fetch failed'); } });
    const error = (await h.runtime.drive.search({ query: 'devis' }).catch((caught: unknown) => caught)) as GoogleError;
    expect(error.kind).toBe('network');
    expect(error.message).toMatch(/Impossible de joindre Drive/);
    expect(error.technicalDetail).not.toMatch(/ya29/);
  });

  it('lit Retry-After en secondes ou en date HTTP', () => {
    expect(parseRetryAfter('3')).toBe(3_000);
    expect(parseRetryAfter(new Date(Date.UTC(2026, 9, 1, 12, 0, 30)).toUTCString(), Date.UTC(2026, 9, 1, 12, 0, 0))).toBe(30_000);
    expect(parseRetryAfter('demain')).toBeNull();
  });
});
