import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { patientFetch } from './patientFetch.js';

let server: Server;
let url = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      // En-têtes envoyés tard, comme Ollama pendant un long appel d'outil.
      setTimeout(
        () => {
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(`${JSON.stringify({ echo: body, method: req.method })}\n`);
          setTimeout(() => res.end(`${JSON.stringify({ done: true })}\n`), 50);
        },
        req.url === '/lent' ? 300 : 0,
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('fetch du modèle de code, sans délai de transport (5.0.1)', () => {
  it('attend des en-têtes tardifs et lit le corps en flux', async () => {
    const response = await patientFetch(`${url}/lent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"model":"x"}',
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([{ echo: '{"model":"x"}', method: 'POST' }, { done: true }]);
  });

  it('s’arrête à l’annulation', async () => {
    const controller = new AbortController();
    const pending = patientFetch(`${url}/lent`, {
      method: 'POST',
      body: 'x',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
