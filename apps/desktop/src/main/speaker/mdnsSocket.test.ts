import { describe, expect, it } from 'vitest';
import { createMulticastSocket } from './mdnsSocket.js';

describe('multicast-dns', () => {
  it('charge la bibliothèque JavaScript et se ferme sans planter', () => {
    const socket = createMulticastSocket('127.0.0.1');
    expect(socket === null || typeof socket.destroy === 'function').toBe(true);
    socket?.destroy();
  });
});
