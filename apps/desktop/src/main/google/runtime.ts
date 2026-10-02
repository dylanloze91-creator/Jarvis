import { join } from 'node:path';
import type { Settings } from '@jarvis/core';
import { GoogleAccount } from './account.js';
import { CalendarService } from './calendar.js';
import type { GoogleWorkspaceContext } from './context.js';
import { DocsService, DriveService } from './drive.js';
import { GmailService } from './gmail.js';
import { GoogleApiClient } from './http.js';
import { GoogleOAuth } from './oauth.js';
import { SheetsService } from './sheets.js';
import { GoogleTokenStore, type SecretCipher } from './tokenStore.js';

export interface GoogleRuntimeDeps {
  userDataPath: () => string;
  cipher: SecretCipher;
  openExternal: (url: string) => Promise<unknown>;
  getSettings: () => Settings;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => Date;
  timeZone?: () => string;
  oauthPort?: number;
  authTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetryWaitMs?: number;
}

export interface GoogleRuntime {
  account: GoogleAccount;
  gmail: GmailService;
  calendar: CalendarService;
  drive: DriveService;
  docs: DocsService;
  sheets: SheetsService;
  /** Horloge des services : les cartes de confirmation doivent résoudre « demain » avec la même. */
  now: () => Date;
}

export const GOOGLE_TOKEN_FILE = 'google-token.bin';

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
}

/** Assemble Google Workspace pour le processus principal (ou les tests, avec un faux `fetch`). */
export function createGoogleRuntime(deps: GoogleRuntimeDeps): GoogleRuntime {
  const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const store = new GoogleTokenStore(() => join(deps.userDataPath(), GOOGLE_TOKEN_FILE), deps.cipher);
  const oauth = new GoogleOAuth({
    fetch: fetchImpl,
    openExternal: deps.openExternal,
    port: deps.oauthPort,
    authTimeoutMs: deps.authTimeoutMs,
  });
  const account = new GoogleAccount({
    store,
    oauth,
    fetch: fetchImpl,
    log: deps.log,
    getConfig: () => {
      const settings = deps.getSettings();
      return {
        clientId: settings.googleClientId,
        clientSecret: settings.googleClientSecret,
        access: settings.googleAccess,
      };
    },
  });
  const api = new GoogleApiClient({
    fetch: fetchImpl,
    getAccessToken: (force) => account.getAccessToken(force),
    sleep: deps.sleep,
    maxRetryWaitMs: deps.maxRetryWaitMs,
  });
  const ctx: GoogleWorkspaceContext = {
    api,
    account,
    now: deps.now ?? (() => new Date()),
    timeZone: deps.timeZone ?? localTimeZone,
  };
  return {
    account,
    gmail: new GmailService(ctx),
    calendar: new CalendarService(ctx),
    drive: new DriveService(ctx),
    docs: new DocsService(ctx),
    sheets: new SheetsService(ctx),
    now: ctx.now,
  };
}
