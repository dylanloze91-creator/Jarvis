/**
 * Socket mDNS réelle : multicast-dns 7.2.5, JavaScript pur, une interface à la fois.
 * Une erreur d'ouverture ne doit pas arrêter Jarvis.
 */
import { createRequire } from 'node:module';
import type { AnnounceSocket } from './announce.js';

interface MdnsQuery {
  questions?: Array<{ name: string; type: string }>;
}

interface MdnsHandle {
  on(event: 'query', listener: (packet: MdnsQuery) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  respond(answers: unknown[]): void;
  destroy(callback?: () => void): void;
}

type MdnsFactory = (options?: { interface?: string; reuseAddr?: boolean }) => MdnsHandle;

const require = createRequire(import.meta.url);
const createMdns = require('multicast-dns') as MdnsFactory;

export function createMulticastSocket(address: string): AnnounceSocket | null {
  let handle: MdnsHandle;
  try {
    handle = createMdns({ interface: address, reuseAddr: true });
  } catch {
    return null;
  }
  return {
    on(event, listener) {
      if (event === 'query') {
        handle.on('query', (packet) => listener(packet));
        return;
      }
      handle.on('error', (error) => listener(error));
    },
    respond(answers) {
      const packet = (answers as Array<Record<string, unknown>>).map((answer) => ({ ...answer, ttl: 120 }));
      try {
        handle.respond(packet);
      } catch {
        // réponse impossible : l'enceinte retombe sur les adresses connues
      }
    },
    destroy() {
      try {
        handle.destroy();
      } catch {
        // déjà fermée
      }
    },
  };
}
