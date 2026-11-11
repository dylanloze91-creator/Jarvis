/**
 * Un seul propriétaire du port à la fois.
 * La liaison texte a un lecteur permanent. Avant esptool, elle relâche ses verrous
 * et le port est fermé : c'est `Transport.connect` qui l'ouvre. Après la remise à zéro,
 * on retrouve le port (la prise USB native change d'objet).
 */
import { ESPLoader, Transport, type FlashOptions } from 'esptool-js';
import type { ChipFlasher, SerialLink } from './installDriver.js';

export interface UsbPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

declare global {
  interface Navigator {
    serial?: {
      requestPort(): Promise<UsbPort>;
      getPorts?(): Promise<UsbPort[]>;
    };
  }
}

export interface FlashImage {
  data: Uint8Array;
  address: number;
  md5: string;
}

function flashBytes(label: string | undefined): number {
  if (!label) return 0;
  const match = /^(\d+)(KB|MB)$/.exec(label);
  if (!match) return 0;
  const count = Number(match[1]);
  return match[2] === 'MB' ? count * 1024 * 1024 : count * 1024;
}

function chipName(described: string): string {
  if (described.startsWith('ESP32-S3')) return 'ESP32-S3';
  return described.split(' ')[0] || described;
}

/** esptool-js 0.7.1 ouvre lui-même un port fermé. */
export function esptoolFlasher(getPort: () => UsbPort, images: readonly FlashImage[]): ChipFlasher {
  let loader: ESPLoader | null = null;
  const hashes = new WeakMap<Uint8Array, string>();
  for (const image of images) hashes.set(image.data, image.md5);
  return {
    async identify() {
      try {
        const port = getPort();
        loader = new ESPLoader({ transport: new Transport(port as never, false), baudrate: 115200 });
        const described = await loader.main('default_reset');
        const detected = await loader.detectFlashSize();
        return { ok: true, name: chipName(described), flashBytes: flashBytes(detected) };
      } catch {
        return { ok: false, boot: true };
      }
    },
    async flash(onProgress) {
      if (!loader) return false;
      const options: FlashOptions = {
        fileArray: images.map((image) => ({ data: image.data, address: image.address })),
        flashMode: 'qio',
        flashFreq: '80m',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_index, written, total) => onProgress(total > 0 ? Math.round((written / total) * 100) : 0),
        calculateMD5Hash: (image) => hashes.get(image) ?? '',
      };
      try {
        await loader.writeFlash(options);
        return true;
      } catch {
        return false;
      }
    },
    async reboot() {
      try {
        await loader?.after('hard_reset');
      } catch {
        // La carte a pu redémarrer toute seule.
      }
      try {
        await loader?.transport.disconnect();
      } catch {
        // Le port est retrouvé ensuite.
      }
    },
  };
}

/** Même objet (UART) ou nouvel objet de même identifiant (USB natif). */
export async function findSerialPort(previous: UsbPort): Promise<UsbPort | null> {
  const ports = (await navigator.serial?.getPorts?.()) ?? [];
  if (ports.includes(previous)) return previous;
  const info = previous.getInfo?.() ?? {};
  if (info.usbVendorId === undefined) return null;
  return (
    ports.find((port) => {
      const next = port.getInfo?.() ?? {};
      return next.usbVendorId === info.usbVendorId && next.usbProductId === info.usbProductId;
    }) ?? null
  );
}

/**
 * Lecteur unique, écrivain relâché après chaque ligne.
 * `release` annule le lecteur seulement à l'arrêt, pour ne pas jeter les `JARVIS>`.
 */
export interface TextLink extends SerialLink {
  release(): Promise<void>;
  attach(port: UsbPort): Promise<void>;
}

export function textLink(initial: UsbPort): TextLink {
  let current = initial;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let buffer = '';
  let generation = 0;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const waiting: Array<(text: string) => void> = [];

  const flush = (): void => {
    if (!buffer || waiting.length === 0) return;
    const text = buffer;
    buffer = '';
    for (const waiter of waiting.splice(0)) waiter(text);
  };

  const pump = async (active: ReadableStreamDefaultReader<Uint8Array>, gen: number): Promise<void> => {
    try {
      while (generation === gen && reader === active) {
        const { done, value } = await active.read();
        if (done || !value || generation !== gen) break;
        buffer += decoder.decode(value, { stream: true });
        flush();
      }
    } catch {
      // Le lecteur a été annulé : les octets encore en file sont jetés.
    }
  };

  const start = (): void => {
    if (reader || !current.readable || current.readable.locked) return;
    const gen = generation;
    const next = current.readable.getReader();
    reader = next;
    void pump(next, gen);
  };

  const release = async (): Promise<void> => {
    generation += 1;
    const active = reader;
    reader = null;
    buffer = '';
    for (const waiter of waiting.splice(0)) waiter('');
    if (!active) return;
    try {
      await active.cancel();
    } catch {
      // déjà annulé
    }
    try {
      active.releaseLock();
    } catch {
      // déjà rendu
    }
  };

  return {
    async write(text) {
      if (!current.writable || current.writable.locked) throw new Error('Le port est occupé.');
      const writer = current.writable.getWriter();
      try {
        await writer.write(encoder.encode(text));
      } finally {
        writer.releaseLock();
      }
    },
    async read(timeoutMs) {
      start();
      if (buffer) {
        const text = buffer;
        buffer = '';
        return text;
      }
      return new Promise((resolve) => {
        const finish = (text: string): void => {
          clearTimeout(timer);
          resolve(text);
        };
        const timer = setTimeout(() => {
          const index = waiting.indexOf(finish);
          if (index >= 0) waiting.splice(index, 1);
          resolve('');
        }, timeoutMs);
        waiting.push(finish);
      });
    },
    release,
    async attach(port: UsbPort) {
      await release();
      current = port;
      if (!port.readable || !port.writable) await port.open({ baudRate: 115200 });
      start();
    },
  };
}

/** Ancien nom : la liaison texte correcte. */
export const webSerialLink = textLink;
