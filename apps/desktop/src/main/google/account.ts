import {
  GOOGLE_REDIRECT_URI,
  canReadGoogle,
  canWriteGoogle,
  describeGoogleAccess,
  googleScopesFor,
  type GoogleAccessMode,
  type GoogleService,
} from '@jarvis/core';
import type {
  GoogleConfigDraft,
  GoogleConnectResult,
  GoogleDisconnectResult,
  GoogleStatus,
} from '../../shared/ipc.js';
import {
  GoogleError,
  notConfigured,
  notConnected,
  readonlyMode,
  reconsentRequired,
  scopeMissing,
} from './errors.js';
import type { GoogleOAuth } from './oauth.js';
import type { GoogleTokenRecord, GoogleTokenStore } from './tokenStore.js';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  access: GoogleAccessMode;
}

export type { GoogleConfigDraft, GoogleConnectResult, GoogleDisconnectResult, GoogleStatus };

export interface GoogleAccountDeps {
  store: GoogleTokenStore;
  oauth: GoogleOAuth;
  getConfig: () => GoogleConfig;
  fetch: typeof fetch;
  now?: () => number;
  /** Journal sans secret (jamais un jeton, jamais un code). */
  log?: (line: string) => void;
}

const EXPIRY_MARGIN_MS = 60_000;

/**
 * Compte Google de l'utilisateur : consentement, jetons chiffrés,
 * rafraîchissement, révocation. Les outils ne voient que `getAccessToken`
 * et les vérifications d'autorisation.
 */
export class GoogleAccount {
  private record: GoogleTokenRecord | null = null;
  private loading: Promise<void> | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: GoogleAccountDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Lit les jetons chiffrés. Appelé au démarrage sans être attendu : la fenêtre ne patiente pas. */
  init(): Promise<void> {
    this.loading ??= this.deps.store
      .load()
      .then((record) => {
        this.record = record;
      })
      .catch(() => {
        this.record = null;
      });
    return this.loading;
  }

  isConnected(): boolean {
    return this.record !== null;
  }

  effectiveMode(): GoogleAccessMode | null {
    return this.effectiveModeFor(this.record, this.deps.getConfig().access);
  }

  canWriteNow(): boolean {
    return this.effectiveMode() === 'full';
  }

  /** Lève l'erreur française adaptée si la lecture n'est pas possible. */
  ensureRead(service: GoogleService): void {
    const record = this.requireRecord();
    if (record.scopes.length > 0 && !canReadGoogle(service, record.scopes)) throw scopeMissing(service, false);
  }

  ensureWrite(service: GoogleService): void {
    const record = this.requireRecord();
    if (this.effectiveMode() !== 'full') throw readonlyMode();
    if (record.scopes.length > 0 && !canWriteGoogle(service, record.scopes)) throw scopeMissing(service, true);
  }

  async status(draft?: GoogleConfigDraft): Promise<GoogleStatus> {
    await this.init();
    return this.snapshot(draft);
  }

  async connect(draft?: GoogleConfigDraft): Promise<GoogleConnectResult> {
    await this.init();
    const config = this.resolve(draft);
    if (!config.clientId) return { ok: false, error: notConfigured().message, status: this.snapshot(draft) };
    try {
      const scopes = googleScopesFor(config.access);
      const tokens = await this.deps.oauth.authorize(
        { clientId: config.clientId, clientSecret: config.clientSecret },
        scopes,
      );
      if (!tokens.refreshToken) {
        throw new GoogleError(
          'server',
          "Google n'a pas renvoyé de jeton de rafraîchissement. Retire Jarvis sur myaccount.google.com/permissions puis relance « Se connecter ».",
        );
      }
      const granted = tokens.scopes.length > 0 ? tokens.scopes : scopes;
      const account = await this.fetchAccount(tokens.accessToken, granted);
      const record: GoogleTokenRecord = {
        version: 1,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: this.now() + tokens.expiresIn * 1000 - EXPIRY_MARGIN_MS,
        scopes: granted,
        mode: config.access,
        account,
        connectedAt: this.now(),
        needsReconsent: false,
      };
      await this.deps.store.save(record);
      this.record = record;
      this.deps.log?.(`[google] connecté (${config.access}, ${granted.length} autorisations)`);
      return { ok: true, status: this.snapshot(draft) };
    } catch (error) {
      const message = error instanceof GoogleError ? error.message : 'La connexion Google a échoué. Réessaie.';
      this.deps.log?.(`[google] connexion échouée : ${error instanceof GoogleError ? error.kind : 'erreur'}`);
      return { ok: false, error: message, status: this.snapshot(draft) };
    }
  }

  cancelConnect(): void {
    this.deps.oauth.cancel();
  }

