/**
 * Fausse carte série. esptool-js n'est pas appelé : le programmeur est un objet à part.
 * Le mot de passe arrive sur le lien (la carte doit le recevoir) et nulle part ailleurs.
 */
import type { SerialLink } from './installDriver.js';

export interface FakeHello {
  fw: string;
  mac: string;
  configured: boolean;
}

export interface FakeCardOptions {
  /** Réponse avant toute écriture. `null` : la carte ne parle pas encore. */
  beforeFlash?: FakeHello | null;
  afterFlash?: FakeHello;
  networks?: Array<{ ssid: string; rssi: number; secure: boolean }>;
  configError?: string;
  steps?: Array<{ step: string; ok: boolean; error?: string; ip?: string; rssi?: number; host?: string; via?: string }>;
  /** Comme la vraie carte sur l'USB natif : chaque réponse arrive deux fois (console, puis liaison). */
  echoTwice?: boolean;
  /** Après l'écriture, la carte redémarre et perd ce nombre de « hello » reçus pendant son démarrage. */
  lostHellosAfterFlash?: number;
}

export class FakeSpeakerLink implements SerialLink {
  readonly sent: string[] = [];
  flashed = false;
  forgotten = 0;
  private pending = '';
  private lostHellos = 0;

  constructor(private readonly options: FakeCardOptions = {}) {}

  async write(text: string): Promise<void> {
    this.sent.push(text);
    const command = text.trim().split(/\s/)[0] ?? '';
    if (command === 'hello') {
      if (this.flashed && this.lostHellos > 0) {
        this.lostHellos -= 1;
        return;
      }
      const hello = this.flashed ? (this.options.afterFlash ?? null) : (this.options.beforeFlash ?? null);
      if (hello) this.enqueue(hello);
      return;
    }
    if (command === 'scan') {
      this.enqueue({ networks: this.options.networks ?? [{ ssid: 'synthetique-test', rssi: -42, secure: true }] });
      return;
    }
    if (command === 'wifi' || command === 'config') {
      this.enqueue(this.options.configError ? { ok: false, error: this.options.configError } : { ok: true });
      return;
    }
    if (command === 'test') {
      const steps = this.options.steps ?? [
        { step: 'wifi', ok: true, ip: '192.168.1.40', rssi: -42 },
        { step: 'pc', ok: true, host: '192.168.1.20', via: 'mdns' },
        { step: 'bridge', ok: true },
        { step: 'voice', ok: true },
      ];
      for (const step of steps) this.enqueue(step);
      return;
    }
    if (command === 'forget') {
      this.forgotten += 1;
      this.enqueue({ ok: true });
    }
  }

  async read(): Promise<string> {
    const out = this.pending;
    this.pending = '';
    if (!out) await new Promise((resolve) => setTimeout(resolve, 5));
    return out;
  }

  markFlashed(): void {
    this.flashed = true;
    this.lostHellos = this.options.lostHellosAfterFlash ?? 0;
  }

  private enqueue(json: unknown): void {
    this.pending += `I (12) jarvis: journal bruité synthetique-test\nJARVIS> ${JSON.stringify(json)}\n`;
    if (this.options.echoTwice) this.pending += `JARVIS> ${JSON.stringify(json)}\r\n`;
  }
}
