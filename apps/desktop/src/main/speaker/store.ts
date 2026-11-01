import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SPEAKER_MAX_SPEAKERS, cleanSpeakerName } from '@jarvis/core';

/**
 * 5.0.64 — état des enceintes, dans `userData/speakers.json` (hors de `settings.json`, comme le
 * téléphone : le brouillon des réglages ne peut pas effacer une enceinte, et les réglages figés
 * ne bougent pas). Seule l'empreinte SHA-256 de chaque jeton est gardée : le jeton lui-même vit
 * dans le `secrets.h` de la carte.
 */
export interface Speaker {
  id: string;
  name: string;
  createdAt: number;
}

interface StoredSpeaker extends Speaker {
  tokenHash: string;
}

interface SpeakerFile {
  enabled: boolean;
  speakers: StoredSpeaker[];
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function readFileState(raw: string): SpeakerFile {
  const data = JSON.parse(raw) as Partial<SpeakerFile>;
  const speakers = Array.isArray(data.speakers)
    ? data.speakers.filter(
        (speaker): speaker is StoredSpeaker =>
          !!speaker &&
          typeof speaker.id === 'string' &&
          typeof speaker.name === 'string' &&
          typeof speaker.createdAt === 'number' &&
          typeof speaker.tokenHash === 'string' &&
          /^[0-9a-f]{64}$/.test(speaker.tokenHash),
      )
    : [];
  return { enabled: data.enabled === true, speakers };
}

export class SpeakerStore {
  private state: SpeakerFile = { enabled: false, speakers: [] };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: () => string) {}

  static inUserData(userData: () => string): SpeakerStore {
    return new SpeakerStore(() => join(userData(), 'speakers.json'));
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.state = readFileState(await readFile(this.filePath(), 'utf8'));
    } catch {
      this.state = { enabled: false, speakers: [] };
    }
    this.loaded = true;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  speakers(): Speaker[] {
    return this.state.speakers.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load();
    this.state = { ...this.state, enabled };
    await this.save();
  }

  /** Nouvelle enceinte : le jeton n'est rendu qu'une fois, pour le bloc `secrets.h`. */
  async addSpeaker(name: string | undefined, now = Date.now()): Promise<{ speaker: Speaker; token: string }> {
    await this.load();
    const token = randomBytes(32).toString('base64url');
    const speaker: StoredSpeaker = { id: randomUUID(), name: cleanSpeakerName(name), createdAt: now, tokenHash: hashToken(token) };
    // Au-delà de la limite, la plus ancienne est retirée.
    const kept = this.state.speakers.slice(-(SPEAKER_MAX_SPEAKERS - 1));
    this.state = { ...this.state, speakers: [...kept, speaker] };
    await this.save();
    return { speaker: { id: speaker.id, name: speaker.name, createdAt: speaker.createdAt }, token };
  }

  async removeSpeaker(id: string): Promise<boolean> {
    await this.load();
    const before = this.state.speakers.length;
    this.state = { ...this.state, speakers: this.state.speakers.filter((speaker) => speaker.id !== id) };
    if (this.state.speakers.length === before) return false;
    await this.save();
    return true;
  }

  /** Enceinte du jeton, comparé en temps constant ; `null` si inconnu ou retiré. */
  verify(token: string | null | undefined): Speaker | null {
    if (!token || token.length > 200) return null;
    const candidate = Buffer.from(hashToken(token), 'hex');
    let found: StoredSpeaker | null = null;
    for (const speaker of this.state.speakers) {
      const stored = Buffer.from(speaker.tokenHash, 'hex');
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) found = speaker;
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
