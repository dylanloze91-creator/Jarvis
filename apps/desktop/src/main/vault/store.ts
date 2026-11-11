import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { blankSecrets, fillExistingSecrets, secretsFromSettings, type Settings } from '@jarvis/core';
import type { SecretCipher } from '../google/tokenStore.js';

const FILE = 'coffre.bin';

interface VaultFile {
  version: 1;
  secrets: Record<string, string>;
}

function parseVault(text: string): Record<string, string> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') return {};
  const secrets = (value as VaultFile).secrets;
  if (!secrets || typeof secrets !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(secrets)) {
    if (typeof item === 'string' && item.trim()) out[key] = item;
  }
  return out;
}

/** Clés chiffrées par safeStorage dans `userData/coffre.bin`. */
export class KeyVault {
  private secrets: Record<string, string> = {};
  private loaded = false;
  private unreadable = false;

  constructor(
    private readonly userData: () => string,
    private readonly cipher: SecretCipher,
  ) {}

  encryptionAvailable(): boolean {
    try {
      return this.cipher.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  filePath(): string {
    return join(this.userData(), FILE);
  }

  secretsNow(): Record<string, string> {
    return { ...this.secrets };
  }

  isUnreadable(): boolean {
    return this.unreadable;
  }

  async load(): Promise<Record<string, string>> {
    if (this.loaded) return { ...this.secrets };
    this.loaded = true;
    if (!this.encryptionAvailable()) return {};
    let bytes: Buffer;
    try {
      bytes = await readFile(this.filePath());
    } catch {
      return {};
    }
    try {
      this.secrets = parseVault(this.cipher.decryptString(bytes));
    } catch {
      await this.quarantine();
      this.unreadable = true;
      this.secrets = {};
    }
    return { ...this.secrets };
  }

  private async quarantine(): Promise<void> {
    const dest = join(this.userData(), 'coffre.illisible.bin');
    try {
      await rename(this.filePath(), dest);
    } catch {
      await rename(this.filePath(), join(this.userData(), `coffre.illisible-${Date.now()}.bin`)).catch(() => undefined);
    }
  }

  async save(secrets: Record<string, string>): Promise<void> {
    this.secrets = { ...secrets };
    this.loaded = true;
    if (!this.encryptionAvailable()) return;
    const body: VaultFile = { version: 1, secrets: this.secrets };
    const encrypted = this.cipher.encryptString(JSON.stringify(body));
    await mkdir(dirname(this.filePath()), { recursive: true });
    const tmp = `${this.filePath()}.tmp`;
    await writeFile(tmp, encrypted, { mode: 0o600 });
    await rename(tmp, this.filePath());
  }

  /**
   * Une clé en clair dans les réglages part dans le coffre.
   * `settings.json` est à réécrire sans elle. Sans chiffrement : on ne touche à rien.
   */
  async migrate(settings: Settings): Promise<{ disk: Settings; memory: Settings; changed: boolean }> {
    if (!this.encryptionAvailable()) return { disk: settings, memory: settings, changed: false };
    const found = secretsFromSettings(settings);
    const current = await this.load();
    const secrets = { ...current, ...found };
    const hadPlain = Object.keys(found).length > 0;
    if (hadPlain || Object.keys(secrets).length !== Object.keys(current).length) await this.save(secrets);
    const disk = blankSecrets(settings);
    return { disk, memory: await this.apply(disk), changed: hadPlain };
  }

  /** Fusionne le coffre dans les réglages en mémoire. Le disque reste vide. */
  async apply(settings: Settings): Promise<Settings> {
    if (!this.encryptionAvailable()) return settings;
    const secrets = await this.load();
    return fillExistingSecrets(blankSecrets(settings), secrets);
  }

  async clearFile(): Promise<void> {
    this.secrets = {};
    await rm(this.filePath(), { force: true });
  }
}
