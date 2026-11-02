import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '@jarvis/core';

const userDataDir = await mkdtemp(join(tmpdir(), 'jarvis-settings-'));
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }));

const { createSerialQueue, readSettings, writeSettings } = await import('./store.js');

describe('écriture des réglages', () => {
  afterAll(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  it('exécute les écritures dans l’ordre des demandes', async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueue(async () => {
      await gate;
      order.push('a');
    });
    const second = enqueue(async () => {
      order.push('b');
    });
    expect(order).toEqual([]);
    release();
    await first;
    await second;
    expect(order).toEqual(['a', 'b']);
  });

  it('laisse le dernier enregistrement sur le disque', async () => {
    await Promise.all([
      writeSettings(parseSettings({ hotkey: 'Control+A' })),
      writeSettings(parseSettings({ hotkey: 'Control+B' })),
    ]);
    const saved = JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')) as {
      hotkey: string;
    };
    expect(saved.hotkey).toBe('Control+B');
    // 5.0.64 : écriture atomique, aucun fichier temporaire ne reste.
    expect((await readdir(userDataDir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('5.0.64 : un settings.json illisible est copié avant de repartir des défauts', async () => {
    await writeFile(join(userDataDir, 'settings.json'), '{"hotkey": "Control+C", "mod', 'utf8');
    const settings = await readSettings();
    expect(settings.hotkey).toBe('Control+Space');
    expect(await readFile(join(userDataDir, 'settings.json.corrompu'), 'utf8')).toContain('Control+C');
  });
});
