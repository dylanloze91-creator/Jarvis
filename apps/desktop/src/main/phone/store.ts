import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PHONE_MAX_DEVICES, cleanDeviceName } from '@jarvis/core';

/**
 * 5.0.63 — état du téléphone, dans `userData/phone.json` (hors de `settings.json` : le brouillon
 * des réglages ne doit pas effacer un appareil relié pendant qu'il est ouvert). Seule l'empreinte
 * SHA-256 de chaque jeton est gardée : le jeton lui-même ne vit que sur le téléphone.
 */
export interface PhoneDevice {
  id: string;
  name: string;
  createdAt: number;
}

interface StoredDevice extends PhoneDevice {
  tokenHash: string;
}

interface PhoneFile {
  enabled: boolean;
  devices: StoredDevice[];
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function readFileState(raw: string): PhoneFile {
  const data = JSON.parse(raw) as Partial<PhoneFile>;
  const devices = Array.isArray(data.devices)
    ? data.devices.filter(
        (device): device is StoredDevice =>
          !!device &&
          typeof device.id === 'string' &&
          typeof device.name === 'string' &&
          typeof device.createdAt === 'number' &&
          typeof device.tokenHash === 'string' &&
          /^[0-9a-f]{64}$/.test(device.tokenHash),
      )
    : [];
  return { enabled: data.enabled === true, devices };
}

export class PhoneStore {
  private state: PhoneFile = { enabled: false, devices: [] };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: () => string) {}

  static inUserData(userData: () => string): PhoneStore {
    return new PhoneStore(() => join(userData(), 'phone.json'));
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.state = readFileState(await readFile(this.filePath(), 'utf8'));
    } catch {
      this.state = { enabled: false, devices: [] };
    }
    this.loaded = true;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  devices(): PhoneDevice[] {
    return this.state.devices.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load();
    this.state = { ...this.state, enabled };
    await this.save();
  }

  /** Nouvel appareil : le jeton n'est rendu qu'une fois, au téléphone. */
  async addDevice(name: string | undefined, now = Date.now()): Promise<{ device: PhoneDevice; token: string }> {
    await this.load();
    const token = randomBytes(32).toString('base64url');
    const device: StoredDevice = { id: randomUUID(), name: cleanDeviceName(name), createdAt: now, tokenHash: hashToken(token) };
    // Au-delà de la limite, le plus ancien est retiré.
    const kept = this.state.devices.slice(-(PHONE_MAX_DEVICES - 1));
    this.state = { ...this.state, devices: [...kept, device] };
    await this.save();
    return { device: { id: device.id, name: device.name, createdAt: device.createdAt }, token };
  }

  async removeDevice(id: string): Promise<boolean> {
    await this.load();
    const before = this.state.devices.length;
    this.state = { ...this.state, devices: this.state.devices.filter((device) => device.id !== id) };
    if (this.state.devices.length === before) return false;
    await this.save();
    return true;
  }

  /** Appareil du jeton, comparé en temps constant ; `null` si inconnu ou retiré. */
  verify(token: string | null | undefined): PhoneDevice | null {
    if (!token || token.length > 200) return null;
    const candidate = Buffer.from(hashToken(token), 'hex');
    let found: StoredDevice | null = null;
    for (const device of this.state.devices) {
      const stored = Buffer.from(device.tokenHash, 'hex');
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) found = device;
    }
    return found ? { id: found.id, name: found.name, createdAt: found.createdAt } : null;
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const target = this.filePath();
        await mkdir(dirname(target), { recursive: true });
        const temp = `${target}.tmp`;
        await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temp, target);
      });
    return this.writing;
  }
}
