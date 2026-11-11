import { describe, expect, it } from 'vitest';
import { openAnnounce, type AnnounceSocket } from './announce.js';

class FakeSocket implements AnnounceSocket {
  queries: Array<(packet: { questions?: Array<{ name: string; type: string }> }) => void> = [];
  sent: unknown[][] = [];
  closed = false;
  on(event: 'query' | 'error', listener: (packet: { questions?: Array<{ name: string; type: string }> }) => void): void {
    if (event === 'query') this.queries.push(listener);
  }
  respond(answers: unknown[]): void {
    this.sent.push(answers);
  }
  destroy(): void {
    this.closed = true;
  }
  ask(name: string, type: string): void {
    for (const listener of this.queries) listener({ questions: [{ name, type }] });
  }
}

describe('annonce mDNS', () => {
  it('répond sur la bonne interface et pas du tout si aucune adresse n’est gardée', () => {
    const made: FakeSocket[] = [];
    const sockets = openAnnounce(
      [
        { name: 'Wi-Fi', address: '192.168.1.20', gateway: '192.168.1.1' },
        { name: 'Tailscale', address: '100.80.0.2', gateway: '100.80.0.1' },
      ],
      { pcId: 'ab12cd34', port: 53131, hostname: 'pc-synthetique' },
      () => {
        const socket = new FakeSocket();
        made.push(socket);
        return socket;
      },
    );
    expect(sockets).toHaveLength(1);
    made[0]!.ask('_jarvis-speaker._tcp.local', 'PTR');
    expect(made[0]!.sent[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'TXT', data: ['pc=ab12cd34', 'v=1'] })]),
    );
    made[0]!.ask('_http._tcp.local', 'PTR');
    expect(made[0]!.sent).toHaveLength(1);

    const none = openAnnounce([{ name: 'Tailscale', address: '100.64.1.1', gateway: '100.64.0.1' }], { pcId: 'ab12cd34', port: 53131, hostname: 'pc' }, () => {
      throw new Error('ne doit pas ouvrir');
    });
    expect(none).toEqual([]);
  });
});
