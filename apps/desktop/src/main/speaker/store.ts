import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
  mac?: string;
  pending?: boolean;
  fw?: string;
  lastHelloAt?: number;
  rssi?: number;
  ip?: string;
}

interface StoredSpeaker extends Speaker {
  tokenHash: string;
  /** Nouvelle clé pendant un remplacement. L'ancienne marche encore tant qu'on n'a pas confirmé. */
  pendingTokenHash?: string;
}

interface SpeakerFile {
  enabled: boolean;
  pcId: string;
  speakers: StoredSpeaker[];
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

function readFileState(raw: string): SpeakerFile {
  const data = JSON.parse(raw) as Partial<SpeakerFile>;
  const speakers = Array.isArray(data.speakers)
    ? data.speakers.flatMap((speaker): StoredSpeaker[] => {
        if (
          !speaker ||
          typeof speaker.id !== 'string' ||
          typeof speaker.name !== 'string' ||
          typeof speaker.createdAt !== 'number' ||
          typeof speaker.tokenHash !== 'string' ||
          !/^[0-9a-f]{64}$/.test(speaker.tokenHash)
        ) {
          return [];
        }
        const stored: StoredSpeaker = {
          id: speaker.id,
          name: speaker.name,
          createdAt: speaker.createdAt,
          tokenHash: speaker.tokenHash,
        };
        const mac = optionalText(speaker.mac, 20);
        if (mac) stored.mac = mac.toLowerCase();
        if (speaker.pending === true) stored.pending = true;
        const fw = optionalText(speaker.fw, 24);
        if (fw) stored.fw = fw;
        if (typeof speaker.lastHelloAt === 'number') stored.lastHelloAt = speaker.lastHelloAt;
        if (typeof speaker.rssi === 'number') stored.rssi = speaker.rssi;
        const ip = optionalText(speaker.ip, 40);
        if (ip) stored.ip = ip;
        if (typeof speaker.pendingTokenHash === 'string' && /^[0-9a-f]{64}$/.test(speaker.pendingTokenHash)) {
          stored.pendingTokenHash = speaker.pendingTokenHash;
        }
        return [stored];
      })
    : [];
  const pcId = typeof data.pcId === 'string' && /^[0-9a-f]{8}$/.test(data.pcId) ? data.pcId : randomBytes(4).toString('hex');
  return { enabled: data.enabled === true, pcId, speakers };
}

export class SpeakerStore {
  private state: SpeakerFile = { enabled: false, pcId: '', speakers: [] };
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: () => string) {}

