import { createServer } from 'node:net';

/** Vrai si rien n'écoute déjà. On referme tout de suite : on ne garde pas le port. */
export function portIsFree(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    const finish = (free: boolean): void => {
      server.removeAllListeners();
      if (server.listening) server.close(() => resolve(free));
      else resolve(free);
    };
    server.once('error', () => finish(false));
    if (host) server.listen(port, host, () => finish(true));
    else server.listen(port, () => finish(true));
  });
}
