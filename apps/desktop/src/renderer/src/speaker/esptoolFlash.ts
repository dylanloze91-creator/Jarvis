/**
 * Branchement d'esptool-js sur le port USB. Les tests n'utilisent pas ce fichier :
 * ils passent un faux programmeur à `installSpeaker`.
 */
import { ESPLoader, Transport, type FlashOptions } from 'esptool-js';
import type { ChipFlasher, SerialLink } from './installDriver.js';

interface UsbPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Navigator {
    serial?: {
      requestPort(): Promise<UsbPort>;
    };
  }
}

export interface FlashImage {
  data: Uint8Array;
  address: number;
  md5: string;
}

interface OpenablePort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
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

/** esptool-js 0.7.1 : écriture compressée, MD5, puis hard_reset. */
export function esptoolFlasher(port: UsbPort, images: readonly FlashImage[]): ChipFlasher {
  let loader: ESPLoader | null = null;
  const hashes = new WeakMap<Uint8Array, string>();
  for (const image of images) hashes.set(image.data, image.md5);
  return {
    async identify() {
      try {
        await reopen(port);
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
        // Le port est rouvert pour les lignes de texte.
      }
      await reopen(port);
    },
  };
}

async function reopen(port: OpenablePort): Promise<void> {
  if (port.readable && port.writable) return;
  try {
    await port.close();
  } catch {
    // déjà fermé
  }
  await port.open({ baudRate: 115200 });
}

/** Lignes de texte sur le port USB, relâchées entre deux lectures pour laisser esptool-js. */
export function webSerialLink(port: UsbPort): SerialLink {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  return {
    async write(text) {
      await reopen(port);
      const current = writer && port.writable ? writer : port.writable?.getWriter() ?? null;
      if (!current) return;
      writer = current;
      try {
        await current.write(encoder.encode(text));
      } catch {
        writer = null;
        await reopen(port);
        const again = port.writable?.getWriter() ?? null;
        if (!again) return;
        writer = again;
        await again.write(encoder.encode(text));
      }
    },
    async read(timeoutMs) {
      await reopen(port);
      if (!port.readable) return '';
      const reader = port.readable.getReader();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value?: undefined }>((resolve) => {
            timer = setTimeout(() => resolve({ done: true }), timeoutMs);
          }),
        ]);
        if (chunk.done || !chunk.value) return '';
        return decoder.decode(chunk.value, { stream: true });
      } finally {
        if (timer) clearTimeout(timer);
        try {
          await reader.cancel();
        } catch {
          // lecture déjà terminée
        }
        try {
          reader.releaseLock();
        } catch {
          // verrou déjà rendu
        }
      }
    },
  };
}
