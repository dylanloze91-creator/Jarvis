import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

function contentType(ext: string): string {
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

/** Petit serveur HTTP local pour éviter file:// (modules ES, CORS). */
export async function serveStaticDir(
  root: string,
): Promise<{ url: string; close: () => Promise<void> }> {
  const base = normalize(root);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        let rel = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        if (rel === '/') rel = '/index.html';
        const file = normalize(join(base, rel.replace(/^\//, '')));
        if (!file.startsWith(base)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': contentType(extname(file)) });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