  static inUserData(userData: () => string): SpeakerStore {
    return new SpeakerStore(() => join(userData(), 'speakers.json'));
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const target = this.filePath();
    let raw: string | null = null;
    try {
      raw = await readFile(target, 'utf8');
    } catch {
      raw = null; // pas encore de fichier : état vide, rien à garder
    }
    this.state = { enabled: false, pcId: randomBytes(4).toString('hex'), speakers: [] };
    if (raw !== null) {
      try {
        this.state = readFileState(raw);
      } catch {
        // Fichier abîmé : on en garde une copie avant qu'une prochaine écriture ne l'écrase,
        // plutôt que de perdre en silence les enceintes qu'il contenait.
        await copyFile(target, `${target}.illisible`).catch(() => undefined);
      }
    }
    this.loaded = true;
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  get pcId(): string {
    return this.state.pcId;
  }

  speakers(): Speaker[] {
    return this.state.speakers.map(({ tokenHash: _tokenHash, pendingTokenHash: _pending, ...speaker }) => speaker);
  }

  findByMac(mac: string): Speaker | null {
    const wanted = mac.trim().toLowerCase();
    const found = this.state.speakers.find((speaker) => speaker.mac === wanted && !speaker.pending);
    return found ? this.speakers().find((speaker) => speaker.id === found.id) ?? null : null;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.load();
    this.state = { ...this.state, enabled };
    await this.save();
  }

  /**
   * Nouvelle enceinte : le jeton n'est rendu qu'une fois, pour le bloc `secrets.h`. Au-delà de la
   * limite, la plus ancienne est retirée et rendue dans `evicted` : l'appelant oublie sa session.
   */
  async addSpeaker(name: string | undefined, now = Date.now()): Promise<{ speaker: Speaker; token: string; evicted: Speaker[] }> {
    await this.load();
    const token = randomBytes(32).toString('base64url');
    const speaker: StoredSpeaker = { id: randomUUID(), name: cleanSpeakerName(name), createdAt: now, tokenHash: hashToken(token) };
    const cut = Math.max(0, this.state.speakers.length - (SPEAKER_MAX_SPEAKERS - 1));
    const evicted = this.state.speakers.slice(0, cut).map(({ id, name: kept, createdAt }) => ({ id, name: kept, createdAt }));
    this.state = { ...this.state, speakers: [...this.state.speakers.slice(cut), speaker] };
    await this.save();
    return { speaker: { id: speaker.id, name: speaker.name, createdAt: speaker.createdAt }, token, evicted };
  }

  async removeSpeaker(id: string): Promise<boolean> {
    await this.load();
    const before = this.state.speakers.length;
    this.state = { ...this.state, speakers: this.state.speakers.filter((speaker) => speaker.id !== id) };
    if (this.state.speakers.length === before) return false;
    await this.save();
    return true;
  }

  /**
   * Nouvelle enceinte encore en attente, ou remplacement d'une carte déjà connue (même MAC).
   * Le jeton en clair n'est rendu qu'ici. Il n'est pas écrit dans le fichier.
   */
  async beginInstall(name: string | undefined, mac: string, now = Date.now()): Promise<{ speaker: Speaker; token: string; replaced: boolean }> {
    await this.load();
    const token = randomBytes(32).toString('hex');
    const hash = hashToken(token);
    const wanted = mac.trim().toLowerCase();
    const existing = this.state.speakers.find((speaker) => speaker.mac === wanted && !speaker.pending);
    if (existing) {
      existing.pendingTokenHash = hash;
      await this.save();
      const speaker = this.speakers().find((item) => item.id === existing.id)!;
      return { speaker, token, replaced: true };
    }
    const speaker: StoredSpeaker = {
      id: randomUUID(),
      name: cleanSpeakerName(name),
      createdAt: now,
      tokenHash: hash,
      mac: wanted,
      pending: true,
    };
    this.state = { ...this.state, speakers: [...this.state.speakers, speaker] };
    await this.save();
    return { speaker: this.speakers().find((item) => item.id === speaker.id)!, token, replaced: false };
  }

  async commitInstall(id: string, fw?: string): Promise<boolean> {
    await this.load();
    const speaker = this.state.speakers.find((item) => item.id === id);
    if (!speaker) return false;
    if (speaker.pendingTokenHash) {
      speaker.tokenHash = speaker.pendingTokenHash;
      delete speaker.pendingTokenHash;
    }
    speaker.pending = false;
    if (fw) speaker.fw = fw;
    await this.save();
    return true;
  }

  /** Abandon : une enceinte neuve disparaît. Un remplacement garde l'ancienne clé. */
  async abandonInstall(id: string): Promise<boolean> {
    await this.load();
    const speaker = this.state.speakers.find((item) => item.id === id);
    if (!speaker) return false;
    if (speaker.pending) {
      this.state = { ...this.state, speakers: this.state.speakers.filter((item) => item.id !== id) };
    } else if (speaker.pendingTokenHash) {
      delete speaker.pendingTokenHash;
    } else {
      return false;
    }
    await this.save();
    return true;
  }

  /** Enceinte du jeton, comparé en temps constant ; `null` si inconnu ou retiré. */
  verify(token: string | null | undefined): Speaker | null {
    if (!token || token.length > 200) return null;
    const candidate = Buffer.from(hashToken(token), 'hex');
    let found: StoredSpeaker | null = null;
    for (const speaker of this.state.speakers) {
      for (const hash of [speaker.tokenHash, speaker.pendingTokenHash]) {
        if (!hash) continue;
        const stored = Buffer.from(hash, 'hex');
        if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) found = speaker;
      }
    }
    if (!found) return null;
    return this.speakers().find((speaker) => speaker.id === found.id) ?? null;
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
