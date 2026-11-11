/**
 * Faux port qui suit les règles de Web Serial :
 * ouvrir deux fois est une erreur, un flux verrouillé refuse un second lecteur,
 * annuler le lecteur jette les données encore en file.
 */

function invalidState(message: string): Error {
  const error = new Error(message);
  error.name = 'InvalidStateError';
  return error;
}

export interface StrictPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export class StrictSerialPort {
  opened = false;
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  /** Octets jetés par `reader.cancel()`. */
  dropped = 0;
  readonly written: Uint8Array[] = [];
  /** Réaction de la fausse carte à ce qui est écrit. */
  onWrite?: (text: string) => void;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private queued: Uint8Array[] = [];
  /** Octets déjà donnés au flux et pas encore lus. L'annulation les jette. */
  private unread = 0;

  constructor(readonly info: StrictPortInfo = {}) {}

  getInfo(): StrictPortInfo {
    return this.info;
  }

  async open(_options?: { baudRate: number }): Promise<void> {
    if (this.opened) throw invalidState('Le port est déjà ouvert.');
    this.opened = true;
    this.queued = [];
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        for (const chunk of this.queued) controller.enqueue(chunk);
        this.queued = [];
      },
      cancel: () => {
        this.dropped += this.unread + this.queued.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        this.unread = 0;
        this.queued = [];
        this.controller = null;
        this.readable = null;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(chunk);
        this.onWrite?.(new TextDecoder().decode(chunk));
      },
    });
  }

  async close(): Promise<void> {
    if (!this.opened) throw invalidState('Le port est déjà fermé.');
    if (this.readable?.locked || this.writable?.locked) throw invalidState('Un flux est encore verrouillé.');
    this.opened = false;
    this.readable = null;
    this.writable = null;
    this.controller = null;
  }

  /** Ce que la carte enverrait. Si le lecteur a été annulé, c'est jeté. */
  push(bytes: Uint8Array): void {
    if (!this.controller) {
      this.queued.push(bytes);
      return;
    }
    this.unread += bytes.byteLength;
    this.controller.enqueue(bytes);
  }

  pushText(text: string): void {
    this.push(new TextEncoder().encode(text));
  }
}

export class PortBank {
  private ports: StrictSerialPort[] = [];

  add(info: StrictPortInfo = {}): StrictSerialPort {
    const port = new StrictSerialPort(info);
    this.ports.push(port);
    return port;
  }

  drop(port: StrictSerialPort): void {
    this.ports = this.ports.filter((item) => item !== port);
  }

  getPorts(): StrictSerialPort[] {
    return [...this.ports];
  }
}
