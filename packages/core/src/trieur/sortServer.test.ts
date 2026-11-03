import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedSortHost, SORT_APP_JS, TrieurSortServer } from './sortServer.js';
import { trieurFileNames } from './files.js';

describe('trieur sort server', () => {
  it('refuse un hôte autre que 127.0.0.1', () => {
    expect(allowedSortHost('127.0.0.1:1234')).toBe(true);
    expect(allowedSortHost('evil.example:1234')).toBe(false);
  });

  it('sert la feuille de style à /app.css sans style inline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trieur-css-'));
    const files = trieurFileNames(dir);
    await writeFile(files.toSort, '', 'utf8');
    const server = new TrieurSortServer({
      toSortPath: files.toSort,
      examPath: files.exam,
      progressPath: files.sortProgress,
    });
    const { port } = await server.start();
    const host = `127.0.0.1:${port}`;
    const page = await fetch(`http://${host}/`, { headers: { host } });
    const html = await page.text();
    expect(html).not.toContain('<style');
    expect(html).toContain('/app.css');
    const css = await fetch(`http://${host}/app.css`, { headers: { host } });
    expect(css.ok).toBe(true);
    expect(await css.text()).toContain('.grid');
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('refuse POST /api/choose sans application/json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trieur-post-'));
    const files = trieurFileNames(dir);
    await writeFile(
      files.toSort,
      `${JSON.stringify({ id: 'a', phrase: 'Test', context: 'Demande : Test\nÉquipe :' })}\n`,
      'utf8',
    );
    const server = new TrieurSortServer({
      toSortPath: files.toSort,
      examPath: files.exam,
      progressPath: files.sortProgress,
    });
    const { port } = await server.start();
    const host = `127.0.0.1:${port}`;
    const choose = await fetch(`http://${host}/api/choose`, {
      method: 'POST',
      headers: { host, 'Content-Type': 'text/plain' },
      body: 'team=pc',
    });
    expect(choose.status).toBe(415);
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('annule la dernière classification et recule la progression', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trieur-undo-'));
    const files = trieurFileNames(dir);
    await writeFile(
      files.toSort,
      `${JSON.stringify({ id: 'a', phrase: 'Une', context: 'Demande : Une\nÉquipe :' })}\n${JSON.stringify({ id: 'b', phrase: 'Deux', context: 'Demande : Deux\nÉquipe :' })}\n`,
      'utf8',
    );
    const server = new TrieurSortServer({
      toSortPath: files.toSort,
      examPath: files.exam,
      progressPath: files.sortProgress,
    });
    const { port } = await server.start();
    const host = `127.0.0.1:${port}`;
    const headers = { host, 'Content-Type': 'application/json' };
    await fetch(`http://${host}/api/choose`, { method: 'POST', headers, body: JSON.stringify({ team: 'pc' }) });
    await fetch(`http://${host}/api/choose`, { method: 'POST', headers, body: JSON.stringify({ team: 'web' }) });
    const undo = await fetch(`http://${host}/api/undo`, { method: 'POST', headers, body: '{}' });
    expect(undo.ok).toBe(true);
    const examRaw = await readFile(files.exam, 'utf8');
    expect(examRaw).not.toContain('"team":"web"');
    expect(examRaw).toContain('"team":"pc"');
    const current = await fetch(`http://${host}/api/current`, { headers: { host } });
    const body = (await current.json()) as { phrase?: string; done?: boolean };
    expect(body.done).toBe(false);
    expect(body.phrase).toBe('Deux');
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('écrit examen.jsonl et reprend la progression', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trieur-sort-'));
    const files = trieurFileNames(dir);
    await writeFile(
      files.toSort,
      `${JSON.stringify({ id: 'a', phrase: 'Ouvre le bloc-notes', context: 'Demande : Ouvre le bloc-notes\nÉquipe :' })}\n`,
      'utf8',
    );
    const server = new TrieurSortServer({
      toSortPath: files.toSort,
      examPath: files.exam,
      progressPath: files.sortProgress,
    });
    const { port } = await server.start();
    const base = `http://127.0.0.1:${port}`;
    const current = await fetch(`${base}/api/current`, { headers: { host: `127.0.0.1:${port}` } });
    expect(current.ok).toBe(true);
    const choose = await fetch(`${base}/api/choose`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'pc' }),
    });
    expect(choose.ok).toBe(true);
    const examRaw = await readFile(files.exam, 'utf8');
    expect(examRaw).toContain('"team":"pc"');
    await server.stop();
    const server2 = new TrieurSortServer({
      toSortPath: files.toSort,
      examPath: files.exam,
      progressPath: files.sortProgress,
    });
    const { port: port2 } = await server2.start();
    const done = await fetch(`http://127.0.0.1:${port2}/api/current`, { headers: { host: `127.0.0.1:${port2}` } });
    const body = (await done.json()) as { done?: boolean };
    expect(body.done).toBe(true);
    await server2.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('raccourcis 1 à 9 documentés dans le script (ne pas injecter du HTML)', () => {
    expect(SORT_APP_JS).toContain('textContent');
    expect(SORT_APP_JS).not.toMatch(/innerHTML\s*=/);
    expect(SORT_APP_JS).toMatch(/n>=1&&n<=9/);
  });
});
