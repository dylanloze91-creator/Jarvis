import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { GOOGLE_OAUTH_PORT } from '@jarvis/core';
import { listenGoogleOAuthLoopback } from './oauth.js';

describe('listenGoogleOAuthLoopback', () => {
  it('prend un port libre si le port par défaut renvoie EACCES', async () => {
    const ports: number[] = [];
    const picked = await listenGoogleOAuthLoopback(GOOGLE_OAUTH_PORT, async (port) => {
      ports.push(port);
      if (port === GOOGLE_OAUTH_PORT) {
        const err = new Error('listen EACCES') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return { server, port: (server.address() as { port: number }).port };
    });
    expect(ports).toEqual([GOOGLE_OAUTH_PORT, 0]);
    expect(picked.port).not.toBe(GOOGLE_OAUTH_PORT);
    picked.server.close();
  });
});
