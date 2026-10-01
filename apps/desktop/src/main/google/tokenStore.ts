import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GoogleAccessMode } from '@jarvis/core';

/** Sous-ensemble de `safeStorage` (DPAPI sous Windows) : injecté pour les tests. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface GoogleTokenRecord {
  version: 1;
  /** Client OAuth qui a reçu le consentement : le rafraîchissement doit utiliser le même. */
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  /** Horodatage (ms) après lequel le jeton d'accès est considéré expiré. */
  expiresAt: number;
  scopes: string[];
  mode: GoogleAccessMode;
  account: string | null;
  connectedAt: number;
  /** Google a refusé le jeton de rafraîchissement : reconnexion nécessaire. */
  needsReconsent: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecord(text: string): GoogleTokenRecord | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || value.version !== 1) return null;
    if (typeof value.clientId !== 'string' || typeof value.refreshToken !== 'string' || !value.refreshToken) return null;
    return {
      version: 1,
      clientId: value.clientId,
      clientSecret: typeof value.clientSecret === 'string' ? value.clientSecret : '',
      accessToken: typeof value.accessToken === 'string' ? value.accessToken : '',
      refreshToken: value.refreshToken,
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : 0,
      scopes: Array.isArray(value.scopes) ? value.scopes.filter((scope): scope is string => typeof scope === 'string') : [],
      mode: value.mode === 'readonly' ? 'readonly' : 'full',
      account: typeof value.account === 'string' ? value.account : null,
      connectedAt: typeof value.connectedAt === 'number' ? value.connectedAt : 0,
      needsReconsent: value.needsReconsent === true,
    };
  } catch {
    return null;
  }
}

/**
 * Jetons Google chiffrés avec `safeStorage` dans `userData/google-token.bin`.
 * Jamais en clair sur le disque : si le chiffrement du système n'est pas
 * disponible, le jeton reste en mémoire pour la session seulement.
 */
export class GoogleTokenStore {
  private memory: GoogleTokenRecord | null = null;

  constructor(
    private readonly filePath: () => string,
    private readonly cipher: SecretCipher,
  ) {}

  /** Vrai si le jeton survivra à un redémarrage (chiffrement disponible). */
  isPersistent(): boolean {
    try {
      return this.cipher.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async load(): Promise<GoogleTokenRecord | null> {
    if (this.memory) return this.memory;
    if (!this.isPersistent()) return null;
    let bytes: Buffer;
    try {
      bytes = await readFile(this.filePath());
    } catch {
      return null;
    }
    let text: string;
    try {
      text = this.cipher.decryptString(bytes);
    } catch {
      return null;
    }
    this.memory = parseRecord(text);
    return this.memory;
  }

  async save(record: GoogleTokenRecord): Promise<void> {
    this.memory = record;
    if (!this.isPersistent()) return;
    const encrypted = this.cipher.encryptString(JSON.stringify(record));
    await mkdir(dirname(this.filePath()), { recursive: true });
    await writeFile(this.filePath(), encrypted, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    this.memory = null;
    await rm(this.filePath(), { force: true });
  }
}