  /** Révoque chez Google (au mieux), puis efface les jetons de ce PC dans tous les cas. */
  async disconnect(): Promise<GoogleDisconnectResult> {
    await this.init();
    const record = this.record;
    let revoked = false;
    if (record) {
      try {
        revoked = await this.deps.oauth.revoke(record.refreshToken);
      } catch {
        revoked = false;
      }
    }
    this.record = null;
    this.refreshing = null;
    await this.deps.store.clear();
    this.deps.log?.(`[google] déconnecté (révocation ${revoked ? 'confirmée' : 'non confirmée'})`);
    const message = !record
      ? "Aucun compte Google n'était connecté. Rien n'est conservé sur ce PC."
      : revoked
        ? 'Accès révoqué chez Google et jetons effacés de ce PC.'
        : "Jetons effacés de ce PC. Google n'a pas pu confirmer la révocation : retire Jarvis sur myaccount.google.com/permissions pour être sûr.";
    return { revoked, message, status: this.snapshot() };
  }

  /** Jeton d'accès valide ; rafraîchi si expiré (ou si `force`, après un 401). */
  async getAccessToken(force = false): Promise<string> {
    await this.init();
    const record = this.requireRecord();
    if (!force && record.accessToken && this.now() < record.expiresAt) return record.accessToken;
    this.refreshing ??= this.refresh(record).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(record: GoogleTokenRecord): Promise<string> {
    try {
      const tokens = await this.deps.oauth.refresh(
        { clientId: record.clientId, clientSecret: record.clientSecret },
        record.refreshToken,
      );
      const next: GoogleTokenRecord = {
        ...record,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? record.refreshToken,
        expiresAt: this.now() + tokens.expiresIn * 1000 - EXPIRY_MARGIN_MS,
        scopes: tokens.scopes.length > 0 ? tokens.scopes : record.scopes,
      };
      if (this.record === record) {
        this.record = next;
        await this.deps.store.save(next);
      }
      return next.accessToken;
    } catch (error) {
      if (error instanceof GoogleError && error.kind === 'reconsent' && this.record === record) {
        const flagged: GoogleTokenRecord = { ...record, accessToken: '', expiresAt: 0, needsReconsent: true };
        this.record = flagged;
        await this.deps.store.save(flagged).catch(() => undefined);
        this.deps.log?.('[google] reconnexion nécessaire (jeton de rafraîchissement refusé)');
      }
      throw error;
    }
  }

  private requireRecord(): GoogleTokenRecord {
    const record = this.record;
    if (!record) throw notConnected();
    if (record.needsReconsent) throw reconsentRequired('needsReconsent');
    return record;
  }

  private resolve(draft?: GoogleConfigDraft): GoogleConfig {
    const saved = this.deps.getConfig();
    return {
      clientId: (draft?.clientId ?? saved.clientId).trim(),
      clientSecret: (draft?.clientSecret ?? saved.clientSecret).trim(),
      access: draft?.access ?? saved.access,
    };
  }

  private snapshot(draft?: GoogleConfigDraft): GoogleStatus {
    const config = this.resolve(draft);
    const record = this.record;
    const access = this.effectiveModeFor(record, config.access);
    return {
      configured: Boolean(config.clientId || record?.clientId),
      connected: record !== null,
      needsReconsent: record?.needsReconsent ?? false,
      connecting: this.deps.oauth.isAuthorizing(),
      account: record?.account ?? null,
      access,
      requestedAccess: config.access,
      services: describeGoogleAccess(record?.scopes ?? [], access ?? config.access).map((service) =>
        record ? service : { ...service, read: false, write: false, readMissing: false, writeMissing: false },
      ),
      persistent: this.deps.store.isPersistent(),
      redirectUri: GOOGLE_REDIRECT_URI,
      clientMismatch: Boolean(record && config.clientId && config.clientId !== record.clientId),
      connectedAt: record?.connectedAt ?? null,
    };
  }

  private effectiveModeFor(record: GoogleTokenRecord | null, requested: GoogleAccessMode): GoogleAccessMode | null {
    if (!record) return null;
    return record.mode === 'readonly' || requested === 'readonly' ? 'readonly' : 'full';
  }

  /** Adresse du compte, pour l'afficher. Au mieux : Gmail, sinon Drive. */
  private async fetchAccount(accessToken: string, scopes: string[]): Promise<string | null> {
    const attempts: Array<{ url: string; pick: (data: Record<string, unknown>) => unknown }> = [];
    if (canReadGoogle('gmail', scopes) || canWriteGoogle('gmail', scopes)) {
      attempts.push({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', pick: (data) => data.emailAddress });
    }
    if (canReadGoogle('drive', scopes)) {
      attempts.push({
        url: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
        pick: (data) => (data.user as Record<string, unknown> | undefined)?.emailAddress,
      });
    }
    for (const attempt of attempts) {
      try {
        const response = await this.deps.fetch(attempt.url, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) continue;
        const email = attempt.pick((await response.json()) as Record<string, unknown>);
        if (typeof email === 'string' && email) return email;
      } catch {
        // Le compte n'est qu'affiché : un échec ici ne bloque pas la connexion.
      }
    }
    return null;
  }
}
