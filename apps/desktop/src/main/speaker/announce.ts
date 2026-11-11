/**
 * Annonce mDNS du PC. Une socket par adresse gardée. Si l'ouverture échoue, on continue sans planter.
 * Le pont coupé n'ouvre rien : l'appelant ne démarre pas cette classe.
 */
import { announceInterfaces, mdnsAnswers, type MdnsQuestion, type NetIface } from '@jarvis/core';

export interface AnnounceSocket {
  on(event: 'query' | 'error', listener: (value: { questions?: MdnsQuestion[] } | Error) => void): void;
  respond(answers: unknown[]): void;
  destroy(): void;
}

export interface AnnounceContext {
  pcId: string;
  port: number;
  hostname: string;
}

export function openAnnounce(
  ifaces: readonly NetIface[],
  ctx: AnnounceContext,
  create: (address: string) => AnnounceSocket,
): AnnounceSocket[] {
  const { kept } = announceInterfaces(ifaces);
  const sockets: AnnounceSocket[] = [];
  for (const address of kept) {
    let socket: AnnounceSocket;
    try {
      socket = create(address);
    } catch {
      continue;
    }
    socket.on('error', () => undefined);
    socket.on('query', (value) => {
      const packet = value as { questions?: MdnsQuestion[] };
      const answers = mdnsAnswers(packet.questions ?? [], { ...ctx, addresses: kept });
      if (answers.length > 0) socket.respond(answers);
    });
    sockets.push(socket);
  }
  return sockets;
}
